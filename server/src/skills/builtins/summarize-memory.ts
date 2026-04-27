import { z } from 'zod';
import type { Skill, SkillContext } from '../types.js';
import { loadConfig } from '../../lib/config.js';
import { getLocalDateString } from '../../lib/hometale-path.js';
import {
  summarizeDaily,
  updateLongTermFromDaily,
  getSummaryState,
  getUnprocessedMessages
} from '../../memory/memory-summarizer.js';
import {
  acquireLock,
  releaseLock,
  checkLock
} from '../../cron/scheduler.js';

const SummarizeMemoryParams = z.object({
  action: z.enum(['summarize_today', 'summarize_date', 'update_long_term', 'summarize_today_and_update']),
  date: z.string().optional()
});

export function summarizeMemorySkill(): Skill {
  return {
    id: 'summarize_memory',
    name: '总结记忆',
    version: '1.0.0',
    description: '总结对话并更新记忆',
    category: 'memory',
    author: 'hometale',

    disclosure: {
      discoverable: true,
      keywords: ['总结', '回顾', '记忆', 'summarize', 'summary', 'memory'],
      triggers: ['总结一下', '回顾今天', '更新记忆', '总结记忆'],
      autoActivateOnTrigger: true
    },

    security: {
      requiresConfirmation: false,
      allowedRoles: ['*'],
      level: 'safe'
    },

    tool: {
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
    },

    execute: async (params: any, context: SkillContext): Promise<string> => {
      const validatedParams = SummarizeMemoryParams.parse(params);
      const { action, date } = validatedParams;
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
            const unprocessed = await getUnprocessedMessages(roleId, today);
            if (unprocessed.length === 0) {
              return '今天没有需要总结的新对话。';
            }

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

            const unprocessed = await getUnprocessedMessages(roleId, date);
            if (unprocessed.length === 0) {
              return `${date} 没有需要总结的对话。`;
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

            const unprocessedToday = await getUnprocessedMessages(roleId, today);
            if (unprocessedToday.length > 0) {
              const dailySummary = await summarizeDaily(roleId, today, config.model);
              if (dailySummary) {
                result += `今日总结：\n${dailySummary}\n\n`;
              }
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
    }
  };
}
