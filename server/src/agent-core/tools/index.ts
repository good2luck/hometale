export * from './permissions.js';
export * from './file-tools.js';
export * from './tool-info-filter.js';
import { createFileTools, getCurrentRoleId } from './file-tools.js';
import { getSkillRegistry } from '../../skills/index.js';
import { getHometaleRoot } from '../../lib/hometale-path.js';
import type { ToolSet } from 'ai';
import { z } from 'zod';
import { tool } from 'ai';

/**
 * 创建完整的 ToolSet（文件工具 + Skill 工具），传入 roleId 用于权限控制
 * @param roleId 角色ID
 * @param disclosedSkillIds 已披露的 skill ID 列表，未传则注册全部 skill
 */
export function createToolSet(roleId?: string, disclosedSkillIds?: string[]): ToolSet {
  const fileTools = createFileTools(roleId);

  // 添加 Skill 工具
  const registry = getSkillRegistry();
  const skills = registry.getAllSkills();

  const skillTools: ToolSet = {};
  for (const skill of skills) {
    const skillName = skill.tool.name;
    const skillId = skill.id;

    // load_skill 始终注册(元工具); 其他 skill 按白名单过滤
    if (skillId !== 'load_skill' && disclosedSkillIds && !disclosedSkillIds.includes(skillId)) {
      continue;
    }

    const skillExecutor = skill.execute;
    const effectiveRoleId = roleId || getCurrentRoleId();

    // 将 Skill 的 inputSchema 转换为 zod schema
    const zodSchema = convertInputSchemaToZod(skill.tool.inputSchema);

    skillTools[skillName] = tool({
      description: skill.tool.description,
      inputSchema: zodSchema,
      execute: async (params: any) => {
        if (!effectiveRoleId) {
          throw new Error('Role ID not set');
        }
        return await skillExecutor(params, {
          roleId: effectiveRoleId,
          hometaleRoot: getHometaleRoot()
        });
      }
    });
  }

  return { ...fileTools, ...skillTools };
}

/**
 * 获取所有可用工具名称（用于工具名称修复）
 */
export function getAvailableToolNames(): string[] {
  const baseNames = ['read_file', 'write_file', 'edit_file', 'delete_file', 'list_dir', 'search_files', 'run_bash'];
  const registry = getSkillRegistry();
  const skillNames = registry.getAllSkills().map(s => s.tool.name);
  return [...baseNames, ...skillNames];
}

/**
 * 将 Skill 的 JSON Schema inputSchema 转换为 zod schema
 */
function convertInputSchemaToZod(inputSchema: {
  type: string;
  properties: Record<string, any>;
  required?: string[];
}): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, value] of Object.entries(inputSchema.properties || {})) {
    const desc = value.description || '';
    let zodType: z.ZodTypeAny;

    switch (value.type) {
      case 'string':
        zodType = z.string();
        break;
      case 'number':
        zodType = z.number();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'array':
        zodType = z.array(z.any());
        break;
      case 'object':
        zodType = z.record(z.any());
        break;
      default:
        zodType = z.any();
    }

    if (desc) {
      zodType = zodType.describe(desc);
    }

    if (value.default !== undefined) {
      zodType = zodType.default(value.default);
    }

    // 如果不是 required 且没有默认值，设为 optional
    const isRequired = inputSchema.required?.includes(key);
    if (!isRequired && value.default === undefined) {
      zodType = zodType.optional();
    }

    shape[key] = zodType;
  }

  return z.object(shape);
}

// 向后兼容：executeToolByName 保留，用于非 AI SDK 场景
export async function executeToolByName(name: string, args: any, roleId?: string): Promise<string> {
  const tools = createFileTools(roleId);

  if (tools[name] && tools[name].execute) {
    const result = await tools[name].execute!(args as any, { toolCallId: `manual_${Date.now()}`, messages: [] });
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  // 再尝试 Skill
  const registry = getSkillRegistry();
  const skill = registry.getSkill(name);

  if (skill) {
    const effectiveRoleId = roleId || getCurrentRoleId();
    if (!effectiveRoleId) {
      throw new Error('Role ID not set');
    }
    return await skill.execute(args, {
      roleId: effectiveRoleId,
      hometaleRoot: getHometaleRoot()
    });
  }

  throw new Error(`Unknown tool: ${name}`);
}
