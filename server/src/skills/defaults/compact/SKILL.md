---
name: compact
id: compact
description: 手动触发上下文压缩，生成对话总结
category: utility
author: hometale
disclosure:
  discoverable: true
  keywords: [压缩, 总结, compact, context]
security:
  level: safe
---

# Compact 工具

当对话变得很长，token 占用较高时，可以使用此工具手动压缩上下文。

## 使用场景

- 对话历史过长，响应变慢
- 需要总结之前的讨论内容
- 准备开始新的话题，希望清理旧历史

## 参数

- `focus` (可选): 压缩时希望保留的重点信息，如 "保留当前代码状态"
- `keepRecent` (可选): 压缩后保留的最近消息数，默认 5

## 注意事项

压缩后，早期的详细消息会被总结替代，但会保留压缩标记以便恢复。
压缩标记会保存到数据库中，以便后续智能加载历史消息。

## 示例

```
用户: 请帮我压缩一下对话，保留当前任务状态
Agent: [调用 compact 工具]
```

```
用户: 对话太长了，压缩一下
Agent: [调用 compact 工具，focus="保留当前任务状态"]
```
