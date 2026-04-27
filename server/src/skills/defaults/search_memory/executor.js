import fs from 'node:fs';
import path from 'node:path';
import { getMemoryPath } from '../../lib/hometale-path.js';

export async function execute(params, context) {
  const keyword = params.keyword;
  const limit = params.limit || 10;

  if (!keyword) {
    throw new Error('请提供搜索关键词');
  }

  const memoryDir = getMemoryPath(context.roleId);

  if (!fs.existsSync(memoryDir)) {
    return '暂无记忆文件';
  }

  const results = [];
  const lowerKeyword = keyword.toLowerCase();

  const files = fs.readdirSync(memoryDir);

  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    const filePath = path.join(memoryDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.toLowerCase().includes(lowerKeyword)) {
        results.push({
          file,
          line: i + 1,
          content: line.trim()
        });

        if (results.length >= limit) break;
      }
    }

    if (results.length >= limit) break;
  }

  if (results.length === 0) {
    return `未找到包含 "${keyword}" 的记忆内容`;
  }

  let output = `找到 ${results.length} 条结果（最多显示 ${limit} 条）：\n\n`;
  for (const r of results) {
    output += `[${r.file}:${r.line}] ${r.content}\n`;
  }

  return output;
}
