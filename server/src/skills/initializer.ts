import path from 'node:path';
import fs from 'node:fs';
import { getSkillsPath, ensureDir } from '../lib/hometale-path.js';

// 默认 Skills 的数据嵌入到代码中
const DEFAULT_SKILLS: Record<string, {
  'SKILL.md': string;
  'tool.json': string;
  'executor.js'?: string;
}> = {
  'get_current_time': {
    'SKILL.md': `---
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

- \`timezone\`：时区，默认 \`Asia/Shanghai\`（中国标准时间）
- \`format\`：输出格式
  - \`full\`（默认）：完整日期时间，如"2026年4月25日星期六 下午3点30分00秒"
  - \`short\`：简短日期时间，如"2026/04/25 15:30"
  - \`time\`：仅时间，如"下午3点30分00秒"
  - \`date\`：仅日期，如"2026年4月25日星期六"

## 注意事项

- 默认返回中国时区时间
- 返回的是服务器当前时间，非用户本地时间
`,
    'tool.json': JSON.stringify({
      name: 'get_current_time',
      description: '获取当前的日期和时间',
      inputSchema: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: '时区，默认 Asia/Shanghai',
            default: 'Asia/Shanghai'
          },
          format: {
            type: 'string',
            description: '输出格式：full/short/time/date',
            enum: ['full', 'short', 'time', 'date'],
            default: 'full'
          }
        }
      }
    }, null, 2),
    'executor.js': `// 此 Skill 的执行器已内置在服务器代码中
export async function execute(params, context) {
  throw new Error('This skill uses built-in executor');
}
`
  },
  'calculate': {
    'SKILL.md': `---
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

- \`expression\`：数学表达式，如 \`25 * 4 + 10\`、\`(100 - 20) / 4\`
- 支持的运算符：\`+\`、\`-\`、\`*\`、\`/\`、\`%\`（取余）、\`()\`（括号）

## 注意事项

- 只支持纯数学运算，不支持变量或函数
- 表达式中的非数学字符会被自动过滤
- 如果计算结果无效（如除以零），会返回错误提示
`,
    'tool.json': JSON.stringify({
      name: 'calculate',
      description: '执行数学表达式计算，支持加减乘除、括号等',
      inputSchema: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '数学表达式，如：25 * 4 + 10'
          }
        },
        required: ['expression']
      }
    }, null, 2),
    'executor.js': `// 此 Skill 的执行器已内置在服务器代码中
export async function execute(params, context) {
  throw new Error('This skill uses built-in executor');
}
`
  },
  'search_memory': {
    'SKILL.md': `---
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

- \`keyword\`：搜索关键词。避免过于模糊的词（如"那个"、"什么"），优先使用具体名词
- \`limit\`：返回结果数量，默认 10。用户要求"所有"时可设为 50

## 注意事项

- 搜索是在角色的记忆文件（MEMORY.md、日记等）中进行全文匹配
- 结果格式为 \`[文件名:行号] 匹配内容\`
- 搜索不区分大小写
- 如果搜索无结果，告知用户并建议换个关键词
`,
    'tool.json': JSON.stringify({
      name: 'search_memory',
      description: '在当前角色的记忆文件中搜索关键词',
      inputSchema: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '要搜索的关键词'
          },
          limit: {
            type: 'number',
            description: '最多返回多少条结果，默认 10',
            default: 10
          }
        },
        required: ['keyword']
      }
    }, null, 2),
    'executor.js': `// 此 Skill 的执行器已内置在服务器代码中
export async function execute(params, context) {
  throw new Error('This skill uses built-in executor');
}
`
  },
  'summarize_memory': {
    'SKILL.md': `---
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

1. 默认执行 \`summarize_today_and_update\`：先总结今日对话，再更新长期记忆
2. 如果用户只想看总结不需要更新：使用 \`summarize_today\` 或 \`summarize_date\`
3. 如果用户只想更新长期记忆：使用 \`update_long_term\`

## 参数指南

- \`action\`：操作类型
  - \`summarize_today_and_update\`（默认）：总结今天 + 更新长期记忆
  - \`summarize_today\`：仅总结今天的对话
  - \`summarize_date\`：总结指定日期的对话（需提供 \`date\`）
  - \`update_long_term\`：仅更新长期记忆
- \`date\`：指定日期（YYYY-MM-DD 格式），仅在 \`action=summarize_date\` 时需要

## 注意事项

- 总结过程需要调用 LLM，可能需要几秒钟
- 如果没有新内容可总结，会返回提示信息
- 同一时间只允许一个总结操作运行（有锁机制）
- 必须先进行每日总结，才能更新长期记忆
`,
    'tool.json': JSON.stringify({
      name: 'summarize_memory',
      description: '总结对话记录并更新记忆系统。当用户说"总结一下"、"回顾今天"、"更新记忆"等时使用此工具。',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: '要执行的操作。默认使用 summarize_today_and_update。',
            enum: ['summarize_today', 'summarize_date', 'update_long_term', 'summarize_today_and_update'],
            default: 'summarize_today_and_update'
          },
          date: {
            type: 'string',
            description: '指定日期 (YYYY-MM-DD 格式)，仅在 action=summarize_date 时需要'
          }
        },
        required: []
      }
    }, null, 2),
    'executor.js': `// 此 Skill 的执行器已内置在服务器代码中
export async function execute(params, context) {
  throw new Error('This skill uses built-in executor');
}
`
  },
  'record_to_memory': {
    'SKILL.md': `---
id: record_to_memory
name: 记录到长期记忆
version: 1.0.0
description: 将重要内容总结并记录到长期记忆文件中
category: memory
author: hometale

disclosure:
  discoverable: true
  keywords: ['记录', '保存', '记忆', '长期记忆', 'record', 'save', 'memory']
  triggers: ['记录下', '记下来', '保存一下', '记录到记忆', '帮我记录']
  autoActivateOnTrigger: true
  level: onKeyword

security:
  requiresConfirmation: false
  allowedRoles: ['*']
  level: safe
---

# 记录到长期记忆 Skill

将对话内容或重要信息总结后记录到长期记忆文件中。当用户说"记录下"、"记下来"、"保存一下"等时使用此工具。

## 工作流程

1. 提取用户要记录的核心内容
2. 默认由 AI 先总结整理内容，再写入长期记忆（\`shouldSummarize=true\`）
3. 如果用户已提供清晰摘要，可设 \`shouldSummarize=false\` 直接记录

## 参数指南

- \`content\`：要记录的内容。可以是原始对话、事件描述、重要信息等
- \`shouldSummarize\`：是否由 AI 先总结再记录，默认 true
  - true：AI 会整理成要点格式，提取关键信息
  - false：直接原样记录，适用于用户已提供结构化内容

## 注意事项

- 记录时会自动添加时间戳
- 内容会追加到 MEMORY.md 文件末尾
- 适合记录：生日、纪念日、重要事件、偏好、约定等
- 不适合记录：临时性对话、无关紧要的细节
`,
    'tool.json': JSON.stringify({
      name: 'record_to_memory',
      description: '将对话内容或重要信息总结后记录到长期记忆文件中。当用户说"记录下"、"记下来"、"保存一下"等时使用此工具。',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: '要记录的内容，可以是当前对话的摘要或用户明确要求记录的重要信息'
          },
          shouldSummarize: {
            type: 'boolean',
            description: '是否需要AI先总结内容再记录，默认为true。如果用户已经提供了明确的摘要，可以设为false',
            default: true
          }
        },
        required: ['content']
      }
    }, null, 2),
    'executor.js': `// 此 Skill 的执行器已内置在服务器代码中
export async function execute(params, context) {
  throw new Error('This skill uses built-in executor');
}
`
  },
  'load_skill': {
    'SKILL.md': `---
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
`,
    'tool.json': JSON.stringify({
      name: 'load_skill',
      description: '加载指定 Skill 的详细使用说明和工作流指南。当你需要了解某个技能的完整使用方法时调用此工具。',
      inputSchema: {
        type: 'object',
        properties: {
          skill_id: {
            type: 'string',
            description: '要加载的 Skill ID，例如 search_memory、calculate 等'
          }
        },
        required: ['skill_id']
      }
    }, null, 2),
    'executor.js': `// 此 Skill 的执行器已内置在服务器代码中
export async function execute(params, context) {
  throw new Error('This skill uses built-in executor');
}
`
  }
};

