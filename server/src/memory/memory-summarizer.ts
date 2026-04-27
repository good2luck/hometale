import path from 'node:path';
import { callLLM } from '../agents/llm-client.js';
import {
  getMemoryPath,
  ensureDir
} from '../lib/hometale-path.js';
import { readTextFile, writeTextFile, fileExists } from '../lib/fs-utils.js';
import {
  filterPrivateContent,
  getLongTermMemory,
  appendDailySummary
} from './memory-manager.js';
import { getRole, listRoles } from '../roles/role-manager.js';
import { getMessagesByRoleIdAndDate } from '../db/message-db.js';
import type { ModelConfig } from '../lib/config.js';

export interface SummaryState {
  lastDailySummary: string | null;
  lastLongTermUpdate: string | null;
  summarizedMessageIds: number[];
}

const SUMMARY_STATE_FILE = '.summary-state.json';

async function loadSummaryState(roleId: string): Promise<SummaryState> {
  const memoryPath = getMemoryPath(roleId);
  const stateFile = path.join(memoryPath, SUMMARY_STATE_FILE);

  if (!fileExists(stateFile)) {
    return {
      lastDailySummary: null,
      lastLongTermUpdate: null,
      summarizedMessageIds: []
    };
  }

  try {
    const content = await readTextFile(stateFile);
    const parsed = content ? JSON.parse(content) : {};
    return {
      lastDailySummary: parsed.lastDailySummary || null,
      lastLongTermUpdate: parsed.lastLongTermUpdate || null,
      summarizedMessageIds: Array.isArray(parsed.summarizedMessageIds)
        ? parsed.summarizedMessageIds
        : []
    };
  } catch {
    return {
      lastDailySummary: null,
      lastLongTermUpdate: null,
      summarizedMessageIds: []
    };
  }
}

async function saveSummaryState(roleId: string, state: SummaryState): Promise<void> {
  const memoryPath = getMemoryPath(roleId);
  ensureDir(memoryPath);
  const stateFile = path.join(memoryPath, SUMMARY_STATE_FILE);
  await writeTextFile(stateFile, JSON.stringify(state, null, 2));
}

async function updateSummaryState(
  roleId: string,
  updater: (state: SummaryState) => SummaryState
): Promise<void> {
  const state = await loadSummaryState(roleId);
  const newState = updater(state);
  await saveSummaryState(roleId, newState);
}

async function getUnprocessedMessages(
  roleId: string,
  date: string
): Promise<Array<{ id: number; role: 'user' | 'assistant'; content: string; timestamp: string }>> {
  const state = await loadSummaryState(roleId);
  const allMessages = getMessagesByRoleIdAndDate(roleId, date);

  return allMessages.filter(msg =>
    msg.id !== undefined && !state.summarizedMessageIds.includes(msg.id)
  ) as Array<{ id: number; role: 'user' | 'assistant'; content: string; timestamp: string }>;
}

async function summarizeWithLLM(
  config: ModelConfig,
  systemPrompt: string,
  content: string
): Promise<string> {
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content }
  ];

  const response = await callLLM(config, messages);
  return response.content.trim();
}

export async function summarizeConversations(
  roleId: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>,
  config: ModelConfig
): Promise<string> {
  if (messages.length === 0) {
    return '';
  }

  const role = await getRole(roleId);
  const roleName = role?.name || roleId;

  let allContent = '';
  for (const msg of messages) {
    const roleName = msg.role === 'user' ? '用户' : '智能体';
    allContent += `**${roleName}**: ${msg.content}\n\n`;
  }

  if (!allContent.trim()) {
    return '';
  }

  const systemPrompt = `你是一个记忆总结助手。请分析以下${roleName}的对话记录，提取关键信息生成简洁的总结。

总结要求：
1. 提取重要的事实、事件和情感表达
2. 按时间顺序或主题组织内容
3. 使用要点列表格式（- 开头）
4. 保持语言简洁但信息完整
5. 忽略闲聊，专注有意义的内容
6. 注意记录人物、时间、地点、事件等关键要素

请直接输出总结，不要有额外的说明。`;

  return await summarizeWithLLM(config, systemPrompt, allContent);
}

