import path from 'node:path';
import { getRolesPath, getRolePath, ensureDir, getMemoryPath } from '../lib/hometale-path.js';
import { readTextFile, writeTextFile, fileExists, listDirectories } from '../lib/fs-utils.js';
import type { Role } from './types.js';

export function parseRoleIndex(content: string): Role | null {
  const lines = content.split('\n');
  const role: Partial<Role> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- 角色 ID:')) {
      role.id = trimmed.substring('- 角色 ID:'.length).trim();
    } else if (trimmed.startsWith('- 名字:')) {
      role.name = trimmed.substring('- 名字:'.length).trim();
    } else if (trimmed.startsWith('- 头像:')) {
      role.avatar = trimmed.substring('- 头像:'.length).trim();
    } else if (trimmed.startsWith('- 机器人身份:')) {
      role.robotIdentity = trimmed.substring('- 机器人身份:'.length).trim();
    } else if (trimmed.startsWith('- 创建时间:')) {
      role.createdAt = trimmed.substring('- 创建时间:'.length).trim();
    }
  }

  if (!role.id || !role.name || !role.avatar || !role.robotIdentity || !role.createdAt) {
    return null;
  }

  return role as Role;
}

export function generateRoleIndex(role: Role): string {
  return `# ${role.name} - 角色配置

- 角色 ID: ${role.id}
- 名字: ${role.name}
- 头像: ${role.avatar}
- 机器人身份: ${role.robotIdentity}
- 创建时间: ${role.createdAt}

---

密码哈希: ${role.hashedPassword || ''}
`;
}

export async function listRoles(): Promise<Role[]> {
  const rolesDir = getRolesPath();
  const roleIds = listDirectories(rolesDir);
  const roles: Role[] = [];

  for (const roleId of roleIds) {
    const role = await getRole(roleId);
    if (role) {
      roles.push(role);
    }
  }

  return roles;
}

export async function getRole(roleId: string): Promise<Role | null> {
  const indexPath = path.join(getRolePath(roleId), 'INDEX.md');
  if (!fileExists(indexPath)) {
    return null;
  }
  const content = await readTextFile(indexPath);
  if (!content) {
    return null;
  }
  return parseRoleIndex(content);
}

export async function createRole(role: Role): Promise<void> {
  const roleDir = getRolePath(role.id);
  const memoryDir = getMemoryPath(role.id);
  ensureDir(roleDir);
  ensureDir(memoryDir);

  const indexPath = path.join(roleDir, 'INDEX.md');
  const content = generateRoleIndex(role);
  await writeTextFile(indexPath, content);
}

export function guessRoleInfo(input: string): { id: string; name: string; avatar: string } | null {
  const lower = input.toLowerCase();

  const roleMap: Record<string, { id: string; name: string; avatar: string }> = {
    '爸爸': { id: 'dad', name: '爸爸', avatar: '👨' },
    'dad': { id: 'dad', name: '爸爸', avatar: '👨' },
    '妈妈': { id: 'mom', name: '妈妈', avatar: '👩' },
    'mom': { id: 'mom', name: '妈妈', avatar: '👩' },
    '爷爷': { id: 'grandpa', name: '爷爷', avatar: '👴' },
    'grandpa': { id: 'grandpa', name: '爷爷', avatar: '👴' },
    '奶奶': { id: 'grandma', name: '奶奶', avatar: '👵' },
    'grandma': { id: 'grandma', name: '奶奶', avatar: '👵' }
  };

  for (const [key, info] of Object.entries(roleMap)) {
    if (lower.includes(key)) {
      return info;
    }
  }

  return null;
}
