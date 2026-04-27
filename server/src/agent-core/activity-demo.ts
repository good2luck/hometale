/**
 * 示例：如何在智能体代码中发送 tool_call 和 shell_exec 消息
 *
 * 这个文件展示了如何使用 WebSocketSession 中新增的方法
 * 来向客户端发送智能体执行tool调用和shell命令的实时反馈
 */

import type { WebSocketSession } from './websocket-session.js';

// ============================================================================
// 示例 1: Tool 调用
// ============================================================================

export async function executeToolExample(session: WebSocketSession) {
  const toolId = 'read_file';
  const toolName = '读取文件';
  const input = { path: '/Users/xudejian/hometale/README.md' };
  const startTime = new Date().toISOString();

  try {
    // 1. 发送开始执行消息
    session.sendToolCallStarted(toolId, toolName, input);

    // 2. 实际执行 tool 逻辑
    // ... 这里是你的 tool 执行代码 ...
    const output = {
      success: true,
      content: '# HomeTale\n这是一个家庭助手项目...',
      fileSize: 1024
    };

    // 模拟延迟
    await new Promise(resolve => setTimeout(resolve, 500));

    // 3. 发送完成消息
    session.sendToolCallCompleted(toolId, toolName, input, output, startTime);

  } catch (error) {
    // 4. 发送错误消息
    session.sendToolCallError(
      toolId,
      toolName,
      input,
      error instanceof Error ? error.message : '未知错误',
      startTime
    );
  }
}

// ============================================================================
// 示例 2: Shell 命令执行
// ============================================================================

export async function executeShellExample(session: WebSocketSession) {
  const command = 'ls';
  const args = ['-la', '/Users/xudejian/hometale'];
  const cwd = '/Users/xudejian/hometale';
  const startTime = new Date().toISOString();

  try {
    // 1. 发送开始执行消息
    session.sendShellExecStarted(command, args, cwd);

    // 2. 实际执行 shell 命令
    // ... 这里是你的 shell 执行代码 ...
    const stdout = `total 48
drwxr-xr-x   8 xudejian  staff   256 Apr  5 10:00 .
drwxr-xr-x  50 xudejian  staff  1600 Apr  5 09:00 ..
-rw-r--r--   1 xudejian  staff   102 Apr  5 10:00 README.md
drwxr-xr-x  12 xudejian  staff   384 Apr  5 09:30 server
drwxr-xr-x  10 xudejian  staff   320 Apr  5 09:30 web`;
    const stderr = '';
    const exitCode = 0;

    // 模拟延迟
    await new Promise(resolve => setTimeout(resolve, 300));

    // 3. 发送完成消息
    session.sendShellExecCompleted(
      command,
      args,
      cwd,
      stdout,
      stderr,
      exitCode,
      startTime
    );

  } catch (error) {
    // 4. 发送错误消息
    session.sendShellExecError(
      command,
      args,
      cwd,
      error instanceof Error ? error.message : '执行失败',
      startTime
    );
  }
}

// ============================================================================
// 示例 3: 在 MessageHandler 中集成
// ============================================================================

/*
// 在 message-handler.ts 中这样使用：

private async handleChat(session: WebSocketSession, userMessage: string) {
  // ... 现有代码 ...

  // 当需要执行 tool 时
  if (userMessage.includes('读取文件')) {
    await executeToolExample(session);
  }

  // 当需要执行 shell 命令时
  if (userMessage.includes('列出文件')) {
    await executeShellExample(session);
  }

  // ... 继续其他逻辑 ...
}
*/

// ============================================================================
// 消息类型说明
// ============================================================================

/*
发送的 WebSocket 消息格式：

1. Tool Call 开始:
{
  type: 'tool_call',
  data: {
    toolId: 'read_file',
    toolName: '读取文件',
    input: { path: '/path/to/file' },
    status: 'started',
    startTime: '2024-04-05T10:00:00.000Z'
  }
}

2. Tool Call 完成:
{
  type: 'tool_call',
  data: {
    toolId: 'read_file',
    toolName: '读取文件',
    input: { path: '/path/to/file' },
    output: { ... },
    status: 'completed',
    startTime: '2024-04-05T10:00:00.000Z',
    endTime: '2024-04-05T10:00:01.500Z',
    durationMs: 1500
  }
}

3. Shell Exec 开始:
{
  type: 'shell_exec',
  data: {
    command: 'ls',
    args: ['-la'],
    cwd: '/path',
    status: 'started',
    startTime: '2024-04-05T10:00:00.000Z'
  }
}

4. Shell Exec 完成:
{
  type: 'shell_exec',
  data: {
    command: 'ls',
    args: ['-la'],
    cwd: '/path',
    stdout: '...',
    stderr: '',
    exitCode: 0,
    status: 'completed',
    startTime: '2024-04-05T10:00:00.000Z',
    endTime: '2024-04-05T10:00:00.300Z',
    durationMs: 300
  }
}
*/
