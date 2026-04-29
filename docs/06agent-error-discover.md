# Agent 错误恢复机制设计

本文档基于 Harness 工程设计理念，说明 HomeTale 中 Agent 的错误恢复策略。核心原则：**robust agent recovers instead of crashing**（健壮的 agent 恢复而不是崩溃）。

## 概述

在 Agent 运行过程中，可能会遇到各种错误情况：输出截断、上下文过长、传输失败、工具执行失败、状态不一致。

设计错误恢复机制的目标：
1. **先判断错误类型，再选择恢复路径**
2. 有限次数的恢复尝试（重试预算）
3. 详细的恢复日志用于可观测性
4. 失败最终才暴露给用户

## Harness 核心心智模型

错误恢复不是简单的 try/except，而是构建一个状态机，明确每种错误的恢复路径.

恢复优先级（第一个匹配的分支）：
1. max_tokens → 注入续写消息，重试
2. prompt_too_long → 压缩，重试
3. connection error → 退避，重试
4. 所有重试耗尽 → 优雅失败

## 恢复状态

恢复状态包含三个独立计数器，防止无限重试：
- `continuationAttempts`：续写恢复次数
- `compactAttempts`：压缩恢复次数
- `backoffAttempts`：退避重试次数

每种恢复路径独立计数，成功响应后重置对应计数器。

## 三条恢复路径

### 路径 1：输出截断 → 续写

问题本质是这一轮输出空间不够，不是模型不会。恢复方法是追加一条续写消息，明确告诉模型不要重来、不要重复、直接从中断点接着写。

### 路径 2：上下文过长 → 压缩

压缩不是"删掉历史"，而是把旧对话从原文变成仍然可继续工作的摘要。摘要应保留：当前任务、已做工作、关键决定、下一步准备做什么。

### 路径 3：连接抖动 → 退避

"退避"是别立刻重打，而是等一小会儿再试。因为这类错误往往是临时拥堵，瞬间连续重打只会更容易失败。使用指数退避 + 抖动。

## 错误分类与恢复策略

| 类别 | 错误类型 | 检测条件 | 恢复策略 | 重试预算 |
|------|----------|----------|----------|----------|
| 输出截断 | Token 用完 | `stop_reason === "max_tokens"` | 注入续写消息 | 3 次 |
| 上下文错误 | Prompt 太长 | error.message includes 'prompt too long' | 触发压缩 | - |
| | Token 超限 | estimateTokens(messages) > threshold | 主动压缩（预防） | - |
| LLM 调用错误 | 网络超时 | ConnectionError, TimeoutError | 指数退避后重试 | 3 次 |
| | API 限流 | error.message includes 'rate' | 等待重试窗口 | 3 次 |
| | 服务不可用 | error.message includes 'unavailable' | 退避后重试 | 3 次 |
| | 认证失败 | status === 401 | 直接失败，提示检查配置 | 不重试 |
| | 模型不存在 | error.message includes 'model' | 返回可用模型列表 | 不重试 |
| 工具执行错误 | 权限拒绝 | 路径沙箱或角色权限 | 返回 `[ERROR]` 前缀，模型感知 | - |
| | 文件不存在 | 目标文件不存在 | 返回 `[ERROR]` 前缀 | - |
| | 危险命令 | 黑名单拦截 | 返回 `[ERROR]` 前缀，记录安全日志 | - |
| | 超时 | 命令执行过久 | 终止进程，返回部分结果或错误 | - |
| 状态错误 | 会话过期 | Session 超过有效期 | 重新认证或创建新会话 | - |
| | 角色不存在 | 角色 ID 无效 | 重新识别角色或创建新角色 | - |
| | 配置缺失 | config.json 不完整 | 使用默认配置并提示 | - |

## 主循环恢复逻辑位置

恢复逻辑放在两个位置：

**位置 1：模型调用外层** - 负责处理 API 报错、网络错误、超时、Prompt 太长。尝试 API 调用，带连接重试循环。

**位置 2：拿到 response 以后** - 负责处理 max_tokens、正常的 tool_use、正常的结束。

## 错误消息格式

### 工具错误（返回给 LLM）

使用 `[ERROR]` 前缀让模型感知失败。

