import type { Skill, SkillContext } from '../types.js';

export function getCurrentTimeSkill(): Skill {
  return {
    id: 'get_current_time',
    name: '获取当前时间',
    version: '1.0.0',
    description: '获取系统当前的日期和时间',
    category: 'utility',
    author: 'hometale',

    disclosure: {
      discoverable: true,
      keywords: ['时间', '日期', '星期', '几点', 'clock', 'time', 'date'],
      triggers: ['几点', '现在时间', '今天几号', '今天星期几'],
      autoActivateOnTrigger: true
    },

    security: {
      requiresConfirmation: false,
      allowedRoles: ['*'],
      level: 'safe'
    },

    tool: {
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
    },

    execute: async (params: any, _context: SkillContext): Promise<string> => {
      const timezone = params.timezone || 'Asia/Shanghai';
      const format = params.format || 'full';

      const now = new Date();

      // 格式化日期时间
      const options: Intl.DateTimeFormatOptions = {};
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
    }
  };
}
