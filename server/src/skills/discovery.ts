import type { LoadedSkill } from './types.js';
import { getSkillRegistry } from './registry.js';

export class ProgressiveDisclosure {
  private disclosedSkills: Set<string> = new Set();
  private registry = getSkillRegistry();

  getDisclosedSkills(userMessage?: string): LoadedSkill[] {
    const allSkills = this.registry.getAllSkills();
    const result: LoadedSkill[] = [];

    for (const skill of allSkills) {
      if (!skill.disclosure.discoverable) continue;

      const shouldDisclose = this.shouldDiscloseSkill(skill, userMessage);

      if (shouldDisclose) {
        result.push(skill);
        this.disclosedSkills.add(skill.id);
      }
    }

    return result;
  }

  private shouldDiscloseSkill(
    skill: LoadedSkill,
    userMessage?: string
  ): boolean {
    if (!userMessage) return true;

    const lowerMessage = userMessage.toLowerCase();
    const hasKeywordMatch = skill.disclosure.keywords.some(kw =>
      lowerMessage.includes(kw.toLowerCase())
    );
    const hasTriggerMatch = skill.disclosure.triggers.some(t =>
      lowerMessage.includes(t.toLowerCase())
    );

    return hasKeywordMatch || hasTriggerMatch;
  }

  buildSkillsDescription(userMessage?: string): string {
    const skills = this.getDisclosedSkills(userMessage);

    if (skills.length === 0) return '';

    const descriptions = skills.map((skill, index) => {
      const params = Object.entries(skill.tool.inputSchema.properties || {})
        .map(([key, value]: [string, any]) => {
          const desc = value.description || '';
          const defaultVal = value.default ? ` (默认: ${value.default})` : '';
          return `  ${key}: ${desc}${defaultVal}`;
        })
        .join('\n');

      return `${index + 1}. ${skill.name} (${skill.id})
   ${skill.description}
   参数:
${params}`;
    });

    return `可用技能：

${descriptions.join('\n\n')}`;
  }

  reset() {
    this.disclosedSkills.clear();
  }

  getDisclosedSkillIds(): string[] {
    return Array.from(this.disclosedSkills);
  }
}

const disclosureManagers: Map<string, ProgressiveDisclosure> = new Map();

export function getDisclosureManager(sessionId: string): ProgressiveDisclosure {
  if (!disclosureManagers.has(sessionId)) {
    disclosureManagers.set(sessionId, new ProgressiveDisclosure());
  }
  return disclosureManagers.get(sessionId)!;
}

export function cleanupDisclosureManager(sessionId: string) {
  disclosureManagers.delete(sessionId);
}
