# Agent 上下文压缩功能

## 概述

在长期对话中，随着消息累积，上下文 token 占用会持续增长，导致响应变慢和成本增加。HomeTale 实现了多层压缩策略来优化上下文管理。

## 两层压缩策略

### 1. Micro-Compact（微型压缩）

**触发时机**：每次处理消息时自动执行

**压缩目标**：清理旧的 `tool_result` 内容

**策略**：
- 遍历消息中的 `tool_result`
- 除最后 N 个（默认 3）外，将内容替换为 `[Previous: used {tool_name}]`
- 保留 `read_file` 等参考性工具的完整输出
- 跳过过短的内容（默认 < 100 字符）

**实现位置**：`server/src/agent-core/context-compact/micro-compact.ts`

```typescript
export function microCompact(
  messages: any[],
  config: MicroCompactConfig = {}
): any[]
```

**配置选项**：
| 参数 | 默认值 | 说明 |
|------|--------|------|
| `keepRecentToolResults` | 3 | 保留最近的 tool_result 数量 |
| `preserveToolNames` | ['read_file'] | 不压缩的工具名称列表 |
| `minContentLength` | 100 | 小于此长度不压缩（字符数） |

### 2. Auto-Compact（自动压缩）

**触发时机**：当 token 数量超过阈值（默认 50000）

**压缩目标**：生成对话总结，替换早期历史

**策略**：
- 使用 LLM 生成结构化总结（已完成工作、当前状态、重要决策、待办事项）
- 插入压缩标记到数据库
- 保留最近 N 条消息（默认 5）
- 熔断器保护：连续失败 3 次后停止尝试

**实现位置**：`server/src/agent-core/context-compact/auto-compact.ts`

```typescript
export class CompactionManager {
  async compactIfNeeded(
    messages: any[],
    sessionId: string,
    roleId: string
  ): Promise<CompactionResult>
}
```

**配置选项**：
| 参数 | 默认值 | 说明 |
|------|--------|------|
| `tokenThreshold` | 50000 | Token 阈值 |
| `keepRecentMessages` | 5 | 压缩后保留的消息数 |
| `maxConsecutiveFailures` | 3 | 连续失败熔断阈值 |
| `maxSummaryLength` | 2000 | 总结最大长度（token） |

## 压缩标记系统

### 数据库存储

压缩标记存储在 `messages` 表中，字段：
- `is_compaction_marker`: 标记是否为压缩消息
- `compaction_meta`: JSON 格式，包含 `{ summary, originalCount, compactedAt }`

### 智能加载机制

`getContextMessages` 函数支持检测和处理压缩标记：

```typescript
export function getContextMessages(
  sessionId: string,
  options: ContextMessagesOptions = {}
): Message[]
```

**加载选项**：
- `baseLimit`: 基础消息数量（默认 20）
- `expandCompressed`: 是否展开压缩标记（默认 false）
- `maxTokens`: 最大 token 限制

**行为逻辑**：
1. 加载最近的消息
2. 检测是否存在压缩标记
3. 如果 `expandCompressed=true`，加载压缩标记前的历史消息
4. 应用 token 截断（如有）

## Token 估算

由于不使用实际的 tokenizer，采用保守估算：

```typescript
// 1 token ≈ 4 字符（中英文混合）
export function estimateTokens(messages: any[]): number
export function estimateMessageTokens(message: any): number
```

**注意**：这是粗略估算，实际 token 数量可能有所不同，但足够用于阈值判断。

## 手动压缩工具

通过 `compact` skill 支持手动触发压缩：

```typescript
// Skill 参数
{
  focus?: string;    // 压缩时希望保留的重点信息
  keepRecent?: number;  // 压缩后保留的最近消息数，默认 5
}
```

**实现位置**：`server/src/skills/defaults/compact/`

## 使用示例

### 在 Family Agent 中集成