### 用户可见错误（通过 WebSocket）

包含 code、message、details（技术细节，仅开发模式）、suggestion（恢复建议）。

### 恢复日志（控制台）

教学系统应打印清晰标签：
- `[Recovery] continue (1/3)`
- `[Recovery] compact`
- `[Recovery] backoff (2/3)`
- `[Error] max_tokens recovery exhausted (3 attempts). Stopping.`

## 防护机制

### Doom Loop 检测

连续调用同一工具失败时，主动中断。

### 熔断器模式

连续失败 N 次后暂停，避免浪费资源。

### Token 估算

粗略估算消息 token 数，用于主动压缩触发。

### 主动压缩

处理完工具调用后，检查是否该压缩，预防性恢复。

## 用户反馈最佳实践

| 错误 | 好的反馈 | 坏的反馈 |
|------|----------|----------|
| API Key 无效 | "配置的 API Key 无效，请在 config.json 中检查" | "Error 401" |
| 网络超时 | "网络连接超时，正在重试（第 1/3 次）..." | "fetch failed" |
| 文件写入失败 | "记忆保存失败，可能影响后续对话" | "[ERROR]" |
| 恢复耗尽 | "已尝试 3 次续写，输出仍未完成。请尝试简化请求。" | "max_tokens recovery exhausted" |


## 日志记录

| 级别 | 用途 | 示例 |
|------|------|------|
| ERROR | 致命错误，需要人工干预 | API Key 无效 |
| WARN | 可恢复的错误，需要注意 | 工具调用失败（有重试） |
| INFO | 正常的错误处理流程 | 自动重试中... |
| DEBUG | 详细错误栈（开发模式） | 完整错误对象 |

## HomeTale 项目使用的恢复机制

### 已实现

- LLM 调用错误捕获（llm-client.ts）
- 工具执行错误返回 `[ERROR]` 前缀
- 权限验证失败处理（permissions.ts）
- 危险命令黑名单拦截（safety-checks.ts）
- 会话/角色状态重建

### 待实现（基于 Harness 设计）

- 输出截断续写恢复（max_tokens 检测 + CONTINUATION_MESSAGE）
- 上下文过长压缩恢复（prompt too long 检测 + auto_compact）
- 连接抖动退避重试（指数退避 + 抖动）
- 恢复状态计数器（防止无限重试）
- Doom Loop 检测
- 熔断器模式
- 主动 Token 估算与预防性压缩
- 完整的恢复日志标签（`[Recovery]` 前缀）

## 与其他模块的衔接

- `docs/01agent-loop.md` - Agent 主循环的基本结构
- `docs/02agent-tool-use.md` - 工具系统与安全机制
- `docs/03agent_skill.md` - Skill 系统加载与执行

错误恢复机制是把这些模块串起来的"韧性保障"，确保 agent 在遇到问题时能继续前进而不是直接崩溃。

## Harness 设计理念总结

本文档遵循 Harness 工程设计的核心原则：**robust agent recovers instead of crashing**

关键要点：
1. 错误先分类 - 区分 `max_tokens`、`prompt_too_long`、传输错误
2. 恢复再执行 - 每类错误有独立的恢复路径
3. 有预算重试 - 防止无限循环
4. 日志可观测 - 清楚打印恢复动作
5. 失败最后暴露 - 所有恢复尝试耗尽才告诉用户

这不是外围小功能，而是把 agent 从"能跑"推进到"遇到问题也能继续跑"的核心机制。

## 关键文件

| 文件 | 职责 |
|------|------|
| `server/src/agents/llm-client.ts` | LLM 调用 + 错误捕获 |
| `server/src/agents/family-agent.ts` | 主循环 + 恢复路径（待实现） |
| `server/src/memory/memory-summarizer.ts` | 上下文压缩摘要（待用于恢复） |
| `server/src/agent-core/tools/safety-checks.ts` | 危险命令黑名单 |
| `server/src/agent-core/tools/permissions.ts` | 权限验证错误返回 |
| `server/src/agent-core/message-handler.ts` | 消息处理错误反馈 |
| `server/src/websocket/websocket-session.ts` | 错误消息发送 |

---

