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