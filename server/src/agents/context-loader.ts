import fs from 'node:fs';
import { getAgentsPath } from '../lib/hometale-path.js';
import { loadAllSkillsFrontmatter } from '../skills/loader.js';

export interface LoadedContext {
  agentsMdContent: string;
  skillsFrontmatter: Array<{
    id: string;
    name: string;
    description: string;
    frontmatter: any;
  }>;
}

export async function loadContext(): Promise<LoadedContext> {
  // 1. 读取 AGENTS.md
  let agentsMdContent = '';
  const agentsPath = getAgentsPath();
  if (fs.existsSync(agentsPath)) {
    agentsMdContent = fs.readFileSync(agentsPath, 'utf-8');
  }

  // 2. 加载所有 Skills 的 frontmatter
  const skillsFrontmatter = await loadAllSkillsFrontmatter();

  return {
    agentsMdContent,
    skillsFrontmatter
  };
}

export function buildSystemPrompt(context: LoadedContext): string {
  // 构建 Skills 摘要
  let skillsSummary = '';
  if (context.skillsFrontmatter.length > 0) {
    skillsSummary = context.skillsFrontmatter
      .map(skill => `- ${skill.name} (${skill.id}): ${skill.description}`)
      .join('\n');
    skillsSummary += '\n\n需要了解某个 Skill 的详细使用方法时，请调用 load_skill 工具。';
  } else {
    skillsSummary = '暂无可用 Skills';
  }

  return `你是 HomeTale（家的故事）智能体，一个贴心的家庭助手。

请用温馨、简单、明了的方式回答问题，像和家人聊天一样。

你的主要职责：
1. 记录家人的日常对话和重要信息
2. 对信息进行分层总结（对话明细 → 每日总结 → 长期记忆）
3. 根据记忆内容回答用户的问题，提供情感关怀

${context.agentsMdContent}

=== 可用 Skills ===
${skillsSummary}

=== 操作指南 ===

1. 如果需要使用工具，请直接调用相应的工具函数。
2. 如果可以直接回答用户的问题，请直接用自然语言回答。
3. 【重要】如果调用工具失败（返回 [ERROR] 开头的结果），必须在回复中明确告知用户：
   - 说明哪个工具调用失败了
   - 说明失败的原因
   - 告诉用户这可能会影响记忆保存等功能

4. 之前的对话和工具执行结果都已在上下文中。`;
}