# 通用 Agent Harness 设计思路

## 设计哲学

错误恢复的核心命题不是"怎么 try/except"，而是构建一套**分类 → 决策 → 恢复 → 补偿 → 降级**的韧性管线。

关键洞察：
- 很多失败不是"任务真的失败了"，而只是"这一轮需要换一种继续方式"
- 恢复机制必须有自己的**失败恢复策略**（元恢复），否则恢复本身会成为新的故障源
- 不同层级的错误（传输层、上下文层、工具层、Agent 层）需要独立的恢复预算和策略
- 压缩操作本身也会失败，必须有降级路径

---

## 一、错误分类：先分类再恢复

### 1.1 四层错误模型

```
Layer 1: 传输层错误
  ├─ 网络超时 / 连接断开
  ├─ API 限流 / 服务不可用
  └─ 认证失败（不可恢复）

Layer 2: 上下文层错误
  ├─ 输出被截断 (max_tokens)
  ├─ Prompt 太长 (prompt_too_long)
  └─ 上下文窗口即将耗尽（预防性检测）

Layer 3: 工具层错误
  ├─ 权限拒绝
  ├─ 参数校验失败
  ├─ 执行超时
  └─ 危险操作拦截

Layer 4: Agent 层错误
  ├─ Subagent 失败
  ├─ 压缩操作失败
  ├─ 状态不一致（会话过期/角色丢失）
  └─ Doom Loop（同一工具连续失败）
```

### 1.2 恢复决策器

```python
def choose_recovery(stop_reason, error_text) -> dict:
    if stop_reason == "max_tokens":
        return {"kind": "continue", "reason": "output truncated"}

    if "prompt" in error_text and "long" in error_text:
        return {"kind": "compact", "reason": "context too large"}

    if any(word in error_text for word in ["timeout", "rate", "unavailable", "connection"]):
        return {"kind": "backoff", "reason": "transient transport failure"}

    return {"kind": "fail", "reason": "unknown or non-recoverable error"}
```

**关键原则**：把"错误长什么样"和"接下来怎么做"分开。错误分类是纯判断，恢复动作是纯执行。

---

## 二、恢复预算：每种错误独立计数

### 2.1 独立计数器

```
recovery_state = {
    continuation_attempts: 0,   # 续写恢复预算
    compact_attempts: 0,        # 压缩恢复预算
    backoff_attempts: 0,        # 退避重试预算
}
```

**为什么不共用一个计数器？** 因为不同类型的错误互不影响。一次成功的续写不应该消耗退避预算。一次压缩失败不应该阻止续写尝试。

### 2.2 成功后重置

```
收到非 max_tokens 的正常响应 → 重置 continuation_attempts
压缩成功 → 重置 compact_attempts
API 调用成功 → 重置 backoff_attempts
```

---

## 三、三条恢复路径

### 3.1 路径 1：输出截断 → 续写

```
stop_reason == "max_tokens"
  │
  ▼ 检查 continuation_attempts < 3
  │
  ├─ 是 → 注入续写消息
  │       "Output limit hit. Continue directly from where you stopped --
  │        no recap, no repetition. Pick up mid-sentence if needed."
  │       续续主循环
  │
  └─ 否 → 终止，告知用户"输出恢复已耗尽"
```

**续写提示词的关键**：不能只写"continue"。必须明确告诉模型：
- 不要重复
- 不要重新总结
- 直接从中断点接着写

否则模型经常会重新开头或重复已输出内容。

### 3.2 路径 2：上下文过长 → 压缩再重试

```
prompt_too_long 错误 / Token 超过阈值
  │
  ▼ 触发压缩
  │
  ├─ 压缩成功 → 用摘要替换历史 → 重试当前轮次
  │
  └─ 压缩失败 → 降级路径（见第五节）
```

**压缩不是删除历史**，而是把旧对话从原文变成仍然可继续工作的摘要。摘要至少保留：
- 当前任务是什么
- 已经做了什么
- 关键决定是什么
- 下一步准备做什么

**压缩后必须告诉模型"这是续场"**，否则模型可能重新向用户提问。

### 3.3 路径 3：连接抖动 → 退避重试

