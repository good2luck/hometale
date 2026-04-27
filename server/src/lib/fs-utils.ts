import fs from 'node:fs';
import path from 'node:path';

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function writeJsonFile(filePath: string, data: any): Promise<void> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  await fs.promises.rename(tempPath, filePath);
}

export async function readTextFile(
  filePath: string,
  options?: { maxLines?: number; maxChars?: number }
): Promise<string | null> {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    let content = await fs.promises.readFile(filePath, 'utf-8');

    if (options?.maxLines && options.maxLines > 0) {
      const lines = content.split('\n');
      if (lines.length > options.maxLines) {
        const kept = lines.slice(0, options.maxLines);
        kept.push(`... (${lines.length - options.maxLines} more lines)`);
        content = kept.join('\n');
      }
    }

    if (options?.maxChars && options.maxChars > 0 && content.length > options.maxChars) {
      content = content.slice(0, options.maxChars) + `\n... (${content.length - options.maxChars} more chars)`;
    }

    return content;
  } catch {
    return null;
  }
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, content, 'utf-8');
  await fs.promises.rename(tempPath, filePath);
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function listDirectories(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
}

// 编辑文件（精确替换）
export async function editTextFile(
  filePath: string,
  oldString: string,
  newString: string
): Promise<boolean> {
  const content = await readTextFile(filePath);
  if (content === null) {
    return false;
  }
  if (!content.includes(oldString)) {
    return false;
  }
  const newContent = content.replace(oldString, newString);
  await writeTextFile(filePath, newContent);
  return true;
}

// 删除文件
export async function deleteFile(filePath: string): Promise<boolean> {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    await fs.promises.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

// 列出目录内容（包含文件和目录）
export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

export function listDirectory(dirPath: string): DirectoryEntry[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .map(dirent => ({
      name: dirent.name,
      isDirectory: dirent.isDirectory(),
      isFile: dirent.isFile()
    }));
}

export async function listFilesAsync(dirPath: string): Promise<string[]> {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return await fs.promises.readdir(dirPath);
}

// 搜索文件内容
export interface SearchMatch {
  filePath: string;
  lineNumber: number;
  line: string;
}

export async function searchFiles(
  pattern: string,
  searchPath: string,
  limit?: number
): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = [];

  if (!fs.existsSync(searchPath)) {
    return matches;
  }

  const maxMatches = limit && limit > 0 ? limit : undefined;

  const stat = fs.statSync(searchPath);

  if (stat.isFile()) {
    const content = await readTextFile(searchPath);
    if (content) {
      const lines = content.split('\n');
      for (let index = 0; index < lines.length; index++) {
        if (maxMatches !== undefined && matches.length >= maxMatches) {
          break;
        }
        const line = lines[index];
        if (line.includes(pattern)) {
          matches.push({
            filePath: searchPath,
            lineNumber: index + 1,
            line: line.trim()
          });
        }
      }
    }
  } else if (stat.isDirectory()) {
    const entries = listDirectory(searchPath);
    for (const entry of entries) {
      if (maxMatches !== undefined && matches.length >= maxMatches) {
        break;
      }
      const fullPath = path.join(searchPath, entry.name);
      const remaining = maxMatches !== undefined ? maxMatches - matches.length : undefined;
      const subMatches = await searchFiles(pattern, fullPath, remaining);
      matches.push(...subMatches);
    }
  }

  return matches;
}
