---
id: get_current_time
name: 获取当前时间
version: 1.0.0
description: 获取系统当前的日期和时间
category: utility
author: hometale

disclosure:
  discoverable: true
  keywords: ['时间', '日期', '星期', '几点', 'clock', 'time', 'date']
  triggers: ['几点', '现在时间', '今天几号', '今天星期几']
  autoActivateOnTrigger: true
  level: always

security:
  requiresConfirmation: false
  allowedRoles: ['*']
  level: safe
---

# 获取当前时间 Skill

获取系统当前的日期和时间信息。

## 参数指南

- `timezone`：时区，默认 `Asia/Shanghai`（中国标准时间）
- `format`：输出格式
  - `full`（默认）：完整日期时间，如"2026年4月25日星期六 下午3点30分00秒"
  - `short`：简短日期时间，如"2026/04/25 15:30"
  - `time`：仅时间，如"下午3点30分00秒"
  - `date`：仅日期，如"2026年4月25日星期六"

## 注意事项

- 默认返回中国时区时间
- 返回的是服务器当前时间，非用户本地时间
