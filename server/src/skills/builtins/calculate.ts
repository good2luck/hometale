import type { Skill, SkillContext } from '../types.js';

// 安全的数学表达式计算
function safeCalculate(expression: string): number {
  // 只允许数字、运算符、括号和空格
  const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');

  // 简单的安全检查
  if (!/^[\d\s+\-*/().%]+$/.test(sanitized)) {
    throw new Error('无效的数学表达式');
  }

  try {
    // 使用 Function 构造函数，但限制上下文
    // eslint-disable-next-line no-new-func
    const result = new Function(`'use strict'; return (${sanitized})`)();

    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('计算结果无效');
    }

    return result;
  } catch (error) {
    throw new Error('计算失败，请检查表达式');
  }
}

export function calculateSkill(): Skill {
  return {
    id: 'calculate',
    name: '数学计算',
    version: '1.0.0',
    description: '执行数学表达式计算',
    category: 'utility',
    author: 'hometale',

    disclosure: {
      discoverable: true,
      keywords: ['计算', '算一下', '数学', 'math', 'calculate', '加减乘除'],
      triggers: ['计算', '算一下', '等于'],
      autoActivateOnTrigger: true
    },

    security: {
      requiresConfirmation: false,
      allowedRoles: ['*'],
      level: 'safe'
    },

    tool: {
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
    },

    execute: async (params: any, _context: SkillContext): Promise<string> => {
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
    }
  };
}
