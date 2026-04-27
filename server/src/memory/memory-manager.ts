import path from 'node:path';
import { getMemoryPath, getRolesPath, ensureDir } from '../lib/hometale-path.js';
import { readTextFile, writeTextFile, fileExists, listDirectories } from '../lib/fs-utils.js';
import type { ConversationMessage } from './types.js';
import { getRole } from '../roles/role-manager.js';

const PRIVATE_MARKER = '[private]';

export function filterPrivateContent(content: string): string {
  const lines = content.split('\n');
  const filteredLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(PRIVATE_MARKER)) {
      filteredLines.push(line);
    }
  }

  return filteredLines.join('\n');
}

export function hasPrivateMarker(content: string): boolean {
  return content.includes(PRIVATE_MARKER);
}

export async function getLongTermMemory(roleId: string, filterPrivate: boolean = true): Promise<string> {
  const memoryPath = getMemoryPath(roleId);
  const memoryFile = path.join(memoryPath, 'MEMORY.md');

  if (!fileExists(memoryFile)) {
    return '';
  }

  const content = await readTextFile(memoryFile) || '';
  return filterPrivate ? filterPrivateContent(content) : content;
}

export async function updateLongTermMemory(roleId: string, content: string): Promise<void> {
  const memoryPath = getMemoryPath(roleId);
  ensureDir(memoryPath);

  const memoryFile = path.join(memoryPath, 'MEMORY.md');
  let existingContent = '';

  if (fileExists(memoryFile)) {
    existingContent = await readTextFile(memoryFile) || '';
  }

  const newContent = existingContent
    ? `${existingContent}\n\n${content}`
    : `# ${roleId} 的长期记忆\n\n${content}`;

  await writeTextFile(memoryFile, newContent);
}

export async function appendDailySummary(roleId: string, date: string, summary: string): Promise<void> {
  const memoryPath = getMemoryPath(roleId);
  ensureDir(memoryPath);

  const dailyFile = path.join(memoryPath, `memory-${date}.md`);
  let existingContent = '';

  if (fileExists(dailyFile)) {
    existingContent = await readTextFile(dailyFile) || '';
  }

  const newContent = existingContent
    ? `${existingContent}\n\n${summary}`
    : `# ${date} 对话总结\n\n${summary}`;

  await writeTextFile(dailyFile, newContent);
}

// appendConversation is deprecated - use message-db instead
export async function appendConversation(
  _roleId: string,
  _conversationId: string,
  _messages: ConversationMessage[]
): Promise<void> {
  console.warn('[memory-manager] appendConversation is deprecated, no longer writing conv- files');
}

export async function getMemoryForAgent(roleId: string, targetRoleId?: string): Promise<string> {
  let result = '';

  if (targetRoleId) {
    const role = await getRole(targetRoleId);
    if (role) {
      const memory = await getLongTermMemory(targetRoleId, true);
      result += `## ${role.name} 的记忆\n\n${memory}\n\n`;
    }
  } else {
    const ownMemory = await getLongTermMemory(roleId, true);
    result += `## 我的记忆\n\n${ownMemory}\n\n`;

    const rolesDir = getRolesPath();
    const allRoleIds = listDirectories(rolesDir);

    for (const otherRoleId of allRoleIds) {
      if (otherRoleId !== roleId) {
        const role = await getRole(otherRoleId);
        if (role) {
          const memory = await getLongTermMemory(otherRoleId, true);
          if (memory.trim()) {
            result += `## ${role.name} 的记忆\n\n${memory}\n\n`;
          }
        }
      }
    }
  }

  return result;
}