```
transient error (timeout / rate limit / connection)
  │
  ▼ 计算退避延迟
  │   delay = min(base * 2^attempt, max_delay) + random(0, 1)
  │
  ├─ attempt < MAX_RETRIES → sleep(delay) → 重试
  │
  └─ attempt >= MAX_RETRIES → 终止，告知用户
```

**指数退避 + 抖动**：`base * 2^attempt + jitter`。抖动防止多个客户端同时重试形成"雷群效应"。

---

## 四、恢复逻辑在主循环中的位置

### 4.1 两个挂载点

```
主循环
  │
  ├─ [挂载点 1：模型调用外层]
  │   负责：API 报错、网络错误、超时、Prompt 太长
  │   │
  │   └─ try { response = callAPI() }
  │       catch APIError → 判断是否可恢复
  │       catch ConnectionError → 退避重试
  │
  ├─ [挂载点 2：拿到 response 以后]
  │   负责：max_tokens 截断、正常 tool_use、正常结束
  │   │
  │   └─ if (stop_reason == "max_tokens") → 续写恢复
  │
  └─ [挂载点 3：工具执行后]
      负责：主动压缩检查、Doom Loop 检测
      │
      └─ if (estimateTokens(messages) > threshold) → 预防性压缩
```

### 4.2 恢复后的主循环

```
1. 调用模型
2. 如果调用报错 → 判断是否可恢复 → 选择恢复路径
3. 如果拿到响应 → 判断是否被截断 → 续写
4. 如果需要恢复 → 修改 messages 或等待
5. 如果不需要恢复 → 进入正常工具分支
6. 工具执行后 → 检查是否需要预防性压缩
```

---

## 五、压缩失败的降级链

压缩操作本身也会失败（如用户的单张图片就超过上下文窗口）。必须有独立的降级路径：

### 5.1 熔断器

```
连续压缩失败 >= N 次（如 3 次）
  │
  ▼ 完全停发压缩请求
  │
  └─ 接受上下文溢出风险，不再浪费 API 额度
```

**实测意义**：当用户的单张超级图片本身就超过上下文窗口时，压缩注定失败。不熔断会导致无限循环的失败 API 调用。

### 5.2 PTL 防御（Prompt Too Long Fallback）

即使脱水后，压缩请求仍可能因历史过长而报 PTL 错误：

```
PTL 错误发生
  │
  ▼ 剥洋葱式降级
  │
  ├─ 第 1 次重试：裁掉最早 20% 的消息分组
  ├─ 第 2 次重试：再裁掉 20%
  └─ 达到最大重试次数 → 返回最精简的可用结果
      （有损但能解救被锁死的会话）
```

### 5.3 脱水预处理

交付给 LLM 进行总结之前，先剔除非关键素材，防止总结请求本身 OOM：

```
原始消息 → 剔除图片/文档附件 → 替换为 [image] 文本占位
         → 剔除将被重新注入的附件
         → 脱水后的纯文本 → 送入摘要 LLM
```

---

## 六、Subagent 错误恢复

### 6.1 Subagent 失败不是主 Agent 失败

```
主 Agent 派出 Subagent
  │
  ├─ Subagent 成功 → 结果回流，继续主流程
  │
  └─ Subagent 失败 → 返回 <task-notification status="failed">
      │
      └─ 主 Agent 收到失败通知 → 决定是否重试 / 换策略 / 告知用户
```

**设计原则**：Subagent 的失败是**结构化结果**，不是异常。主 Agent 把它当作一种 tool_result 来处理，而非 try/catch。

### 6.2 Subagent 拓扑约束

```
Teammate 不能无限嵌套 Teammate
  │
  ├─ teammate 不能 spawn 其他 teammate
  ├─ in-process teammate 不能再启动 background agent
  │
  └─ 否则 agent graph 很容易失控
```

### 6.3 权限桥接的降级

Subagent 的权限请求有两种路径：

```
优先路径：借用 Leader 的权限 UI
  │
  ├─ Leader permission bridge 可用
  │   → 入队到 Leader 的 ToolUseConfirmQueue
  │   → 带 workerBadge 标识来源
  │
  └─ Leader bridge 不可用
      → 退回 Mailbox 路径
      → 发 permission request 给 Leader inbox
      → 等 Leader response
      → 应用回 Subagent 上下文
```

