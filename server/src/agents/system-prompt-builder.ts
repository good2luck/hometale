import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getAgentsPath, getSkillsPath } from '../lib/hometale-path.js';
import type { Role } from '../roles/types.js';

export interface SystemPromptBuilderOptions {
  workdir: string;
  disclosedSkillIds?: string[];
}

export interface ReminderMessage {
  role: 'user';
  content: string;
}

/**
 * SystemPromptBuilder - 模块化系统提示词构建器
 *
 * 参考 s10 设计，将系统提示词分为多个独立部分：
 * 1. 核心指令 (静态)
 * 2. 工具列表 (静态)
 * 3. Skills 元数据 (静态)
 * 4. AGENTS.md 内容 (静态)
 * 5. CLAUDE.md 链式加载 (静态)
 * 6. 动态上下文 (动态 - 每轮)
 *
 * 使用 DYNAMIC_BOUNDARY 分隔符区分静态和动态内容，
 * 便于后续实现静态前缀缓存优化。
 */
export class SystemPromptBuilder {
  private static readonly DYNAMIC_BOUNDARY = '=== DYNAMIC_BOUNDARY ===';

  constructor(
    private readonly options: SystemPromptBuilderOptions
  ) {}

  // ========== Static Sections (可缓存) ==========

  /**
   * Section 1: 核心指令
   * 定义智能体的基本角色和行为准则
   */
  private buildCore(): string {
    return `你是 HomeTale（家的故事）智能体，一个贴心的家庭助手。

请用温馨、简单、明了的方式回答问题，像和家人聊天一样。

你的主要职责：
1. 记录家人的日常对话和重要信息
2. 对信息进行分层总结（对话明细 → 每日总结 → 长期记忆）
3. 根据记忆内容回答用户的问题，提供情感关怀`;
  }

  /**
   * Section 3: Skills 元数据
   * 列出 ProgressiveDisclosure 后已披露的 Skills
   */
  private buildSkillListing(): string {
    const skillsPath = getSkillsPath();
    if (!fs.existsSync(skillsPath)) {
      return '';
    }

    const skills: Array<{ id: string; name: string; description: string }> = [];

    // 扫描 skills 目录
    const skillDirs = fs.readdirSync(skillsPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const skillId of skillDirs) {
      // 如果有 disclosedSkillIds，只列出已披露的
      if (this.options.disclosedSkillIds && !this.options.disclosedSkillIds.includes(skillId)) {
        continue;
      }

      const skillDir = path.join(skillsPath, skillId);
      const skillMdPath = path.join(skillDir, 'SKILL.md');

      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        // 解析 frontmatter
        const frontmatter = this.parseFrontmatter(content);
        skills.push({
          id: skillId,
          name: frontmatter.name || skillId,
          description: frontmatter.description || ''
        });
      } catch (error) {
        console.warn(`[SystemPromptBuilder] Failed to load skill ${skillId}:`, error);
      }
    }

    if (skills.length === 0) {
      return '';
    }

    const lines = ['# Available skills'];
    for (const skill of skills) {
      lines.push(`- ${skill.name} (${skill.id}): ${skill.description}`);
    }

    if (this.options.disclosedSkillIds) {
      lines.push('\n需要了解某个 Skill 的详细使用方法时，请调用 load_skill 工具。');
    }

