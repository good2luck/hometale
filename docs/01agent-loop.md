# 通用 Agent Loop 实现机制

Agent Loop（智能体循环）是 Agent 架构的核心：模型生成响应 → 检测到工具调用 → 执行工具 → 结果回传模型 → 模型继续生成。直到模型不再需要工具，自然停止。

## 两种实现模式

### 模式一：手写循环（ReAct）

```
for round = 1..MAX_ROUNDS:
    response = callLLM(messages)
    if response has tool_calls:
        results = execute_tools(tool_calls)
        messages += [assistant(response), user(results)]
    else:
        return response
```

**问题**：
- 需要 prompt 让模型输出固定 JSON 格式，再用正则解析
- 工具结果是纯文本塞回 messages，模型理解成本高
- 流式输出需要先读完再判断类型，实时性被破坏
- 手动管理消息历史，容易出错

### 模式二：AI SDK 自动循环（推荐）

```ts
const result = streamText({
  model,
  messages,
  tools,           // ToolSet：每个工具带 Zod schema + execute
  maxSteps: 10,    // 安全阀
});

for await (const part of result.fullStream) {
  switch (part.type) {
    case 'text-delta':    // 实时文本块
    case 'tool-call':     // 工具调用开始
    case 'tool-result':   // 工具执行结果
  }
}
```

AI SDK 自动处理：工具调用 → 执行 → 结果回传 → 继续生成，直到模型自主决定停止或达到 `maxSteps`。

## 通用实现

```ts
// 1. 定义工具
const tools: ToolSet = {
  readFile: tool({
    description: '读取文件',
    parameters: z.object({ path: z.string() }),
    execute: async ({ path }) => fs.readFile(path, 'utf-8'),
  }),
};

// 2. 创建 Provider（支持多 LLM）
function createModel(config: ModelConfig) {
  if (config.provider === 'anthropic') {
    return createAnthropic({ apiKey: config.apiKey }).languageModel(config.model);
  }
  return createOpenAICompatible({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  }).chatModel(config.model);
}

// 3. Agent Loop
export async function* runAgentStream(
  config: ModelConfig,
  userMessage: string,
) {
  const model = createModel(config);

  const result = streamText({
    model,
    system: '你是一个助手...',
    messages: [{ role: 'user', content: userMessage }],
    tools,
    maxSteps: 10,
  });

  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta':
        yield { type: 'text', content: part.textDelta };
        break;
      case 'tool-call':
        yield { type: 'tool_call_started', ... };
        break;
      case 'tool-result':
        yield { type: 'tool_call_completed', ... };
        break;
      case 'error':
        yield { type: 'text', content: '处理出错' };
        break;
    }
  }
}
```

## 关键注意事项

1. **Provider 版本对齐**
   - `ai` 包、`@ai-sdk/openai-compatible`、`@ai-sdk/anthropic` 必须版本兼容
   - v4 用 `maxSteps`，v5+ 用 `stopWhen: isStepCount(N)`
   - `AnthropicProvider` 只有 `languageModel()`，`OpenAICompatibleProvider` 有 `chatModel()`

2. **工具定义格式**
   - v4: `tool({ description, parameters: z.object({...}), execute })`
   - v5+: `tool({ description, inputSchema: z.object({...}), execute })` — 注意字段名变化
   - `execute` 返回值会被自动序列化回传给模型

3. **Doom Loop 防护**
   - 模型可能陷入连续调用同一工具的循环
   - 维护最近 N 次工具调用记录，检测到重复时主动中断
   - 可以在 `onStepFinish` 回调或自定义循环中实现

4. **流式事件映射**
   - AI SDK 的 `fullStream` 事件（`text-delta`, `tool-call`, `tool-result`）
   - 需要映射到前端理解的事件格式（如 WebSocket 的 `message_chunk`, `tool_call`）
   - 保持前端协议不变，只替换后端实现

5. **权限注入**
   - 工具执行通常需要上下文（如当前用户 ID、角色权限）
   - 通过闭包将上下文注入 `execute` 函数，而非全局变量

## 好处

| 方面 | 手写循环 | AI SDK 自动循环 |
|------|---------|----------------|
| 工具调用准确率 | 依赖 prompt + 正则解析，错误率高 | API 原生 tool_use，模型专门训练 |
| 流式输出 | 先读完全部内容再判断，无法实时 | 文本和工具事件即时推送 |
| 代码量 | ~200 行解析容错代码 | 一行 `streamText` |
| 多步循环 | 手动管理消息历史 | 自动执行、回传、继续 |
| 多 LLM 兼容 | 每个 provider 单独适配 | 统一 `streamText` API |
| 工具结果格式 | 纯文本 `[TOOL RESULT] name: result` | 结构化 `tool_result` 消息块 |

## 迁移路径

如果已有手写循环，迁移步骤：

1. 安装 `@ai-sdk/openai-compatible` 和 `@ai-sdk/anthropic`
2. 将工具从文本描述格式改为 `tool({ parameters, execute })`
3. 删除 JSON 解析、类型检测、回放流等代码
4. 用 `streamText` + `fullStream` 替换 `for` 循环
5. 保留增值功能：Doom Loop 检测、权限注入、系统提示词构建