```typescript
// 1. 加载历史消息
let messages = getContextMessages(sessionId, {
  baseLimit: 20,
  expandCompressed: false
});

// 2. Micro-compact（自动执行）
messages = microCompact(messages);

// 3. Auto-compact（检查阈值）
const compactionManager = new CompactionManager(config, AUTO_COMPACT_CONFIG);
const compactResult = await compactionManager.compactIfNeeded(
  messages,
  sessionId,
  roleId
);

if (compactResult.wasCompacted) {
  messages = compactResult.newMessages;
  console.log(`Compressed! Summary length: ${compactResult.summary?.length}`);
}
```

### 手动触发压缩

```
用户: 对话太长了，帮我压缩一下，保留当前任务状态
Agent: [调用 compact 工具，focus="保留当前任务状态"]
```

## 实现技巧

### 1. 深拷贝避免修改原始数据

```typescript
const result = JSON.parse(JSON.stringify(messages));
```

### 2. 熔断器模式

避免连续失败导致的性能问题：

```typescript
if (this.isCircuitBreakerOpen()) {
  return { wasCompacted: false, newMessages: messages };
}
```

### 3. 限制总结输入长度

避免总结 API 本身超限：

```typescript
const maxInputLength = 80000; // 约 20000 tokens
const truncatedText = conversationText.length > maxInputLength
  ? conversationText.slice(-maxInputLength)
  : conversationText;
```

### 4. 结构化总结提示词

确保重要信息不丢失：

```
总结这段对话，保留以下关键信息：
1. **已完成的工作**：哪些任务已经完成？
2. **当前状态**：现在在做什么？有哪些活跃的文件或工具？
3. **重要决策**：做出了哪些关键决定？
4. **待办事项**：还有哪些任务需要完成？
```

## 性能优化建议

1. **Micro-Compact 优先**：每次都执行，成本极低
2. **Auto-Compact 熔断**：连续失败后暂停，避免浪费 API 调用
3. **智能消息加载**：默认不展开压缩标记，按需展开
4. **Token 预估保守**：使用保守估算，避免实际超限

## 相关文件

| 文件 | 说明 |
|------|------|
| `server/src/agent-core/context-compact/index.ts` | 模块入口 |
| `server/src/agent-core/context-compact/micro-compact.ts` | 微型压缩 |
| `server/src/agent-core/context-compact/auto-compact.ts` | 自动压缩 |
| `server/src/agent-core/context-compact/token-estimator.ts` | Token 估算 |
| `server/src/db/message-db.ts` | 消息数据库和智能加载 |
| `server/src/agents/family-agent.ts` | Agent 集成示例 |
| `server/src/skills/defaults/compact/` | 手动压缩 Skill |

---

# 通用 Agent Harness 设计思路

## 设计哲学

上下文窗口是 Agent 最稀缺的运行时资源。Harness 的核心命题不是"超限就截断"，而是构建一套**监控 → 预测 → 压缩 → 补偿 → 降级**的完整生命周期管理链路，确保 Agent 在长对话中既不丢失关键状态，也不因上下文溢出而崩溃。

关键洞察：
- 上下文预算需要**预留扣减**，而非全量开放给 Agent 自由写入
- 压缩不是简单的文本缩短，而是**状态提取 + 重建补偿**的双向工程
- 极端情况下必须有**熔断降级**机制，防止死循环消耗 API 额度

---

## 一、上下文额度的预算制分配

### 1.1 有效窗口 ≠ 总窗口

不应将模型的全量上下文窗口开放给 Agent 自由使用，而应进行严格的预留扣减：

```
模型总上下文窗口 (如 200k)
  │
  ├─ 预留给 Summary 输出的 Token（如 20k）
  │   └─ 为什么：压缩时需要调用 LLM 生成摘要，
  │       摘要请求本身也要消耗上下文空间
  │
  └─ Agent 有效可用窗口 = 总窗口 - 预留量
```

**设计原则**：在计算"是否需要压缩"时，阈值基准是**有效窗口**而非总窗口。这保证了压缩触发时，API 仍有足够空间容纳历史对话 + 摘要提示词。