**双轨容灾**：权限机制也做了降级，不是单点依赖。

---

## 七、任务级恢复：失败后 Claim 下一个

在团队协作场景中，teammate 的恢复策略不是"失败了就停下来"：

```
Teammate 执行循环
  │
  ├─ 当前任务成功 → 通知 Leader → Claim 下一个任务
  │
  ├─ 当前任务失败 → 通知 Leader → Claim 下一个任务
  │
  └─ 无可 Claim 的任务 → 空闲等待
```

**设计原则**：在团队协作中，单个任务的失败不应阻塞整个团队的工作流。失败信息通过共享任务平面传递，由 Leader 决定后续策略。

---

## 八、Doom Loop 检测

### 8.1 问题

模型可能反复调用同一工具并以相同方式失败，形成死循环：
```
read_file("missing.txt") → Error: file not found
read_file("missing.txt") → Error: file not found
read_file("missing.txt") → Error: file not found
...
```

### 8.2 检测策略

```
记录最近 N 次工具调用
  │
  ├─ 同一工具名 + 相同参数 → 连续失败 M 次
  │
  └─ 主动中断 → 返回特殊提示
      "你已连续 3 次以相同参数调用 {tool_name} 且失败。
       请换一种策略或告知用户。"
```

---

## 九、恢复日志：可观测性

### 9.1 标签化日志

```
[Recovery] continue (1/3)
[Recovery] compact
[Recovery] backoff (2/3)
[Recovery] prompt too long. Compacting...
[Error] max_tokens recovery exhausted (3 attempts). Stopping.
[Error] API call failed after 3 retries: rate_limit_error
[CircuitBreaker] Auto-compact consecutive failures: 3. Halting.
[PTL] Peeling 20% oldest messages for retry.
```

### 9.2 恢复指标

| 指标 | 用途 |
|------|------|
| 续写恢复触发次数 | 评估 max_tokens 设置是否合理 |
| 压缩恢复触发次数 | 评估上下文管理策略 |
| 退避重试触发次数 | 评估 API 稳定性 |
| 熔断器触发次数 | 评估是否有不可恢复的上下文问题 |
| Doom Loop 中断次数 | 评估模型决策质量 |
| 平均恢复延迟 | 评估恢复机制对用户体验的影响 |

---

## 十、机制设计特点总结

| 特性 | 实现方式 | Harness 意义 |
|------|----------|-------------|
| 四层错误模型 | 传输/上下文/工具/Agent 层独立分类 | 恢复策略精确匹配错误类型 |
| 独立恢复预算 | 每种错误类型独立计数 | 防止跨类型预算污染 |
| 续写提示精确化 | 明确告知"不要重复、不要重头" | 避免模型重复输出 |
| 压缩后续场声明 | 摘要后告知"这是前文摘要" | 避免模型重新向用户提问 |
| 熔断器 | 连续失败 N 次后停止压缩 | 防止死循环浪费 API 额度 |
| PTL 降级 | 剥洋葱式裁剪 + 有损重试 | 解救被锁死的会话 |
| 脱水预处理 | 剔除图片/重注入附件后再总结 | 防止摘要请求本身 OOM |
| Subagent 失败结构化 | 失败作为 task-notification 而非异常 | 主 Agent 可理性决策后续动作 |
| 拓扑约束 | teammate 不能嵌套、不能后台再后台 | 防止 agent graph 失控 |
| 权限桥接双轨 | Leader UI 优先 + Mailbox 降级 | 权限机制单点容灾 |
| 任务级恢复 | 失败后 Claim 下一个任务 | 单任务失败不阻塞团队 |
| Doom Loop 检测 | 同工具同参数连续失败 → 主动中断 | 防止模型陷入重复失败循环 |
| 退避 + 抖动 | 指数退避 + random jitter | 防止雷群效应 |
| 预防性压缩 | 工具执行后检查 Token 阈值 | 在出错前主动瘦身 |
| 标签化日志 | `[Recovery]`/`[Error]`/`[CircuitBreaker]` 前缀 | 恢复过程可观测、可调试 |