export async function summarizeDaily(
  roleId: string,
  date: string,
  config: ModelConfig
): Promise<string> {
  const unprocessedMessages = await getUnprocessedMessages(roleId, date);

  if (unprocessedMessages.length === 0) {
    console.log(`[MemorySummarizer] No unprocessed messages for ${roleId} on ${date}`);
    return '';
  }

  console.log(`[MemorySummarizer] Summarizing ${unprocessedMessages.length} messages for ${roleId} on ${date}`);

  const summary = await summarizeConversations(roleId, unprocessedMessages, config);

  if (summary) {
    await appendDailySummary(roleId, date, summary);

    const messageIds = unprocessedMessages
      .map(m => m.id)
      .filter((id): id is number => id !== undefined);

    await updateSummaryState(roleId, state => ({
      ...state,
      lastDailySummary: date,
      summarizedMessageIds: [...state.summarizedMessageIds, ...messageIds]
    }));

    console.log(`[MemorySummarizer] Daily summary saved for ${roleId} on ${date}`);
  }

  return summary;
}

async function getDailySummaryForDate(roleId: string, date: string): Promise<string> {
  const memoryPath = getMemoryPath(roleId);
  const dailyFile = path.join(memoryPath, `memory-${date}.md`);

  if (!fileExists(dailyFile)) {
    return '';
  }

  const content = await readTextFile(dailyFile);
  return filterPrivateContent(content || '');
}

export async function updateLongTermFromDaily(
  roleId: string,
  date: string,
  config: ModelConfig
): Promise<string> {
  const dailySummary = await getDailySummaryForDate(roleId, date);

  if (!dailySummary.trim()) {
    console.log(`[MemorySummarizer] No daily summary found for ${roleId} on ${date}`);
    return '';
  }

  const existingLongTerm = await getLongTermMemory(roleId, false);
  const role = await getRole(roleId);
  const roleName = role?.name || roleId;

  const systemPrompt = `你是一个长期记忆管理助手。请根据新的每日总结，更新${roleName}的长期记忆。

要求：
1. 分析每日总结中的新信息
2. 将新信息有机地整合到现有长期记忆中
3. 避免重复记录相同内容
4. 保持结构清晰，按主题组织（如"关于我"、"关于家人"等）
5. 使用 Markdown 格式
6. 保留原有的 [private] 标记（如果有）
7. 如果现有记忆为空，请创建一个结构良好的长期记忆

现有长期记忆：
${existingLongTerm || '(暂无长期记忆)'}

请输出更新后的完整长期记忆内容。`;

  const newLongTerm = await summarizeWithLLM(config, systemPrompt, dailySummary);

  if (newLongTerm) {
    const memoryPath = getMemoryPath(roleId);
    ensureDir(memoryPath);
    const memoryFile = path.join(memoryPath, 'MEMORY.md');

    const content = newLongTerm.trim().startsWith('#')
      ? newLongTerm
      : `# ${roleName} 的长期记忆\n\n${newLongTerm}`;

    const { writeTextFile: writeFile } = await import('../lib/fs-utils.js');
    await writeFile(memoryFile, content);

    await updateSummaryState(roleId, state => ({
      ...state,
      lastLongTermUpdate: date
    }));

    console.log(`[MemorySummarizer] Long-term memory updated for ${roleId}`);
  }

  return newLongTerm;
}

export async function summarizeAllRolesDaily(date: string, config: ModelConfig): Promise<void> {
  const roles = await listRoles();

  console.log(`[MemorySummarizer] Starting daily summary for ${roles.length} roles on ${date}`);

  for (const role of roles) {
    try {
      await summarizeDaily(role.id, date, config);
    } catch (error) {
      console.error(`[MemorySummarizer] Failed to summarize for ${role.id}:`, error);
    }
  }
}

export async function updateAllRolesLongTerm(date: string, config: ModelConfig): Promise<void> {
  const roles = await listRoles();

  console.log(`[MemorySummarizer] Starting long-term memory update for ${roles.length} roles`);

  for (const role of roles) {
    try {
      await updateLongTermFromDaily(role.id, date, config);
    } catch (error) {
      console.error(`[MemorySummarizer] Failed to update long-term memory for ${role.id}:`, error);
    }
  }
}

export { loadSummaryState as getSummaryState, getUnprocessedMessages };