### 1.2 输出 Token 的效率优化

Agent 向 API 发送请求时的 `max_tokens` 不应无脑设为模型最大值：

```
默认 max_tokens = 8,000（覆盖 p99 业务需求）
  │
  ├─ 99% 的请求在此范围内正常完成
  │
  └─ 截断时 → 干净重试，escalate 到 64,000
```

**Harness 意义**：过大的 `max_tokens` 会导致服务端 Slot 预约浪费（8-16x 过度预留）。以实际业务分位数为基准设默认值，截断时再升级，是最优的工程平衡。

---

## 二、压缩触发策略：前置缓冲 + 熔断器

### 2.1 双重触发保证

```
每轮 API 调用后
  │
  ▼ 获取 token 消耗计数
  │
  ├─ 检查：当前消耗 + 缓冲量 ≥ 有效窗口？
  │   └─ 缓冲量（如 13,000 token）= 前置余量
  │       保证在"快要满"时就触发，而非"已经满了"才动作
  │
  └─ 是 → 触发 Auto-Compact
      否 → 继续正常对话
```

### 2.2 熔断器：防止死循环

```typescript
// 连续压缩失败达到上限（如 3 次）后，完全停发压缩请求
if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
  return { wasCompacted: false }  // 放弃压缩，接受上下文溢出风险
}
```

**为什么关键**：当用户的单张图片或超长文件本身就超过上下文窗口时，压缩注定失败。不熔断会导致无限循环的失败 API 调用，每次都浪费大量 Token 额度。实测数据表明，这个小判断每天可为大盘省下约 250K 次死锁 API 调用。

---

## 三、压缩执行：脱水 → 总结 → 补偿

### 3.1 脱水：在总结前清理低价值负载

交付给 LLM 进行总结之前，先剔除非关键素材，防止总结请求本身因体积过大而 OOM：

```
原始消息序列
  │
  ├─ 剔除图片/文档附件 → 替换为 [image] / [document] 文本占位
  │   └─ 原因：多模态内容占 Token 巨大，但对摘要无用
  │
  ├─ 剔除将被重新注入的附件（如 Skill Discovery 结果）
  │   └─ 原因：这些内容压缩后会被完整重新附加，
  │       如果不剔除会导致"旧版本 + 新版本"双重存在，产生幻觉
  │
  └─ 输出：脱水后的纯文本消息序列 → 送入摘要 LLM
```

### 3.2 总结：利用 Prompt Cache 复用

```
主对话上下文（已缓存于 API 侧）
  │
  └─ Forked Agent 借用主对话的 Prompt Cache
      │
      └─ 省去压缩时所需的极大头部填充 Token 开销
```

**Harness 意义**：压缩通常在独立的 Forked Agent 中执行。如果该 Agent 能复用主对话的 Prompt Cache，可大幅降低压缩操作本身的 Token 成本。

### 3.3 PTL 防御：总结请求也超限时的降级

即使脱水后，总结请求仍可能因历史过长而报 `Prompt Too Long`：

```
PTL 错误发生
  │
  ▼ 剥洋葱式降级
  │
  ├─ 第 1 次重试：裁掉最早 20% 的消息分组
  │
  ├─ 第 2 次重试：再裁掉 20%
  │
  └─ 达到最大重试次数 → 返回最精简的可用结果
      （有损但能解救被锁死的会话）
```

---

## 四、状态重启点补偿：压缩不是遗忘

### 4.1 补偿清单

压缩完成后，原本长长的消息列表被替换为一条精简的 Summary Message。但 Agent 的工作状态不能断裂，以下内容必须**重新注入**：

