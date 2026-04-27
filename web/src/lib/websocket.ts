export interface WebSocketMessage {
  type: string;
  data: any;
  id?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface RoleInfo {
  id: string;
  name: string;
  avatar?: string;
}

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

export interface ToolCallMessage {
  id: string;
  type: 'tool_call';
  data: ToolCallData;
  timestamp: string;
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

export interface ShellExecMessage {
  id: string;
  type: 'shell_exec';
  data: ShellExecData;
  timestamp: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
export type AuthStatus = 'unauthenticated' | 'authenticating' | 'authenticated';

interface WebSocketClientOptions {
  url?: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
}

const CACHE_KEY_TOKEN = 'hometale_ws_token';
const CACHE_KEY_ROLE = 'hometale_ws_role';
const CACHE_KEY_SESSION_ID = 'hometale_session_id';

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private autoReconnect: boolean;
  private reconnectInterval: number;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private streamingMessage: ChatMessage | null = null;
  private cachedToken: string | null = null;
  private hasReceivedHistory: boolean = false;

  connectionStatus: ConnectionStatus = 'disconnected';
  authStatus: AuthStatus = 'unauthenticated';
  sessionId: string | null = null;
  role: RoleInfo | null = null;
  messages: ChatMessage[] = [];
  isTyping: boolean = false;
  toolCalls: ToolCallMessage[] = [];
  shellExecs: ShellExecMessage[] = [];

  // Event handlers
  onStatusChange?: (status: ConnectionStatus) => void;
  onAuthChange?: (status: AuthStatus) => void;
  onMessage?: (message: ChatMessage) => void;
  onMessageUpdate?: (message: ChatMessage) => void;
  onMessagesReset?: () => void;
  onTypingChange?: (isTyping: boolean) => void;
  onError?: (error: string) => void;
  onAuthRequired?: () => void;
  onAuthenticated?: (sessionId: string) => void;
  onAuthFailed?: (message: string) => void;
  onRoleChange?: (role: RoleInfo | null) => void;
  onToolCall?: (toolCall: ToolCallMessage) => void;
  onToolCallUpdate?: (toolCall: ToolCallMessage) => void;
  onShellExec?: (shellExec: ShellExecMessage) => void;
  onShellExecUpdate?: (shellExec: ShellExecMessage) => void;

  constructor(options: WebSocketClientOptions = {}) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    this.url = options.url || `${protocol}//${host}/ws`;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectInterval = options.reconnectInterval ?? 3000;
    // 从缓存读取 token、role 和 sessionId
    this.cachedToken = this.getCachedToken();
    this.role = this.getCachedRole();
    this.sessionId = this.getCachedSessionId();
  }

  // === 缓存相关方法 ===
  private getCachedToken(): string | null {
    try {
      const token = localStorage.getItem(CACHE_KEY_TOKEN);
      console.log('[WebSocket] 从 localStorage 读取 token:', token ? '存在' : '不存在');
      return token;
    } catch (e) {
      console.error('[WebSocket] 读取 token 失败:', e);
      return null;
    }
  }

  private saveTokenToCache(token: string) {
    try {
      console.log('[WebSocket] 保存 token 到 localStorage');
      localStorage.setItem(CACHE_KEY_TOKEN, token);
      this.cachedToken = token;
    } catch (e) {
      console.error('[WebSocket] 保存 token 失败:', e);
    }
  }

  private getCachedRole(): RoleInfo | null {
    try {
      const roleStr = localStorage.getItem(CACHE_KEY_ROLE);
      if (roleStr) {
        console.log('[WebSocket] 从 localStorage 读取 role');
        return JSON.parse(roleStr);
      }
      return null;
    } catch (e) {
      console.error('[WebSocket] 读取 role 失败:', e);
      return null;
    }
  }

  private saveRoleToCache(role: RoleInfo) {
    try {
      console.log('[WebSocket] 保存 role 到 localStorage:', role);
      localStorage.setItem(CACHE_KEY_ROLE, JSON.stringify(role));
      this.role = role;
      this.onRoleChange?.(role);
    } catch (e) {
      console.error('[WebSocket] 保存 role 失败:', e);
    }
  }

  private getCachedSessionId(): string | null {
    try {
      const sessionId = localStorage.getItem(CACHE_KEY_SESSION_ID);
      console.log('[WebSocket] 从 localStorage 读取 sessionId:', sessionId ? '存在' : '不存在');
      return sessionId;
    } catch (e) {
      console.error('[WebSocket] 读取 sessionId 失败:', e);
      return null;
    }
  }

  // 公共方法：获取缓存的 sessionId（不修改状态）
  public peekCachedSessionId(): string | null {
    return this.getCachedSessionId();
  }

  private saveSessionIdToCache(sessionId: string) {
    try {
      console.log('[WebSocket] 保存 sessionId 到 localStorage');
      localStorage.setItem(CACHE_KEY_SESSION_ID, sessionId);
      this.sessionId = sessionId;
    } catch (e) {
      console.error('[WebSocket] 保存 sessionId 失败:', e);
    }
  }

  private clearSessionIdCache() {
    try {
      console.log('[WebSocket] 清除 sessionId 缓存');
      localStorage.removeItem(CACHE_KEY_SESSION_ID);
      this.sessionId = null;
    } catch (e) {
      console.error('[WebSocket] 清除 sessionId 缓存失败:', e);
    }
  }

  private clearRoleCache() {
    try {
      console.log('[WebSocket] 清除 role 缓存');
      localStorage.removeItem(CACHE_KEY_ROLE);
      this.role = null;
      this.onRoleChange?.(null);
    } catch (e) {
      console.error('[WebSocket] 清除 role 缓存失败:', e);
    }
  }

  hasCachedToken(): boolean {
    return !!this.cachedToken;
  }

  getRole(): RoleInfo | null {
    return this.role;
  }

  setRole(role: RoleInfo) {
    this.saveRoleToCache(role);
  }

  clearSessionCache() {
    console.log('[WebSocket] 清除 session 缓存（保留 token）');
    this.clearSessionIdCache();
    this.messages = [];
    this.streamingMessage = null;
    this.clearRoleCache();
    this.resetHistoryReceivedFlag();
  }

  connect(token?: string) {
    console.log('[WebSocket] connect 被调用, token:', token ? '***' : 'undefined', 'cachedToken:', this.cachedToken ? '***' : 'undefined');
    if (this.connectionStatus === 'connecting' || this.connectionStatus === 'connected') {
      console.log('[WebSocket] 已在连接中或已连接，跳过');
      return;
    }

    this.connectionStatus = 'connecting';
    this.updateConnectionStatus();

    // 优先使用传入的 token，其次使用缓存的 token
    const tokenToUse = token || this.cachedToken;
    console.log('[WebSocket] 使用的 token:', tokenToUse ? '***' : 'none');

    // 如果传入了新 token，保存它
    if (token) {
      this.saveTokenToCache(token);
    }

    // 获取缓存的会话 sessionId
    const cachedSessionId = this.getCachedSessionId();
    console.log('[WebSocket] 缓存的会话 sessionId:', cachedSessionId);

    let url = this.url;
    const params: string[] = [];
    if (tokenToUse) {
      params.push(`token=${encodeURIComponent(tokenToUse)}`);
    }
    // 使用缓存的会话 sessionId，而不是 this.sessionId（可能是连接 ID）
    if (cachedSessionId) {
      params.push(`sessionId=${encodeURIComponent(cachedSessionId)}`);
    }
    if (params.length > 0) {
      url += `?${params.join('&')}`;
    }
    console.log('[WebSocket] 连接 URL:', url);

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[WebSocket] onopen - 连接已建立');
      this.connectionStatus = 'connected';
      this.updateConnectionStatus();
      this.cancelReconnect();
    };

    this.ws.onclose = (event) => {
      console.log('[WebSocket] onclose - 连接断开, code:', event.code, 'reason:', event.reason);
      this.connectionStatus = 'disconnected';
      this.authStatus = 'unauthenticated';
      // 注意：不清除 sessionId 缓存，以便刷新后恢复
      this.streamingMessage = null;
      // 重置历史消息接收标志，重新连接时可以再次清空消息
      this.resetHistoryReceivedFlag();
      this.updateConnectionStatus();
      this.updateAuthStatus();

      if (this.autoReconnect && event.code !== 1008) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (error) => {
      console.error('[WebSocket] onerror:', error);
      this.triggerError('连接错误');
    };

    this.ws.onmessage = (event) => {
      console.log('[WebSocket] onmessage:', event.data);
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        console.log('[WebSocket] 解析后的消息:', message);
        this.handleMessage(message);
      } catch (err) {
        console.error('[WebSocket] 解析消息失败:', err);
      }
    };
  }

  disconnect() {
    this.autoReconnect = false;
    this.cancelReconnect();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connectionStatus = 'disconnected';
    this.authStatus = 'unauthenticated';
    // 注意：不清除 sessionId、cachedToken 和 role 缓存，保留以便刷新后恢复
    this.messages = [];
    this.streamingMessage = null;
    this.isTyping = false;
    this.toolCalls = [];
    this.shellExecs = [];
    this.updateConnectionStatus();
    this.updateAuthStatus();
  }

  authenticate(token: string) {
    console.log('[WebSocket] 调用 authenticate，token:', token ? '***' : 'empty');
    if (this.authStatus !== 'unauthenticated') {
      console.log('[WebSocket] 已经在认证过程中或已认证，跳过');
      return;
    }
    this.authStatus = 'authenticating';
    // 先保存 token，后续 authenticated 消息会再次确认保存
    this.saveTokenToCache(token);
    this.updateAuthStatus();
    this.send({
      type: 'authenticate',
      data: { token }
    });
  }

  sendMessage(content: string) {
    if (!content.trim()) {
      return;
    }

    // 结束之前的流式消息
    this.streamingMessage = null;

    // 添加用户消息到本地
    const userMessage: ChatMessage = {
      role: 'user',
      content,
      timestamp: new Date().toISOString()
    };
    this.messages.push(userMessage);
    this.triggerMessage(userMessage);

    this.send({
      type: 'message',
      data: { content }
    });
  }

  private send(message: WebSocketMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(message: WebSocketMessage) {
    switch (message.type) {
      case 'auth_required':
        this.authStatus = 'unauthenticated';
        this.updateAuthStatus();
        this.onAuthRequired?.();
        break;

      case 'authenticated':
        console.log('[WebSocket] 收到 authenticated 消息, message.data:', message.data);
        this.authStatus = 'authenticated';

        // 如果是通过 sessionId 连接的，我们已经有 sessionId 了，不需要覆盖
        // 只有当没有 sessionId 时，才保存后端返回的（这是 WebSocket 连接 ID，不是会话 ID）
        if (!this.sessionId && message.data.sessionId) {
          console.log('[WebSocket] 保存连接 ID:', message.data.sessionId);
          // 注意：这里不保存到缓存，因为这是 WebSocket 连接 ID，不是会话 ID
        }

        // 确保 token 已保存
        if (this.cachedToken) {
          console.log('[WebSocket] 使用缓存的 token，确保已保存');
          this.saveTokenToCache(this.cachedToken);
        }
        this.updateAuthStatus();
        this.onAuthenticated?.(message.data.sessionId);

        // 只有在两种情况下才发送 set_role：
        // 1. 有缓存的角色
        // 2. 没有会话 sessionId（说明不是通过 sessionId 连接的）
        // 3. 还没有设置 role（通过检查 this.role 是否存在，但这可能不可靠）
        // 更简单：只有在没有 sessionId 缓存时，才尝试设置角色
        const cachedSessionId = this.getCachedSessionId();
        if (this.role && !cachedSessionId) {
          console.log('[WebSocket] 有缓存的角色但没有 sessionId，自动设置:', this.role);
          this.send({
            type: 'set_role',
            data: { roleId: this.role.id }
          });
        }
        break;

      case 'auth_failed':
        this.authStatus = 'unauthenticated';
        this.updateAuthStatus();
        this.onAuthFailed?.(message.data.message);
        break;

      case 'message':
        this.streamingMessage = null;
        const chatMessage: ChatMessage = {
          role: message.data.role || 'assistant',
          content: message.data.content,
          timestamp: message.data.timestamp || new Date().toISOString()
        };
        this.messages.push(chatMessage);
        this.triggerMessage(chatMessage);
        break;

      case 'message_chunk':
        const chunk = message.data;
        if (chunk.isFirst) {
          // 开始新的流式消息
          this.streamingMessage = {
            role: 'assistant',
            content: chunk.content,
            timestamp: chunk.timestamp || new Date().toISOString()
          };
          this.messages.push(this.streamingMessage);
          this.triggerMessage(this.streamingMessage);
        } else if (this.streamingMessage) {
          // 追加内容到当前流式消息
          this.streamingMessage.content += chunk.content;
          this.onMessageUpdate?.(this.streamingMessage);
        }
        if (chunk.isLast) {
          // 结束流式消息
          this.streamingMessage = null;
        }
        break;

      case 'typing':
        this.isTyping = message.data.isTyping;
        this.onTypingChange?.(this.isTyping);
        break;

      case 'error':
        this.triggerError(message.data.message);
        break;

      case 'tool_call':
        this.handleToolCall(message.data as ToolCallData);
        break;

      case 'shell_exec':
        this.handleShellExec(message.data as ShellExecData);
        break;

      case 'history_messages':
        // 收到历史消息，如果是第一次接收，先清空现有消息
        if (message.data.messages && Array.isArray(message.data.messages)) {
          // 第一次接收历史消息时，清空现有消息避免重复
          if (!this.hasReceivedHistory) {
            console.log('[WebSocket] 首次接收历史消息，清空现有消息');
            this.messages = [];
            this.hasReceivedHistory = true;
            this.onMessagesReset?.();
          }

          for (const histMsg of message.data.messages) {
            const chatMessage: ChatMessage = {
              role: histMsg.role,
              content: histMsg.content,
              timestamp: histMsg.timestamp
            };
            this.messages.push(chatMessage);
            this.triggerMessage(chatMessage);
          }
        }
        break;

      case 'session_created':
        // 收到新创建的 sessionId，保存到缓存
        if (message.data.sessionId) {
          this.saveSessionIdToCache(message.data.sessionId);
        }
        break;
    }
  }

  private handleToolCall(data: ToolCallData) {
    console.log('[WebSocket] handleToolCall 被调用:', data);
    // 直接使用 toolId 作为唯一标识，不要和 startTime 拼接
    const messageId = data.toolId;
    console.log('[WebSocket] messageId:', messageId);
    const existingIndex = this.toolCalls.findIndex(tc => tc.id === messageId);
    console.log('[WebSocket] existingIndex:', existingIndex);

    const toolCallMessage: ToolCallMessage = {
      id: messageId,
      type: 'tool_call',
      data,
      timestamp: data.startTime
    };

    console.log('[WebSocket] toolCallMessage:', toolCallMessage);

    if (existingIndex >= 0) {
      // 更新已有的tool call
      this.toolCalls[existingIndex] = toolCallMessage;
      console.log('[WebSocket] 更新已有的 tool call, toolCalls 现在:', this.toolCalls);
      this.onToolCallUpdate?.(toolCallMessage);
    } else {
      // 新的tool call
      this.toolCalls.push(toolCallMessage);
      console.log('[WebSocket] 添加新的 tool call, toolCalls 现在:', this.toolCalls);
      this.onToolCall?.(toolCallMessage);
    }
  }

  private handleShellExec(data: ShellExecData) {
    const messageId = `${data.command}-${data.startTime}`;
    const existingIndex = this.shellExecs.findIndex(se => se.id === messageId);

    const shellExecMessage: ShellExecMessage = {
      id: messageId,
      type: 'shell_exec',
      data,
      timestamp: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      // 更新已有的shell exec
      this.shellExecs[existingIndex] = shellExecMessage;
      this.onShellExecUpdate?.(shellExecMessage);
    } else {
      // 新的shell exec
      this.shellExecs.push(shellExecMessage);
      this.onShellExec?.(shellExecMessage);
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) {
      return;
    }
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, this.reconnectInterval);
  }

  private cancelReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private updateConnectionStatus() {
    this.onStatusChange?.(this.connectionStatus);
  }

  private updateAuthStatus() {
    this.onAuthChange?.(this.authStatus);
  }

  private triggerMessage(message: ChatMessage) {
    this.onMessage?.(message);
  }

  private triggerError(error: string) {
    this.onError?.(error);
  }

  resetMessages() {
    this.messages = [];
    this.streamingMessage = null;
    this.toolCalls = [];
    this.shellExecs = [];
    this.onMessagesReset?.();
  }

  resetActivityLogs() {
    this.toolCalls = [];
    this.shellExecs = [];
  }

  /**
   * 重置历史消息接收标志
   * 在重新连接等场景下调用，确保下次接收历史消息时能清空现有消息
   */
  resetHistoryReceivedFlag() {
    this.hasReceivedHistory = false;
  }
}

// 单例实例
let clientInstance: WebSocketClient | null = null;

export function getWebSocketClient(options?: WebSocketClientOptions): WebSocketClient {
  if (!clientInstance) {
    clientInstance = new WebSocketClient(options);
  }
  return clientInstance;
}
