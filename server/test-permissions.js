#!/usr/bin/env node
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 动态导入模块
const { canPerformAction, resolveAndValidatePath } = await import('./dist/agent-core/tools/permissions.js');
const { getHometaleRoot, getRolesPath } = await import('./dist/lib/hometale-path.js');

console.log('=== 权限检查调试 ===\n');

const hometaleRoot = getHometaleRoot();
const rolesPath = getRolesPath();

console.log('Hometale Root:', hometaleRoot);
console.log('Roles Path:', rolesPath);
console.log();

// 测试路径解析
const testPaths = [
  'roles/dad/INDEX.md',
  '/Users/xudejian/.hometale/roles/dad/INDEX.md',
  'README.md',
  '.',
];

console.log('=== 路径解析测试 ===');
for (const testPath of testPaths) {
  console.log(`\n测试路径: ${testPath}`);
  const resolved = resolveAndValidatePath(testPath);
  console.log(`解析结果: ${resolved || 'null (无效)'}`);
}

console.log('\n=== 权限检查测试 ===');
const roleId = 'dad';
const testCases = [
  { action: 'read', path: 'roles/dad/INDEX.md' },
  { action: 'read', path: 'README.md' },
  { action: 'read', path: '.' },
];

for (const testCase of testCases) {
  console.log(`\n检查: role=${roleId}, action=${testCase.action}, path=${testCase.path}`);
  const result = canPerformAction(roleId, testCase.action, testCase.path);
  console.log(`结果: ${result ? '✅ 允许' : '❌ 拒绝'}`);
}
