---
id: search_memory
name: 搜索记忆
version: 1.0.0
description: 搜索当前角色的记忆内容
category: memory
author: hometale

disclosure:
  discoverable: true
  keywords: ['搜索记忆', '找一下', '查找', 'search', 'memory', '回忆']
  triggers: ['搜索记忆', '找一下', '回忆一下']
  autoActivateOnTrigger: true
  level: onKeyword

security:
  requiresConfirmation: false
  allowedRoles: ['*']
  level: safe
---

# 搜索记忆 Skill

在当前角色的记忆文件中搜索关键词。

## 工作流程

1. 确认要搜索的角色（默认当前角色）
2. 提取用户意图中的关键词，越具体越好
3. 如果首次搜索无结果，尝试同义词或更短的关键词重新搜索

## 参数指南

- `keyword`：搜索关键词。避免过于模糊的词（如"那个"、"什么"），优先使用具体名词
- `limit`：返回结果数量，默认 10。用户要求"所有"时可设为 50

## 注意事项

- 搜索是在角色的记忆文件（MEMORY.md、日记等）中进行全文匹配
- 结果格式为 `[文件名:行号] 匹配内容`
- 搜索不区分大小写
- 如果搜索无结果，告知用户并建议换个关键词
