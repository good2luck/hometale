---
id: calculate
name: 数学计算
version: 1.0.0
description: 执行数学表达式计算
category: utility
author: hometale

disclosure:
  discoverable: true
  keywords: ['计算', '算一下', '数学', 'math', 'calculate', '加减乘除']
  triggers: ['计算', '算一下', '等于']
  autoActivateOnTrigger: true
  level: always

security:
  requiresConfirmation: false
  allowedRoles: ['*']
  level: safe
---

# 数学计算 Skill

执行数学表达式计算，支持加减乘除、括号等运算。

## 参数指南

- `expression`：数学表达式，如 `25 * 4 + 10`、`(100 - 20) / 4`
- 支持的运算符：`+`、`-`、`*`、`/`、`%`（取余）、`()`（括号）

## 注意事项

- 只支持纯数学运算，不支持变量或函数
- 表达式中的非数学字符会被自动过滤
- 如果计算结果无效（如除以零），会返回错误提示
