import path from 'node:path';
import fs from 'node:fs';
import { getHometaleRoot, getRolesPath } from '../../lib/hometale-path.js';
import { listDirectories } from '../../lib/fs-utils.js';

export type ActionType = 'read' | 'write' | 'edit' | 'delete' | 'search' | 'execute';

/**
 * 检查是否允许执行指定操作
 * @param roleId 当前角色 ID
 * @param action 操作类型
 * @param inputPath 目标路径（相对于 ~/.hometale/ 或绝对路径）
 * @returns 是否允许
 */
export function canPerformAction(
  roleId: string,
  action: ActionType,
  inputPath: string
): boolean {
  console.log('[canPerformAction] 调试信息:', { roleId, action, inputPath });

  // 1. 解析并验证路径在沙箱内
  const fullPath = resolveAndValidatePath(inputPath);
  console.log('[canPerformAction] 解析后的路径:', fullPath);
  if (!fullPath) {
    console.log('[canPerformAction] 路径解析失败，拒绝访问');
    return false;
  }

  // 2. 检查是否是记忆文件
  const memoryPathInfo = getMemoryPathInfo(fullPath);
  if (memoryPathInfo) {
    const result = checkMemoryPermission(roleId, action, memoryPathInfo);
    console.log('[canPerformAction] 记忆文件权限检查结果:', result);
    return result;
  }

  // 3. 其他文件都允许
  console.log('[canPerformAction] 非记忆文件，允许访问');
  return true;
}

/**
 * 解析路径并确保在 ~/.hometale/ 沙箱内
 * 返回规范化的绝对路径，或 null 如果路径无效
 */
export function resolveAndValidatePath(inputPath: string): string | null {
  const hometaleRoot = getHometaleRoot();

  // 如果是相对路径，相对于 hometaleRoot
  let absolutePath: string;
  if (path.isAbsolute(inputPath)) {
    absolutePath = path.normalize(inputPath);
  } else {
    absolutePath = path.normalize(path.join(hometaleRoot, inputPath));
  }

  // 确保在 hometaleRoot 内
  try {
    const realPath = fs.realpathSync(absolutePath, { encoding: 'utf8' });
    const realHometaleRoot = fs.realpathSync(hometaleRoot, { encoding: 'utf8' });

    if (!realPath.startsWith(realHometaleRoot + path.sep) && realPath !== realHometaleRoot) {
      return null;
    }

    return realPath;
  } catch {
    // 如果路径不存在，先检查父目录
    const dir = path.dirname(absolutePath);
    try {
      const realDir = fs.realpathSync(dir, { encoding: 'utf8' });
      const realHometaleRoot = fs.realpathSync(hometaleRoot, { encoding: 'utf8' });

      if (!realDir.startsWith(realHometaleRoot + path.sep) && realDir !== realHometaleRoot) {
        return null;
      }

      // 对于新文件，返回规范化路径
      return absolutePath;
    } catch {
      return null;
    }
  }
}

interface MemoryPathInfo {
  roleId: string;
  path: string;
}

/**
 * 检查路径是否指向某个角色的记忆目录
 */
function getMemoryPathInfo(fullPath: string): MemoryPathInfo | null {
  const rolesPath = getRolesPath();
  try {
    const realRolesPath = fs.realpathSync(rolesPath, { encoding: 'utf8' });

    if (!fullPath.startsWith(realRolesPath + path.sep)) {
      return null;
    }

    // 提取 roleId
    const relative = path.relative(realRolesPath, fullPath);
    const parts = relative.split(path.sep);
    if (parts.length < 1) {
      return null;
    }

    const roleId = parts[0];
    const subPath = parts.slice(1).join(path.sep);

    if (subPath.startsWith('memory' + path.sep) || subPath === 'memory') {
      return { roleId, path: fullPath };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 检查记忆文件权限
 */
function checkMemoryPermission(
  currentRoleId: string,
  action: ActionType,
  memoryInfo: MemoryPathInfo
): boolean {
  // 自己的记忆：所有操作都允许
  if (memoryInfo.roleId === currentRoleId) {
    return true;
  }

  // 家人的记忆：仅允许 read 和 search
  return action === 'read' || action === 'search';
}

/**
 * 获取所有角色 ID 列表
 */
export function getAllRoleIds(): string[] {
  const rolesPath = getRolesPath();
  return listDirectories(rolesPath);
}
