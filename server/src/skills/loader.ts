import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, LoadedSkill, SkillExecutor } from './types.js';
import { getSkillsPath, getMemoryPath, getLocalDateString } from '../lib/hometale-path.js';
import { loadConfig } from '../lib/config.js';
import { updateLongTermMemory } from '../memory/memory-manager.js';
import { callLLM } from '../agents/llm-client.js';
import {
  summarizeDaily,
  updateLongTermFromDaily,
  getSummaryState
} from '../memory/memory-summarizer.js';
import {
  acquireLock,
  releaseLock,
  checkLock
} from '../cron/scheduler.js';

// 内置默认 Skills 的执行器
const BUILTIN_EXECUTORS: Record<string, (params: any, context: any) => Promise<string>> = {
  get_current_time: async (params: any) => {
    const timezone = params.timezone || 'Asia/Shanghai';
    const format = params.format || 'full';

    const now = new Date();

    const options: any = {};
    options.timeZone = timezone;

    let result = '';

    switch (format) {
      case 'full':
        options.year = 'numeric';
        options.month = 'long';
        options.day = 'numeric';
        options.weekday = 'long';
        options.hour = '2-digit';
        options.minute = '2-digit';
        options.second = '2-digit';
        result = now.toLocaleString('zh-CN', options);
        break;

      case 'short':
        options.year = 'numeric';
        options.month = '2-digit';
        options.day = '2-digit';
        options.hour = '2-digit';
        options.minute = '2-digit';
        result = now.toLocaleString('zh-CN', options);
        break;

      case 'time':
        options.hour = '2-digit';
        options.minute = '2-digit';
        options.second = '2-digit';
        result = now.toLocaleTimeString('zh-CN', options);
        break;

      case 'date':
        options.year = 'numeric';
        options.month = 'long';
        options.day = 'numeric';
        options.weekday = 'long';
        result = now.toLocaleDateString('zh-CN', options);
        break;

      default:
        options.year = 'numeric';
        options.month = 'long';
        options.day = 'numeric';
        options.weekday = 'long';
        options.hour = '2-digit';
        options.minute = '2-digit';
        options.second = '2-digit';
        result = now.toLocaleString('zh-CN', options);
    }

    return result;
  },

  calculate: async (params: any) => {
    function safeCalculate(expression: string) {
      const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');

      if (!/^[\d\s+\-*/().%]+$/.test(sanitized)) {
        throw new Error('无效的数学表达式');
      }

      try {
        const result = new Function(`'use strict'; return (${sanitized})`)();

        if (typeof result !== 'number' || !isFinite(result)) {
          throw new Error('计算结果无效');
        }

        return result;
      } catch (error) {
        throw new Error('计算失败，请检查表达式');
      }
    }

    const expression = params.expression;

    if (!expression) {
      throw new Error('请提供数学表达式');
    }

    try {
      const result = safeCalculate(expression);
      return `${expression} = ${result}`;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '计算失败';
      return `计算错误: ${errorMsg}`;
    }
  },

  search_memory: async (params: any, context: any) => {
    const keyword = params.keyword;
    const limit = params.limit || 10;

    if (!keyword) {
      throw new Error('请提供搜索关键词');
    }

    const memoryDir = getMemoryPath(context.roleId);

    if (!fs.existsSync(memoryDir)) {
      return '暂无记忆文件';
    }

    const results: any[] = [];
    const lowerKeyword = keyword.toLowerCase();

    const files = fs.readdirSync(memoryDir);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(memoryDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.toLowerCase().includes(lowerKeyword)) {
          results.push({
            file,
            line: i + 1,
            content: line.trim()
          });

          if (results.length >= limit) break;
        }
      }

      if (results.length >= limit) break;
    }

    if (results.length === 0) {
      return `未找到包含 "${keyword}" 的记忆内容`;
    }

    let output = `找到 ${results.length} 条结果（最多显示 ${limit} 条）：\n\n`;
    for (const r of results) {
      output += `[${r.file}:${r.line}] ${r.content}\n`;
    }

    return output;
  },

  summarize_memory: async (params: any, context: any) => {
    const action = params.action || 'summarize_today_and_update';
    const date = params.date;
    const roleId = context.roleId;

    if (checkLock()) {
      return '记忆总结正在进行中，请稍后再试。';
    }

    if (!acquireLock()) {
      return '无法获取总结锁，请稍后再试。';
    }

    try {
      const config = await loadConfig();
      if (!config.model.apiKey) {
        throw new Error('API key not configured. Please set it in ~/.hometale/config.json');
      }

      const today = getLocalDateString();

      switch (action) {
        case 'summarize_today': {
          const summary = await summarizeDaily(roleId, today, config.model);
          if (!summary) {
            return '今天没有新内容需要总结。';
          }
          return `已完成今天的对话总结：\n\n${summary}`;
        }

        case 'summarize_date': {
          if (!date) {
            throw new Error('请指定要总结的日期 (YYYY-MM-DD 格式)');
          }

          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            throw new Error('日期格式不正确，请使用 YYYY-MM-DD 格式');
          }

          const summary = await summarizeDaily(roleId, date, config.model);
          if (!summary) {
            return `${date} 没有内容需要总结。`;
          }
          return `已完成 ${date} 的对话总结：\n\n${summary}`;
        }

        case 'update_long_term': {
          const state = await getSummaryState(roleId);
          const targetDate = state.lastDailySummary || today;

          const result = await updateLongTermFromDaily(roleId, targetDate, config.model);
          if (!result) {
            return '没有可用于更新长期记忆的内容。请先进行每日总结。';
          }
          return '已成功更新长期记忆！';
        }

        case 'summarize_today_and_update': {
          let result = '';

          const dailySummary = await summarizeDaily(roleId, today, config.model);
          if (dailySummary) {
            result += `今日总结：\n${dailySummary}\n\n`;
          }

          const longTermResult = await updateLongTermFromDaily(roleId, today, config.model);
          if (longTermResult) {
            result += '长期记忆已更新！';
          }

          if (!result) {
            return '没有需要总结的内容。';
          }
          return result;
        }

        default:
          throw new Error(`未知的操作类型: ${action}`);
      }
    } finally {
      releaseLock();
    }
  },

  record_to_memory: async (params: any, context: any) => {
    const content = params.content;
    const shouldSummarize = params.shouldSummarize !== false;
    const roleId = context.roleId;

    if (!content) {
      throw new Error('请提供要记录的内容');
    }

    const config = await loadConfig();
    if (!config.model.apiKey) {
      throw new Error('API key not configured. Please set it in ~/.hometale/config.json');
    }

    let finalContent = content;

    if (shouldSummarize) {
      const systemPrompt = `你是一个记忆记录助手。请将以下内容整理成适合长期记忆的格式。

要求：
1. 提取关键信息，确保重要细节不丢失
2. 使用简洁清晰的语言
3. 按主题或时间顺序组织内容
4. 使用要点列表格式（- 开头）
5. 记录人物、事件、时间、地点等关键要素
6. 保持客观真实，不添加主观臆测

请直接输出整理后的内容，不要有额外的说明。`;

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content }
      ];

      const response = await callLLM(config.model, messages);
      finalContent = response.content.trim();
    }

    // 添加时间戳
    const now = new Date();
    const timestamp = now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const contentWithTimestamp = `## ${timestamp}\n\n${finalContent}`;

    await updateLongTermMemory(roleId, contentWithTimestamp);

    return `已成功记录到长期记忆！\n\n${finalContent}`;
  },

  // load_skill: 两层加载 - 模型按需获取 Skill 的完整使用说明
  load_skill: async (params: any) => {
    const skillId = params.skill_id;
    if (!skillId) {
      const available = listSkillIds();
      return `Error: 请提供 skill_id。可用的 Skills: ${available.join(', ')}`;
    }
    const skill = await loadSkill(skillId);
    if (!skill) {
      const available = listSkillIds();
      return `Error: 未找到 Skill '${skillId}'。可用的 Skills: ${available.join(', ')}`;
    }
    const body = skill.body || '(无详细使用说明)';
    return `<skill name="${skillId}">\n${body}\n</skill>`;
  },

  // compact: 手动触发上下文压缩
  compact: async (params: any, context: any) => {
    const keepRecent = params.keepRecent || 5;
    const messages = context.messages || [];
    const sessionId = context.sessionId;
    const roleId = context.roleId;

    if (!sessionId) {
      return 'Error: 需要有效的 sessionId 才能压缩上下文';
    }

    // 使用 CompactionManager 强制触发压缩
    const { CompactionManager } = await import('../agent-core/context-compact/auto-compact.js');
    const config = await loadConfig();
    const compactionManager = new CompactionManager(config.model, {
      tokenThreshold: 0,
      keepRecentMessages: keepRecent
    });

    const result = await compactionManager.compactIfNeeded(messages, sessionId, roleId);

    if (result.wasCompacted) {
      return `上下文已压缩！总结：\n\n${result.summary}`;
    }

    return '上下文不需要压缩';
  }
};