// 检查 Skills 目录是否为空
export function isSkillsDirEmpty(): boolean {
  const skillsPath = getSkillsPath();
  ensureDir(skillsPath);

  if (!fs.existsSync(skillsPath)) {
    return true;
  }

  const entries = fs.readdirSync(skillsPath, { withFileTypes: true });
  const skillDirs = entries.filter(e => e.isDirectory());
  return skillDirs.length === 0;
}

// 写入单个 Skill
function writeSkill(skillId: string, skillData: any, targetPath: string): void {
  const targetSkillDir = path.join(targetPath, skillId);
  ensureDir(targetSkillDir);

  for (const [fileName, content] of Object.entries(skillData)) {
    const filePath = path.join(targetSkillDir, fileName);
    fs.writeFileSync(filePath, content as string, 'utf-8');
  }

  console.log(`[SkillInitializer] Written skill: ${skillId}`);
}

// 初始化默认 Skills
export async function initializeDefaultSkills(): Promise<void> {
  const skillsPath = getSkillsPath();
  ensureDir(skillsPath);

  if (!isSkillsDirEmpty()) {
    console.log('[SkillInitializer] Skills directory not empty, skipping initialization');
    return;
  }

  console.log('[SkillInitializer] Initializing default skills...');

  for (const [skillId, skillData] of Object.entries(DEFAULT_SKILLS)) {
    writeSkill(skillId, skillData, skillsPath);
  }

  console.log(`[SkillInitializer] Initialized ${Object.keys(DEFAULT_SKILLS).length} default skills`);
}

// 强制重新初始化 Skills（覆盖现有）
export async function forceInitializeDefaultSkills(): Promise<void> {
  const skillsPath = getSkillsPath();
  ensureDir(skillsPath);

  console.log('[SkillInitializer] Force initializing default skills...');

  for (const [skillId, skillData] of Object.entries(DEFAULT_SKILLS)) {
    writeSkill(skillId, skillData, skillsPath);
  }

  console.log(`[SkillInitializer] Force initialized ${Object.keys(DEFAULT_SKILLS).length} default skills`);
}
