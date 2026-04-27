# Agent 错误发现与处理

本文档说明 HomeTale 中 Agent 的错误发现、恢复和报告机制。

## 概述

在 Agent 运行过程中，可能会遇到各种错误情况：
- LLM 调用失败（网络、限流、API 错误）
- 工具执行失败（权限、文件不存在、超时）
- 消息解析错误（格式错误、非法字符）
- 状态不一致（会话过期、角色不存在）

设计错误处理机制的目标：
1. 优雅降级，不影响用户体验
2. 详细的错误信息用于调试
3. 可恢复的自动重试机制
4. 清晰的用户反馈

## 错误分类

### 1. LLM 调用错误

| 错误类型 | 原因 | 处理策略 |
|----------|------|----------|
| 网络超时 | 网络问题 | 重试 3 次，每次延迟递增 |
| API 限流 | 请求过多 | 等待重试窗口后重试 |
| 认证失败 | API Key 无效 | 返回明确错误，提示用户检查配置 |
| 模型不存在 | 模型名称错误 | 返回可用模型列表 |
| 内容过滤 | 触发内容策略 | 简化提示后重试 |

### 2. 工具执行错误

| 错误类型 | 原因 | 处理策略 |
|----------|------|----------|
| 权限拒绝 | 路径沙箱或角色权限 | 返回 `[ERROR]` 前缀，模型感知 |
| 文件不存在 | 目标文件不存在 | 返回 `[ERROR]` 前缀 |
| 危险命令 | 黑名单拦截 | 返回 `[ERROR]` 前缀，记录安全日志 |
| 超时 | 命令执行过久 | 终止进程，返回部分结果或错误 |

### 3. 状态错误

| 错误类型 | 原因 | 处理策略 |
|----------|------|----------|
| 会话过期 | Session 超过有效期 | 重新认证或创建新会话 |
| 角色不存在 | 角色 ID 无效 | 重新识别角色或创建新角色 |
| 配置缺失 | config.json 不完整 | 使用默认配置并提示 |

## 实现位置

### 错误传播链

```
LLM 调用 (llm-client.ts)
    ↓ try-catch
工具执行 (file-tools.ts, skills/*)
    ↓ [ERROR] 前缀
消息处理 (message-handler.ts)
    ↓ 用户反馈
WebSocket 客户端
```

### 关键文件

| 文件 | 职责 |
|------|------|
| `server/src/agents/llm-client.ts` | LLM 调用错误捕获和重试 |
| `server/src/agent-core/tools/safety-checks.ts` | 危险命令检测 |
| `server/src/agent-core/tools/permissions.ts` | 权限验证错误返回 |
| `server/src/agent-core/message-handler.ts` | 消息处理错误反馈 |
| `server/src/websocket/websocket-session.ts` | 错误消息发送 |

## 错误消息格式

### 工具错误（返回给 LLM）

```
[ERROR] 不允许读取文件: /path/to/file
[ERROR] 文件不存在: roles/dad/memory/MEMORY.md
[ERROR] 危险命令已被阻止: rm -rf /
```

### 用户可见错误（通过 WebSocket）

```typescript
{
  type: 'error',
  data: {
    code: 'AUTH_FAILED' | 'MODEL_ERROR' | 'TOOL_ERROR',
    message: '用户友好的错误描述',
    details?: '技术细节（仅开发模式）'
  }
}
```

## 错误恢复策略

### 1. 自动重试

```typescript
async function callLLMWithRetry(config, messages, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await callLLM(config, messages);
    } catch (err) {
      if (isRetryable(err) && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}
```

### 2. Doom Loop 检测

连续调用同一工具失败时，主动中断：

```typescript
if (detectToolLoop(recentToolCalls, tool.name)) {
  return `[ERROR] 工具调用进入循环，已自动终止`;
}
```

### 3. 熔断器模式

连续失败 N 次后暂停，避免浪费资源：

```typescript
class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private threshold = 3;
  private timeout = 60000; // 1 分钟

  async execute(fn) {
    if (this.isOpen() && Date.now() - this.lastFailureTime < this.timeout) {
      throw new Error('Circuit breaker is open');
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }
}
```

## 用户反馈最佳实践

### 清晰的错误描述

| 错误 | 好的反馈 | 坏的反馈 |
|------|----------|----------|
| API Key 无效 | "配置的 API Key 无效，请在 config.json 中检查" | "Error 401" |
| 网络超时 | "网络连接超时，正在重试..." | "fetch failed" |
| 文件写入失败 | "记忆保存失败，可能影响后续对话" | "[ERROR]" |

### 操作指引

```typescript
// 在消息中附带恢复建议
session.send({
  type: 'error',
  data: {
    message: '记忆保存失败',
    suggestion: '请检查 ~/.hometale 目录权限，或稍后重试'
  }
});
```

## 日志记录

### 错误日志级别

| 级别 | 用途 | 示例 |
|------|------|------|
| ERROR | 致命错误，需要人工干预 | API Key 无效 |
| WARN | 可恢复的错误，需要注意 | 工具调用失败（有重试） |
| INFO | 正常的错误处理流程 | 自动重试中... |
| DEBUG | 详细错误栈（开发模式） | 完整错误对象 |

### 日志格式

```typescript
logger.error('llm_call_failed', {
  provider: config.provider,
  model: config.model,
  error: err.message,
  stack: err.stack,
  retry: attemptIndex + 1
});
```

## 测试要点

### 单元测试
- 模拟各种 LLM 错误响应
- 测试重试逻辑正确性
- 测试熔断器状态转换

### 集成测试
- 测试权限错误时的完整流程
- 测试网络恢复后的自动重连
- 测试用户错误反馈的正确展示

## 相关文件

| 文件 | 说明 |
|------|------|
| `server/src/agents/llm-client.ts` | LLM 调用与错误处理 |
| `server/src/agent-core/tools/safety-checks.ts` | 危险命令黑名单 |
| `server/src/agent-core/tools/permissions.ts` | 权限验证 |
| `server/src/agent-core/message-handler.ts` | 消息处理 |
| `server/src/websocket/websocket-session.ts` | 错误消息发送 |