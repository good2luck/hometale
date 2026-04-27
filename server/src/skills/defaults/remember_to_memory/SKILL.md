---
id: remember_to_memory
name: 记忆一下
version: 1.0.0
description: 将重要内容记录到长期记忆中
category: memory
author: hometale

disclosure:
  discoverable: true
  keywords: ['记忆一下', '记住', '记录', 'remember', 'memory', '记下来']
  triggers: ['记忆一下', '记住这个', '记下来']
  autoActivateOnTrigger: true
  level: onKeyword

security:
  requiresConfirmation: false
  allowedRoles: ['*']
  level: safe
---

# 记忆一下 Skill

将用户指定的内容记录到当前角色的长期记忆 MEMORY.md 中。

## 工作流程

1. 提取用户要记录的核心内容
2. 默认由 AI 先总结整理内容，再写入长期记忆（`shouldSummarize=true`）
3. 如果用户已提供清晰摘要，可设 `shouldSummarize=false` 直接记录

## 参数指南

- `content`：要记录的内容。可以是原始对话、事件描述、重要信息等
- `shouldSummarize`：是否由 AI 先总结再记录，默认 true
  - true：AI 会整理成要点格式，提取关键信息
  - false：直接原样记录，适用于用户已提供结构化内容

## 注意事项

- 记录时会自动添加时间戳
- 内容会追加到 MEMORY.md 文件末尾
- 适合记录：生日、纪念日、重要事件、偏好、约定等
- 不适合记录：临时性对话、无关紧要的细节