    return lines.join('\n');
  }

  /**
   * Section 4: AGENTS.md 内容
   * 加载全局 Agent 配置
   */
  private buildAgentsMd(): string {
    const agentsPath = getAgentsPath();
    if (!fs.existsSync(agentsPath)) {
      return '';
    }

    try {
      return fs.readFileSync(agentsPath, 'utf-8');
    } catch (error) {
      console.warn(`[SystemPromptBuilder] Failed to load AGENTS.md:`, error);
      return '';
    }
  }

  /**
   * Section 5: CLAUDE.md 链式加载
   * 按优先级加载用户全局和项目根的 CLAUDE.md
   */
  private buildClaudeMdChain(): string {
    const sources: Array<{ label: string; content: string }> = [];

    // User global: ~/.claude/CLAUDE.md
    const userClaudePath = path.join(os.homedir(), '.claude', 'CLAUDE.md');
    if (fs.existsSync(userClaudePath)) {
      try {
        sources.push({
          label: 'user global (~/.claude/CLAUDE.md)',
          content: fs.readFileSync(userClaudePath, 'utf-8')
        });
      } catch (error) {
        console.warn(`[SystemPromptBuilder] Failed to load user CLAUDE.md:`, error);
      }
    }

    // Project root: {workdir}/CLAUDE.md
    const projectClaudePath = path.join(this.options.workdir, 'CLAUDE.md');
    if (fs.existsSync(projectClaudePath)) {
      try {
        sources.push({
          label: 'project root (CLAUDE.md)',
          content: fs.readFileSync(projectClaudePath, 'utf-8')
        });
      } catch (error) {
        console.warn(`[SystemPromptBuilder] Failed to load project CLAUDE.md:`, error);
      }
    }

    if (sources.length === 0) {
      return '';
    }

    const lines = ['# CLAUDE.md instructions'];
    for (const { label, content } of sources) {
      lines.push(`## From ${label}`);
      lines.push(content.trim());
    }

    return lines.join('\n\n');
  }

  // ========== Dynamic Sections (每轮重建) ==========

  /**
   * 构建完整的系统提示词
   */
  build(role?: Role | null, familyMemories?: string): string {
    const sections: string[] = [];

    // 静态部分
    const core = this.buildCore();
    if (core) sections.push(core);

    const skills = this.buildSkillListing();
    if (skills) sections.push(skills);

    const agentsMd = this.buildAgentsMd();
    if (agentsMd) sections.push(agentsMd);

    const claudeMd = this.buildClaudeMdChain();
    if (claudeMd) sections.push(claudeMd);

    // 操作指南 (静态)
    sections.push(this.buildOperatingGuide());

    // 静态/动态边界
    sections.push(SystemPromptBuilder.DYNAMIC_BOUNDARY);

    // 动态部分
    if (role || familyMemories) {
      sections.push(this.buildDynamicContext(role ?? undefined, familyMemories));
    }

    return sections.join('\n\n');
  }

  /**
   * 构建动态上下文部分（角色信息 + 家庭记忆）
   */
  private buildDynamicContext(role?: Role | null, familyMemories?: string): string {
    const parts: string[] = [];

    if (role) {
      const roleInfo = `${role.name}（${role.avatar}）。${role.robotIdentity}`;
      parts.push(`=== 你的角色 ===\n${roleInfo}`);
    } else {
      parts.push(`=== 你的角色 ===\n你是一个贴心的家庭助手。`);
    }

    if (familyMemories) {
      parts.push(`=== 家庭记忆 ===\n${familyMemories}`);
    }

    return parts.join('\n\n');
  }

  /**
   * 构建操作指南
   */
  private buildOperatingGuide(): string {
    return `=== 操作指南 ===

1. 如果需要使用工具，请直接调用相应的工具函数。
2. 如果可以直接回答用户的问题，请直接用自然语言回答。
3. 【重要】如果调用工具失败（返回 [ERROR] 开头的结果），必须在回复中明确告知用户：
   - 说明哪个工具调用失败了
   - 说明失败的原因
   - 告诉用户这可能会影响记忆保存等功能

4. 之前的对话和工具执行结果都已在上下文中。`;
  }

  /**
   * 构建 per-turn reminder
   * 将短命上下文通过独立的 user message 注入
   */
  buildReminder(extra?: string): ReminderMessage | null {
    const parts: string[] = [];

    if (extra) {
      parts.push(extra);
    }

    if (parts.length === 0) {
      return null;
    }

    return {
      role: 'user',
      content: `<system-reminder>\n${parts.join('\n')}\n</system-reminder>`
    };
  }

  // ========== Helper Methods ==========

  /**
   * 解析 YAML frontmatter
   */
  private parseFrontmatter(content: string): Record<string, any> {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return {};
    }

    const yamlContent = match[1];
    const result: Record<string, any> = {};

    for (const line of yamlContent.split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue;

      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();

        // 简单处理字符串和布尔值
        if (value === 'true') {
          result[key] = true;
        } else if (value === 'false') {
          result[key] = false;
        } else if (value.startsWith('[') && value.endsWith(']')) {
          try {
            result[key] = JSON.parse(value);
          } catch {
            result[key] = value;
          }
        } else {
          result[key] = value;
        }
      }
    }

    return result;
  }

  // ========== (可选) 静态缓存支持 ==========

  private cachedStaticPrefix: string | null = null;

  /**
   * 获取静态前缀（可缓存）
   */
  getStaticPrefix(): string {
    if (!this.cachedStaticPrefix) {
      const sections: string[] = [];

      const core = this.buildCore();
      if (core) sections.push(core);

      const skills = this.buildSkillListing();
      if (skills) sections.push(skills);

      const agentsMd = this.buildAgentsMd();
      if (agentsMd) sections.push(agentsMd);

      const claudeMd = this.buildClaudeMdChain();
      if (claudeMd) sections.push(claudeMd);

      sections.push(this.buildOperatingGuide());
      sections.push(SystemPromptBuilder.DYNAMIC_BOUNDARY);

      this.cachedStaticPrefix = sections.join('\n\n');
    }

    return this.cachedStaticPrefix;
  }

  /**
   * 构建动态后缀（每轮重建）
   */
  buildDynamicSuffix(role?: Role | null, familyMemories?: string): string {
    return this.buildDynamicContext(role, familyMemories);
  }
}
