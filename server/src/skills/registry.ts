import type { LoadedSkill } from './types.js';
import { loadAllSkills, loadSkill, initSkillsDir } from './loader.js';
import { initializeDefaultSkills, isSkillsDirEmpty } from './initializer.js';

export class SkillRegistry {
  private skills: Map<string, LoadedSkill> = new Map();
  private initialized = false;

  constructor() {
    initSkillsDir();
  }

  async initialize() {
    if (this.initialized) return;

    console.log('[SkillRegistry] Initializing...');

    if (isSkillsDirEmpty()) {
      console.log('[SkillRegistry] Skills directory empty, initializing defaults...');
      await initializeDefaultSkills();
    }

    const skills = await loadAllSkills();
    for (const skill of skills) {
      this.skills.set(skill.id, skill);
    }

    this.initialized = true;
    console.log(`[SkillRegistry] Initialized with ${this.skills.size} skill(s)`);
  }

  async reload() {
    console.log('[SkillRegistry] Reloading skills...');
    this.skills.clear();
    this.initialized = false;
    await this.initialize();
  }

  async reloadSkill(skillId: string) {
    console.log(`[SkillRegistry] Reloading skill: ${skillId}`);
    const skill = await loadSkill(skillId);
    if (skill) {
      this.skills.set(skillId, skill);
    } else {
      this.skills.delete(skillId);
    }
  }

  getSkill(id: string): LoadedSkill | undefined {
    return this.skills.get(id);
  }

  getAllSkills(): LoadedSkill[] {
    return Array.from(this.skills.values());
  }

  getSkillsByCategory(category: string): LoadedSkill[] {
    return this.getAllSkills().filter(s => s.category === category);
  }

  matchSkillsByKeywords(keywords: string[]): LoadedSkill[] {
    const results: LoadedSkill[] = [];
    const lowerKeywords = keywords.map(k => k.toLowerCase());

    for (const skill of this.getAllSkills()) {
      const match = skill.disclosure.keywords.some(kw =>
        lowerKeywords.some(lk => kw.toLowerCase().includes(lk) || lk.includes(kw.toLowerCase()))
      );
      if (match) {
        results.push(skill);
      }
    }

    return results;
  }

  matchSkillsByTriggers(message: string): LoadedSkill[] {
    const results: LoadedSkill[] = [];
    const lowerMessage = message.toLowerCase();

    for (const skill of this.getAllSkills()) {
      if (!skill.disclosure.autoActivateOnTrigger) continue;

      const match = skill.disclosure.triggers.some(t =>
        lowerMessage.includes(t.toLowerCase())
      );
      if (match) {
        results.push(skill);
      }
    }

    return results;
  }
}

let registryInstance: SkillRegistry | null = null;

export function getSkillRegistry(): SkillRegistry {
  if (!registryInstance) {
    registryInstance = new SkillRegistry();
  }
  return registryInstance;
}
