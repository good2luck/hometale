---
id: summarize_memory
name: 总结记忆
version: 1.0.0
description: 总结对话并更新记忆系统
category: memory
author: hometale

disclosure:
  discoverable: true
  keywords: ['总结', '回顾', '记忆', 'summarize', 'summary', 'memory']
  triggers: ['总结一下', '回顾今天', '更新记忆', '总结记忆']
  autoActivateOnTrigger: true
  level: onKeyword

security:
  requiresConfirmation: false
  allowedRoles: ['*']
  level: safe
---

# 总结记忆 Skill

总结对话记录并更新记忆系统。当用户说"总结一下"、"回顾今天"、"更新记忆"等时使用此工具。

## 工作流程

1. 默认执行 `summarize_today_and_update`：先总结今日对话，再更新长期记忆
2. 如果用户只想看总结不需要更新：使用 `summarize_today` 或 `summarize_date`
3. 如果用户只想更新长期记忆：使用 `update_long_term`

## 参数指南

- `action`：操作类型
  - `summarize_today_and_update`（默认）：总结今天 + 更新长期记忆
  - `summarize_today`：仅总结今天的对话
  - `summarize_date`：总结指定日期的对话（需提供 `date`）
  - `update_long_term`：仅更新长期记忆
- `date`：指定日期（YYYY-MM-DD 格式），仅在 `action=summarize_date` 时需要

## 注意事项

- 总结过程需要调用 LLM，可能需要几秒钟
- 如果没有新内容可总结，会返回提示信息
- 同一时间只允许一个总结操作运行（有锁机制）
- 必须先进行每日总结，才能更新长期记忆
