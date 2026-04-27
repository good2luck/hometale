import crypto from 'node:crypto';
import WebSocket from 'ws';
import type { Role } from '../roles/types.js';

export type ClientType = 'web' | 'h5' | 'weixin';

// Tool调用相关类型
export interface ToolCallData {
  toolId: string;
  toolName: string;
  input: Record<string, any>;
  status: 'started' | 'completed' | 'error';
  output?: any;
  error?: string;
  startTime: string;
  endTime?: string;
  durationMs?: number;
}

// Shell执行相关类型
export interface ShellExecData {
  command: string;
  args?: string[];
  cwd?: string;
  status: 'started' | 'completed' | 'error';
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  startTime: string;
  endTime?: string;
  durationMs?: number;
}

export interface WebSocketMessage {
  type: string;
  data: any;
  id?: string;
}

export class WebSocketSession {
  readonly id: string;
  readonly clientType: ClientType;
  readonly ws: WebSocket;
  authenticated: boolean = false;
  role: Role | null = null;
  sessionId: string | null = null;
  private configToken: string;

  constructor(ws: WebSocket, configToken: string, userAgent?: string) {
    this.ws = ws;
    this.configToken = configToken;
    this.clientType = this.detectClientType(userAgent);
    this.id = this.generateSessionId();
  }

  private detectClientType(userAgent?: string): ClientType {
    if (!userAgent) return 'web';

    const ua = userAgent.toLowerCase();

    // 微信检测（后续扩展）
    if (ua.includes('micromessenger')) {
      return 'weixin';
    }

    // 移动端检测
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone') || ua.includes('ipad')) {
      return 'h5';
    }

    return 'web';
  }

  private generateSessionId(): string {
    const randomStr = crypto.randomBytes(8).toString('hex');
    return `agent:${this.clientType}:${randomStr}`;
  }

  validateToken(token: string): boolean {
    return token === this.configToken;
  }

  setRole(role: Role) {
    this.role = role;
  }

  send(message: WebSocketMessage) {
    try {
      console.log('[WebSocketSession] 发送消息:', message);
      if (this.ws.readyState === WebSocket.OPEN) {
        // 安全序列化，处理可能的循环引用
        const jsonString = JSON.stringify(message, (_key, value) => {
          if (typeof value === 'function') {
            return undefined;
          }
          return value;
        });
        this.ws.send(jsonString);
      } else {
        console.log('[WebSocketSession] WebSocket 未打开，无法发送消息:', this.ws.readyState);
      }
    } catch (err) {
      console.error('[WebSocketSession] 发送消息失败:', err);
    }
  }

  sendAuthRequired() {
    this.send({
      type: 'auth_required',
      data: { message: '请输入token进行认证' }
    });
  }

  sendAuthenticated() {
    this.send({
      type: 'authenticated',
      data: { sessionId: this.sessionId || this.id }
    });
  }

  sendAuthFailed(message: string = '认证失败，请输入正确的token') {
    this.send({
      type: 'auth_failed',
      data: { message }
    });
  }

  sendMessage(content: string, role: 'user' | 'assistant' = 'assistant') {
    this.send({
      type: 'message',
      data: { content, role, timestamp: new Date().toISOString() }
    });
  }

  sendError(message: string) {
    this.send({
      type: 'error',
      data: { message }
    });
  }

  sendTyping(isTyping: boolean) {
    this.send({
      type: 'typing',
      data: { isTyping }
    });
  }

  sendRolePrompt() {
    this.sendMessage('你是谁？请告诉我你的身份（如：我是爸爸）');
  }

  sendHistoryMessages(messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>) {
    this.send({
      type: 'history_messages',
      data: { messages }
    });
  }

  sendMessageChunk(content: string, isFirst: boolean = false, isLast: boolean = false) {
    this.send({
      type: 'message_chunk',
      data: {
        content,
        isFirst,
        isLast,
        timestamp: new Date().toISOString()
      }
    });
  }

  // === Tool调用相关消息 ===
  sendToolCallStarted(toolId: string, toolName: string, input: Record<string, any>) {
    console.log('[WebSocketSession] sendToolCallStarted 被调用:', { toolId, toolName, input });
    this.send({
      type: 'tool_call',
      data: {
        toolId,
        toolName,
        input,
        status: 'started',
        startTime: new Date().toISOString()
      } satisfies ToolCallData
    });
  }

  sendToolCallCompleted(toolId: string, toolName: string, input: Record<string, any>, output: any, startTime: string) {
    const start = new Date(startTime);
    const end = new Date();
    this.send({
      type: 'tool_call',
      data: {
        toolId,
        toolName,
        input,
        output,
        status: 'completed',
        startTime,
        endTime: end.toISOString(),
        durationMs: end.getTime() - start.getTime()
      } satisfies ToolCallData
    });
  }

  sendToolCallError(toolId: string, toolName: string, input: Record<string, any>, error: string, startTime: string) {
    const start = new Date(startTime);
    const end = new Date();
    this.send({
      type: 'tool_call',
      data: {
        toolId,
        toolName,
        input,
        error,
        status: 'error',
        startTime,
        endTime: end.toISOString(),
        durationMs: end.getTime() - start.getTime()
      } satisfies ToolCallData
    });
  }

  // === Shell执行相关消息 ===
  sendShellExecStarted(command: string, args?: string[], cwd?: string) {
    this.send({
      type: 'shell_exec',
      data: {
        command,
        args,
        cwd,
        status: 'started',
        startTime: new Date().toISOString()
      } satisfies ShellExecData
    });
  }

  sendShellExecCompleted(command: string, args: string[] | undefined, cwd: string | undefined, stdout: string, stderr: string, exitCode: number, startTime: string) {
    const start = new Date(startTime);
    const end = new Date();
    this.send({
      type: 'shell_exec',
      data: {
        command,
        args,
        cwd,
        stdout,
        stderr,
        exitCode,
        status: 'completed',
        startTime,
        endTime: end.toISOString(),
        durationMs: end.getTime() - start.getTime()
      } satisfies ShellExecData
    });
  }

  sendShellExecError(command: string, args: string[] | undefined, cwd: string | undefined, error: string, startTime: string) {
    const start = new Date(startTime);
    const end = new Date();
    this.send({
      type: 'shell_exec',
      data: {
        command,
        args,
        cwd,
        stderr: error,
        status: 'error',
        startTime,
        endTime: end.toISOString(),
        durationMs: end.getTime() - start.getTime()
      } satisfies ShellExecData
    });
  }
}
