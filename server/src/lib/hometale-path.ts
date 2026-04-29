import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { writeTextFile, fileExists } from './fs-utils.js';

export function getHometaleRoot(): string {
  const homedir = os.homedir();
  return path.join(homedir, '.hometale');
}

export function getRolesPath(): string {
  return path.join(getHometaleRoot(), 'roles');
}

export function getRolePath(roleId: string): string {
  return path.join(getRolesPath(), roleId);
}

export function getMemoryPath(roleId: string): string {
  return path.join(getRolePath(roleId), 'memory');
}

export function getSessionsPath(): string {
  return path.join(getHometaleRoot(), 'sessions');
}

export function getConfigPath(): string {
  return path.join(getHometaleRoot(), 'config.json');
}

export function getAgentsPath(): string {
  return path.join(getHometaleRoot(), 'AGENTS.md');
}

export function getMessagesDbPath(): string {
  return path.join(getHometaleRoot(), 'messages.db');
}

export function getSkillsPath(): string {
  return path.join(getHometaleRoot(), 'skills');
}

export function getWeixinPath(): string {
  return path.join(getHometaleRoot(), 'weixin');
}

export function getWeixinAccountsPath(): string {
  return path.join(getWeixinPath(), 'accounts');
}

export function getWeixinAccountPath(accountId: string): string {
  return path.join(getWeixinAccountsPath(), `${accountId}.json`);
}

export function getWeixinSyncBufPath(accountId: string): string {
  return path.join(getWeixinAccountsPath(), `${accountId}.sync.json`);
}

export function getWeixinContextTokensPath(accountId: string): string {
  return path.join(getWeixinAccountsPath(), `${accountId}.context-tokens.json`);
}

export function getWeixinUserMappingsPath(): string {
  return path.join(getWeixinPath(), 'user-mappings.json');
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getYesterdayDateString(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return getLocalDateString(yesterday);
}

function generateDefaultAgentsMd(): string {
  return `# HomeTale - 家的故事 - 全局上下文

## 项目核心理念

HomeTale 是"全家人的智能体"——记忆可以在家人之间共享（带隐私控制），智能体懂家庭关系，能做情感关怀和成长记录这类家庭场景的事情。

- **薄而通用**: 核心 Agent 保持简单和通用，不做过多场景化逻辑
- **记忆读取**: 在关心家人时，可以读取家人的长期记忆
- **隐私控制**: 被标记为隐私的内容不会被总结进长期记忆

## 角色列表

| 角色 ID | 称呼 | 说明 |
|---------|------|------|
| dad | 爸爸 | 家庭成员 |
| mom | 妈妈 | 家庭成员 |

## 角色 ID 约定

- 爸爸 → \`dad\`
- 妈妈 → \`mom\`
- 爷爷 → \`grandpa\`
- 奶奶 → \`grandma\`
- 孩子 → 小名转成拼音（如: xiaoming）

## 记忆系统说明

每个角色的 memory/ 目录自包含：

- **MEMORY.md** - 长期记忆，存储关于自己和家人的重要信息
- **memory-YYYY-MM-DD.md** - 每天对话总结

记忆管理规则：
- **默认共享**: 所有记忆默认共享
- **隐私标记**: 内容级别的隐私控制，不是目录级别

## 隐私保护规则

1. **[private] 标记**: 在对话中标记为 [private] 的内容不会被总结进长期记忆，也不会被其他角色读取
2. **private.db**: 每个角色的 roles/{role-id}/private.db 是个人私有 SQLite 数据库，他人无法访问
3. **家人记忆访问**: 读取家人记忆时会自动过滤掉隐私内容

## 何时访问家人记忆

当用户的问题涉及到家人时，智能体会自动读取家人的长期记忆（过滤隐私内容），例如：

- 老婆问："老公爱我们吗？" → 读取老公的记忆，提取关于老婆和孩子的点滴
- 爸爸问："妈妈最近忙什么？" → 读取妈妈的记忆，了解她的近况
- 想给家人准备惊喜 → 读取相关家人的记忆，了解喜好

## 记忆总结时机

- **对话结束后**: 每次对话结束后，会将对话内容总结到当日的 memory-YYYY-MM-DD.md
- **重要内容沉淀**: 系统会从每日总结中提取重要信息，沉淀到长期记忆 MEMORY.md
- **隐私内容过滤**: 标记为 [private] 的内容不会进入总结和长期记忆

## 目录说明

- 各角色数据位于: roles/{role-id}/
- 角色配置: roles/{role-id}/INDEX.md
- 角色记忆: roles/{role-id}/memory/
- 角色私有存储: roles/{role-id}/private.db
`;
}

export async function ensureHometaleStructure(): Promise<void> {
  ensureDir(getHometaleRoot());
  ensureDir(getRolesPath());
  ensureDir(getSessionsPath());
  ensureDir(getSkillsPath());
  ensureDir(getWeixinPath());
  ensureDir(getWeixinAccountsPath());

  const agentsPath = getAgentsPath();
  if (!fileExists(agentsPath)) {
    await writeTextFile(agentsPath, generateDefaultAgentsMd());
  }
}
