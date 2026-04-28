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