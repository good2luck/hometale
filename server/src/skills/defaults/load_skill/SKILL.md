---
id: load_skill
name: 加载技能
version: 1.0.0
description: 按需加载指定 Skill 的详细使用说明和工作流指南
category: meta
author: hometale

disclosure:
  discoverable: true
  keywords: ['加载技能', '查看技能', 'load skill', 'skill', '技能详情']
  triggers: ['加载技能', '查看技能详情', '怎么用']
  autoActivateOnTrigger: false
  level: onKeyword

security:
  requiresConfirmation: false
  allowedRoles: ['*']
  level: safe
---

# 加载技能 Skill

这是一个元技能(Meta Skill),用于按需加载其他 Skill 的完整使用说明。
系统提示中只展示各 Skill 的简要描述(低成本),需要时调用此工具获取完整内容。

## 使用场景

- 当你需要了解某个 Skill 的详细工作流和注意事项时
- 当用户询问某个功能如何使用时
- 当你不确定某个 Skill 的边界情况或参数细节时
