// Skill Manifest - 从 SKILL.md 的 frontmatter 解析
export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  author: string;

  disclosure: {
    discoverable: boolean;
    keywords: string[];
    triggers: string[];
    autoActivateOnTrigger: boolean;
  };

  security: {
    requiresConfirmation: boolean;
    allowedRoles: string[];
    level: 'safe' | 'medium' | 'high';
  };
}

// Tool Definition - 从 tool.json 加载
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

// Skill Context - 执行时的上下文
export interface SkillContext {
  roleId: string;
  hometaleRoot: string;
}

// Skill 执行器
export interface SkillExecutor {
  execute: (params: any, context: SkillContext) => Promise<string>;
}

// 完整的 Skill
export interface Skill extends SkillManifest {
  tool: ToolDefinition;
  execute: (params: any, context: SkillContext) => Promise<string>;
}

// 从文件系统加载的 Skill（含执行器）
export interface LoadedSkill extends Skill {
  executor?: SkillExecutor;
  skillDir: string;
  body?: string; // SKILL.md frontmatter 之后的 markdown 内容，供 load_skill 按需返回
}

// 渐进式披露级别
export type DisclosureLevel = 'always' | 'onKeyword' | 'onDemand' | 'hidden';

// Skill Index Entry - 从 skills.json 加载
export interface SkillIndexEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  priority: number;
  disclosure: {
    discoverable: boolean;
    keywords: string[];
    level: DisclosureLevel;
  };
}

// Skill Index - skills.json 的格式
export interface SkillIndex {
  version: string;
  skills: SkillIndexEntry[];
}