// 解析 YAML frontmatter（简单实现，不用依赖额外库）
function parseYamlFrontmatter(content: string): { frontmatter: any; body: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yamlContent = match[1];
  const body = match[2];

  const frontmatter: any = {};
  const lines = yamlContent.split('\n');
  let currentKey: string | null = null;
  let currentIndent = 0;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indent = line.search(/\S/);
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('- ')) {
      if (currentKey) {
        if (!Array.isArray(frontmatter[currentKey])) {
          frontmatter[currentKey] = [];
        }
        frontmatter[currentKey].push(trimmedLine.substring(2).trim());
      }
      continue;
    }

    const colonIndex = trimmedLine.indexOf(':');
    if (colonIndex > 0) {
      const key = trimmedLine.substring(0, colonIndex).trim();
      const value = trimmedLine.substring(colonIndex + 1).trim();

      if (!value) {
        currentKey = key;
        frontmatter[key] = {};
        currentIndent = indent;
      } else {
        if (value === 'true') {
          frontmatter[key] = true;
        } else if (value === 'false') {
          frontmatter[key] = false;
        } else if (value.startsWith('[') && value.endsWith(']')) {
          try {
            frontmatter[key] = JSON.parse(value);
          } catch {
            frontmatter[key] = value;
          }
        } else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          frontmatter[key] = value.slice(1, -1);
        } else {
          frontmatter[key] = value;
        }
        currentKey = null;
      }
      continue;
    }

    if (currentKey && indent > currentIndent) {
      const nestedMatch = trimmedLine.match(/^(\w+):\s*(.*)$/);
      if (nestedMatch) {
        const nestedKey = nestedMatch[1];
        let nestedValue = nestedMatch[2];

        if (nestedValue.startsWith('[') && nestedValue.endsWith(']')) {
          try {
            nestedValue = JSON.parse(nestedValue);
          } catch {}
        }

        if (typeof frontmatter[currentKey] === 'object') {
          frontmatter[currentKey][nestedKey] = nestedValue;
        }
      }
    }
  }

  return { frontmatter, body };
}