| 补偿项 | 来源 | 为什么必须补偿 |
|--------|------|---------------|
| **正在查看的文件内文** | 压缩前的文件读取状态 | Agent 正在编辑的文件内容不能丢失 |
| **正在进行的 Plan** | 活跃 Plan 状态 | 当前任务的步骤和进度不能断裂 |
| **仍然激活的 Skill** | 已披露的 Skill 列表 | 已加载的领域能力不能被"收回" |
| **Deferred Tool Delta** | 工具协议变更 | 新增/移除的工具声明必须保留 |
| **MCP Server 声明** | 活跃的外部工具 | 外部能力连接不能断开 |

### 4.2 压缩后的上下文结构

```
[System 边界宣告]
  +
[精简文本摘要] ———— 压缩产物，替代了冗长的旧历史
  +
[正在查看的文件内文截取] ———— 补偿
  +
[正在做的 Plan] ———— 补偿
  +
[仍然激活的 MCP / Tools 完整声明] ———— 补偿
```

**设计原则**：Agent 释放了冗余庞大的旧文本历史，却依然如同"身处工作台旁边且手持刚刚用到的工具"，完全无缝连接下一轮输入。

---

## 五、微压缩：渐进式瘦身

### 5.1 与自动压缩的分工

| 维度 | 微压缩 (Micro-Compact) | 自动压缩 (Auto-Compact) |
|------|----------------------|------------------------|
| 触发时机 | 每轮对话后 | Token 超阈值时 |
| 成本 | 几乎为零（纯本地操作） | 需调用 LLM 生成摘要 |
| 目标 | 清理旧的 `tool_result` 内容 | 生成对话总结替换早期历史 |
| 保留策略 | 最近 N 个 tool_result 完整保留 | 最近 N 条消息完整保留 |

### 5.2 微压缩的智能保留

```
遍历消息中的 tool_result
  │
  ├─ 最近 3 个 → 完整保留
  │
  ├─ read_file 等参考性工具 → 完整保留（模型可能还在引用）
  │
  ├─ 内容 < 100 字符 → 跳过（压缩收益太小）
  │
  └─ 其余 → 替换为 [Previous: used {tool_name}]
```

**Harness 意义**：微压缩是零成本的第一道防线，应优先于高成本的自动压缩执行。它确保模型仍能感知"之前用过什么工具"，但不必携带完整的输出内容。

---

## 六、Token 估算：保守即安全

```
实际 Token 计算（需要 tokenizer）
  │
  └─ 成本高，引入外部依赖

保守估算（1 token ≈ 4 字符，中英文混合）
  │
  └─ 成本低，足够用于阈值判断
  └─ 估算偏高 = 触发压缩更早 = 更安全
```

**设计原则**：用于压缩触发判断的 Token 估算，宁可偏高也不偏低。偏高只会更早触发压缩（稍浪费），偏低会导致真实超限（致命）。

---

## 七、机制设计特点总结

| 特性 | 实现方式 | Harness 意义 |
|------|----------|-------------|
| 预算制分配 | 有效窗口 = 总窗口 - 预留量 | 保证压缩时 API 有空间执行摘要 |
| 输出效率优化 | 默认 max_tokens 按 p99 设定，截断时升级 | 节约 Slot 预约开销 |
| 前置缓冲触发 | 距窗口上界 13k 时即触发压缩 | 宁可早压缩，不可晚溢出 |
| 熔断器 | 连续失败 N 次后停止压缩 | 防止死循环浪费 API 额度 |
| 脱水预处理 | 剔除图片/重注入附件后再总结 | 防止摘要请求本身 OOM |
| Prompt Cache 复用 | Forked Agent 共享主对话缓存 | 降低压缩操作 Token 成本 |
| PTL 降级 | 剥洋葱式裁剪 + 有损重试 | 解救被锁死的会话 |
| 状态重启补偿 | 压缩后重新注入文件/Plan/Skill/Tools | 压缩不遗忘，无缝衔接 |
| 微压缩优先 | 每轮零成本清理旧 tool_result | 第一道防线，减少自动压缩触发频率 |
| 保守估算 | Token 估算偏高 | 早触发 > 晚溢出 |