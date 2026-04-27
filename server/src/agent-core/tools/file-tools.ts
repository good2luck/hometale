import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  readTextFile,
  writeTextFile,
  editTextFile,
  deleteFile,
  listDirectory,
  searchFiles
} from '../../lib/fs-utils.js';
import { getHometaleRoot } from '../../lib/hometale-path.js';
import { canPerformAction } from './permissions.js';
import { isDangerousCommand } from './safety-checks.js';

const execAsync = promisify(exec);

// 为了向后兼容保留这些函数
let currentRoleId: string | null = null;

export function setCurrentRoleId(roleId: string) {
  currentRoleId = roleId;
}

export function getCurrentRoleId(): string | null {
  return currentRoleId;
}

// 辅助函数：解析路径
function resolvePath(inputPath: string): string {
  const hometaleRoot = getHometaleRoot();
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.join(hometaleRoot, inputPath);
}

// 获取当前 roleId，优先使用闭包传入的，否则回退到全局
function getRoleId(roleId?: string): string {
  if (roleId) return roleId;
  if (currentRoleId) return currentRoleId;
  throw new Error('Role ID not set');
}

// AI SDK v5 工具定义：使用 inputSchema，execute 参数直接解构
export function createFileTools(roleId?: string): ToolSet {
  const resolveRoleId = () => getRoleId(roleId);

  return {
    read_file: tool({
      description: '读取指定文件的内容。路径相对于 ~/.hometale/',
      inputSchema: z.object({
        path: z.string().describe('文件路径，相对于 ~/.hometale/'),
        limit: z.number().optional().describe('最多返回的行数，超出部分将被截断')
      }),
      execute: async (args) => {
        const rid = resolveRoleId();
        const inputPath = args.path;
        if (!canPerformAction(rid, 'read', inputPath)) {
          return `[ERROR] 不允许读取文件: ${inputPath}`;
        }
        const fullPath = resolvePath(inputPath);
        const content = await readTextFile(fullPath, {
          maxLines: args.limit,
          maxChars: 50000
        });
        if (content === null) {
          return `[ERROR] 文件不存在: ${inputPath}`;
        }
        return content;
      }
    }),

    write_file: tool({
      description: '创建新文件或覆盖现有文件。路径相对于 ~/.hometale/',
      inputSchema: z.object({
        path: z.string().describe('文件路径，相对于 ~/.hometale/'),
        content: z.string().describe('要写入的文件内容')
      }),
      execute: async (args) => {
        const rid = resolveRoleId();
        const inputPath = args.path;
        if (!canPerformAction(rid, 'write', inputPath)) {
          return `[ERROR] 不允许写入文件: ${inputPath}`;
        }
        const fullPath = resolvePath(inputPath);
        await writeTextFile(fullPath, args.content);
        return `[SUCCESS] 文件已写入: ${inputPath}`;
      }
    }),

    edit_file: tool({
      description: '精确替换文件中的内容。路径相对于 ~/.hometale/',
      inputSchema: z.object({
        path: z.string().describe('文件路径，相对于 ~/.hometale/'),
        old_string: z.string().describe('要替换的旧内容（必须完全匹配）'),
        new_string: z.string().describe('新内容')
      }),
      execute: async (args) => {
        const rid = resolveRoleId();
        const inputPath = args.path;
        if (!canPerformAction(rid, 'edit', inputPath)) {
          return `[ERROR] 不允许修改文件: ${inputPath}`;
        }
        const fullPath = resolvePath(inputPath);
        const success = await editTextFile(fullPath, args.old_string, args.new_string);
        if (!success) {
          return `[ERROR] 修改失败：文件不存在或找不到匹配的内容: ${inputPath}`;
        }
        return `[SUCCESS] 文件已修改: ${inputPath}`;
      }
    }),

    delete_file: tool({
      description: '删除指定文件。路径相对于 ~/.hometale/。注意：此操作需要用户确认！',
      inputSchema: z.object({
        path: z.string().describe('文件路径，相对于 ~/.hometale/')
      }),
      execute: async (args) => {
        const rid = resolveRoleId();
        const inputPath = args.path;
        if (!canPerformAction(rid, 'delete', inputPath)) {
          return `[ERROR] 不允许删除文件: ${inputPath}`;
        }
        const fullPath = resolvePath(inputPath);
        const success = await deleteFile(fullPath);
        if (!success) {
          return `[ERROR] 删除失败：文件不存在: ${inputPath}`;
        }
        return `[SUCCESS] 文件已删除: ${inputPath}`;
      }
    }),

    list_dir: tool({
      description: '列出指定目录的内容。路径相对于 ~/.hometale/',
      inputSchema: z.object({
        path: z.string().describe('目录路径，相对于 ~/.hometale/')
      }),
      execute: async (args) => {
        const rid = resolveRoleId();
        const inputPath = args.path;
        if (!canPerformAction(rid, 'read', inputPath)) {
          return `[ERROR] 不允许访问目录: ${inputPath}`;
        }
        const fullPath = resolvePath(inputPath);
        const entries = listDirectory(fullPath);
        if (entries.length === 0) {
          return `目录为空或不存在: ${inputPath}`;
        }
        return entries
          .map(e => `${e.isDirectory ? '[DIR]  ' : '[FILE] '} ${e.name}`)
          .join('\n');
      }
    }),

    search_files: tool({
      description: '在文件中搜索指定内容。路径相对于 ~/.hometale/',
      inputSchema: z.object({
        pattern: z.string().describe('要搜索的内容'),
        path: z.string().optional().describe('搜索的起始路径，默认为 ~/.hometale/'),
        limit: z.number().optional().describe('最多返回的匹配结果数，默认为 50')
      }),
      execute: async (args) => {
        const rid = resolveRoleId();
        const inputPath = args.path || '.';
        if (!canPerformAction(rid, 'search', inputPath)) {
          return `[ERROR] 不允许在该路径搜索: ${inputPath}`;
        }
        const fullPath = resolvePath(inputPath);
        const matches = await searchFiles(args.pattern, fullPath, args.limit || 50);
        if (matches.length === 0) {
          return `未找到匹配内容: "${args.pattern}"`;
        }
        const results = matches.map(m =>
          `${m.filePath}:${m.lineNumber}: ${m.line}`
        );
        return results.join('\n');
      }
    }),

    run_bash: tool({
      description: '在 ~/.hometale 目录下执行 shell 命令。用于操作文件、查看系统状态等。危险命令会被自动拦截。',
      inputSchema: z.object({
        command: z.string().describe('要执行的 shell 命令'),
        cwd: z.string().optional().describe('工作目录，相对于 ~/.hometale/，默认为根目录'),
        timeout: z.number().optional().describe('超时时间（秒），默认 120')
      }),
      execute: async (args) => {
        const rid = resolveRoleId();
        const inputPath = args.cwd || '.';

        // 1. 权限检查
        if (!canPerformAction(rid, 'execute', inputPath)) {
          return `[ERROR] 不允许在该目录执行命令: ${inputPath}`;
        }

        // 2. 危险命令检查
        if (isDangerousCommand(args.command)) {
          return `[ERROR] 危险命令被阻止: ${args.command}`;
        }

        // 3. 路径解析
        const fullCwd = resolvePath(inputPath);

        // 4. 执行命令
        try {
          const timeoutMs = (args.timeout || 120) * 1000;
          const { stdout, stderr } = await execAsync(args.command, {
            cwd: fullCwd,
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024 // 1MB
          });

          const output = (stdout + stderr).trim();
          const MAX_OUTPUT = 50000;
          if (output.length > MAX_OUTPUT) {
            return output.slice(0, MAX_OUTPUT) + `\n... (${output.length - MAX_OUTPUT} more chars)`;
          }
          return output || '(no output)';
        } catch (error: any) {
          if (error.killed) {
            return `[ERROR] 命令超时 (${args.timeout || 120}s)`;
          }
          return `[ERROR] ${error.message}`;
        }
      }
    })
  };
}

// 获取所有工具名称（用于工具名称修复）
export function getAllToolNames(): string[] {
  return ['read_file', 'write_file', 'edit_file', 'delete_file', 'list_dir', 'search_files', 'run_bash'];
}