// 列出所有可用的 Skill ID（扫描目录）
export function listSkillIds(): string[] {
  const skillsPath = getSkillsPath();

  if (!fs.existsSync(skillsPath)) {
    return [];
  }

  return fs.readdirSync(skillsPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .filter(dirent => {
      const skillDir = path.join(skillsPath, dirent.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      const toolJsonPath = path.join(skillDir, 'tool.json');
      return fs.existsSync(skillMdPath) && fs.existsSync(toolJsonPath);
    })
    .map(dirent => dirent.name);
}

// 动态加载 executor.js/ts
async function loadExecutor(skillDir: string): Promise<SkillExecutor | null> {
  const jsPath = path.join(skillDir, 'executor.js');
  const mjsPath = path.join(skillDir, 'executor.mjs');

  let executorPath: string | null = null;

  if (fs.existsSync(jsPath)) {
    executorPath = jsPath;
  } else if (fs.existsSync(mjsPath)) {
    executorPath = mjsPath;
  }

  if (!executorPath) {
    return null;
  }

  try {
    const fileUrl = `file://${executorPath.replace(/\\/g, '/')}`;
    const module = await import(fileUrl);
    if (module && typeof module.execute === 'function') {
      return { execute: module.execute };
    }
    console.warn(`[SkillLoader] Executor loaded but no execute function: ${executorPath}`);
    return null;
  } catch (error) {
    console.error(`[SkillLoader] Failed to load executor: ${executorPath}`, error);
    return null;
  }
}

// 加载单个 Skill（从文件系统）
export async function loadSkill(skillId: string): Promise<LoadedSkill | null> {
  const skillsPath = getSkillsPath();
  const skillDir = path.join(skillsPath, skillId);

  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const toolJsonPath = path.join(skillDir, 'tool.json');

  if (!fs.existsSync(skillMdPath) || !fs.existsSync(toolJsonPath)) {
    console.warn(`[SkillLoader] Skill ${skillId} missing SKILL.md or tool.json`);
    return null;
  }

  try {
    const skillMdContent = fs.readFileSync(skillMdPath, 'utf-8');
    const { frontmatter, body } = parseYamlFrontmatter(skillMdContent);

    const toolJsonContent = fs.readFileSync(toolJsonPath, 'utf-8');
    const tool = JSON.parse(toolJsonContent) as ToolDefinition;

    // 优先使用内置 executor，对于默认 Skills
    const builtinExecutor = BUILTIN_EXECUTORS[skillId];

    const skill: LoadedSkill = {
      id: frontmatter.id || skillId,
      name: frontmatter.name || skillId,
      version: frontmatter.version || '1.0.0',
      description: frontmatter.description || '',
      category: frontmatter.category || 'utility',
      author: frontmatter.author || 'unknown',
      disclosure: {
        discoverable: frontmatter.disclosure?.discoverable !== false,
        keywords: frontmatter.disclosure?.keywords || [],
        triggers: frontmatter.disclosure?.triggers || [],
        autoActivateOnTrigger: frontmatter.disclosure?.autoActivateOnTrigger !== false
      },
      security: {
        requiresConfirmation: frontmatter.security?.requiresConfirmation === true,
        allowedRoles: frontmatter.security?.allowedRoles || ['*'],
        level: frontmatter.security?.level || 'safe'
      },
      tool,
      body: body.trim() || undefined,
      skillDir,
      executor: builtinExecutor ? { execute: builtinExecutor } : undefined,
      execute: async (params: any, context: any) => {
        if (builtinExecutor) {
          return await builtinExecutor(params, context);
        }
        // 对于自定义 Skills，尝试加载外部 executor
        const externalExecutor = await loadExecutor(skillDir);
        if (externalExecutor) {
          return await externalExecutor.execute(params, context);
        }
        throw new Error(`Skill ${skillId} has no executor`);
      }
    };

    console.log(`[SkillLoader] Loaded skill: ${skill.id}`);
    return skill;
  } catch (error) {
    console.error(`[SkillLoader] Failed to load skill ${skillId}:`, error);
    return null;
  }
}

// 加载所有 Skills
export async function loadAllSkills(): Promise<LoadedSkill[]> {
  const skillIds = listSkillIds();
  const skills: LoadedSkill[] = [];

  console.log(`[SkillLoader] Found ${skillIds.length} skill(s) to load`);

  for (const skillId of skillIds) {
    const skill = await loadSkill(skillId);
    if (skill) {
      skills.push(skill);
    }
  }

  return skills;
}

// 初始化 skills 目录结构
export function initSkillsDir() {
  const skillsPath = getSkillsPath();

  if (!fs.existsSync(skillsPath)) {
    fs.mkdirSync(skillsPath, { recursive: true });
  }
}

// 加载所有 Skills 的 frontmatter（用于系统提示词）
export async function loadAllSkillsFrontmatter(): Promise<Array<{
  id: string;
  name: string;
  description: string;
  frontmatter: any;
}>> {
  const skillIds = listSkillIds();
  const results: Array<{
    id: string;
    name: string;
    description: string;
    frontmatter: any;
  }> = [];

  for (const skillId of skillIds) {
    const skillsPath = getSkillsPath();
    const skillDir = path.join(skillsPath, skillId);
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    if (!fs.existsSync(skillMdPath)) continue;

    try {
      const skillMdContent = fs.readFileSync(skillMdPath, 'utf-8');
      const { frontmatter } = parseYamlFrontmatter(skillMdContent);

      results.push({
        id: frontmatter.id || skillId,
        name: frontmatter.name || skillId,
        description: frontmatter.description || '',
        frontmatter
      });
    } catch (error) {
      console.warn(`[SkillLoader] Failed to load frontmatter for ${skillId}:`, error);
    }
  }

  return results;
}

export { getSkillsPath };
