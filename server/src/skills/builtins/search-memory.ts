import fs from 'node:fs';
import path from 'node:path';
import type { Skill, SkillContext } from '../types.js';
import { getMemoryPath } from '../../lib/hometale-path.js';

export function searchMemorySkill(): Skill {
  return {
    id: 'search_memory',
    name: '搜索记忆',
    version: '1.0.0',
    description: '搜索当前角色的记忆内容',
    category: 'memory',
    author: 'hometale',

    disclosure: {
      discoverable: true,
      keywords: ['搜索记忆', '找一下', '查找', 'search', 'memory', '回忆'],
      triggers: ['搜索记忆', '找一下', '回忆一下'],
      autoActivateOnTrigger: true
    },

    security: {
      requiresConfirmation: false,
      allowedRoles: ['*'],
      level: 'safe'
    },

    tool: {
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
    },

    execute: async (params: any, context: SkillContext): Promise<string> => {
      const keyword = params.keyword;
      const limit = params.limit || 10;

      if (!keyword) {
        throw new Error('请提供搜索关键词');
      }

      const memoryDir = getMemoryPath(context.roleId);

      if (!fs.existsSync(memoryDir)) {
        return '暂无记忆文件';
      }

      const results: Array<{ file: string; line: number; content: string }> = [];
      const lowerKeyword = keyword.toLowerCase();

      // 读取所有记忆文件
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
    }
  };
}
