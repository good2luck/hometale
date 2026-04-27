import { useEffect, useState, useCallback, useRef } from 'react';
import {
  WebSocketClient,
  getWebSocketClient,
  type ChatMessage,
  type ConnectionStatus,
  type AuthStatus,
  type RoleInfo,
  type ToolCallMessage,
  type ShellExecMessage
} from '../lib/websocket';

export function useWebSocket() {
  const clientRef = useRef<WebSocketClient | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [authStatus, setAuthStatus] = useState<AuthStatus>('unauthenticated');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [role, setRoleState] = useState<RoleInfo | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCallMessage[]>([]);
  const [shellExecs, setShellExecs] = useState<ShellExecMessage[]>([]);

  // 初始化client
  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = getWebSocketClient();
    }
    return clientRef.current;
  }, []);

  useEffect(() => {
    const client = getClient();

    // 设置事件处理器
    client.onStatusChange = (status) => setConnectionStatus(status);
    client.onAuthChange = (status) => setAuthStatus(status);
    client.onMessage = (message) => {
      setMessages((prev) => [...prev, message]);
    };
    client.onMessageUpdate = (message) => {
      // 更新最后一条消息
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const lastIndex = prev.length - 1;
        const lastMessage = prev[lastIndex];
        // 只更新assistant消息
        if (lastMessage.role === 'assistant') {
          const newMessages = [...prev];
          newMessages[lastIndex] = { ...message };
          return newMessages;
        }
        return prev;
      });
    };
    client.onMessagesReset = () => setMessages([]);
    client.onTypingChange = (typing) => setIsTyping(typing);
    client.onError = (err) => setError(err);
    client.onAuthenticated = (sid) => setSessionId(sid);
    client.onAuthFailed = (msg) => setError(msg);
    client.onAuthRequired = () => setError(null);
    client.onRoleChange = (newRole) => setRoleState(newRole);
    client.onToolCall = (toolCall) => {
      console.log('[use-websocket] onToolCall 被调用:', toolCall);
      setToolCalls((prev) => {
        const newCalls = [...prev, toolCall];
        console.log('[use-websocket] 更新后的 toolCalls:', newCalls);
        return newCalls;
      });
    };
    client.onToolCallUpdate = (toolCall) => {
      console.log('[use-websocket] onToolCallUpdate 被调用:', toolCall);
      setToolCalls((prev) => {
        const newCalls = prev.map((tc) => (tc.id === toolCall.id ? toolCall : tc));
        console.log('[use-websocket] 更新后的 toolCalls:', newCalls);
        return newCalls;
      });
    };
    client.onShellExec = (shellExec) => {
      setShellExecs((prev) => [...prev, shellExec]);
    };
    client.onShellExecUpdate = (shellExec) => {
      setShellExecs((prev) =>
        prev.map((se) => (se.id === shellExec.id ? shellExec : se))
      );
    };

    // 初始化状态
    setConnectionStatus(client.connectionStatus);
    setAuthStatus(client.authStatus);
    setMessages([...client.messages]);
    setIsTyping(client.isTyping);
    setSessionId(client.sessionId);
    setRoleState(client.role);
    setToolCalls([...client.toolCalls]);
    setShellExecs([...client.shellExecs]);

    // 确保缓存的 role 触发回调（解决刷新后 role 不显示的问题）
    if (client.role) {
      setTimeout(() => {
        client.onRoleChange?.(client.role);
      }, 0);
    }

    return () => {
      // 清理事件处理器
      client.onStatusChange = undefined;
      client.onAuthChange = undefined;
      client.onMessage = undefined;
      client.onMessageUpdate = undefined;
      client.onMessagesReset = undefined;
      client.onTypingChange = undefined;
      client.onError = undefined;
      client.onAuthenticated = undefined;
      client.onAuthFailed = undefined;
      client.onAuthRequired = undefined;
      client.onRoleChange = undefined;
      client.onToolCall = undefined;
      client.onToolCallUpdate = undefined;
      client.onShellExec = undefined;
      client.onShellExecUpdate = undefined;
    };
  }, [getClient]);

  const connect = useCallback((token?: string) => {
    const client = getClient();
    setError(null);
    client.connect(token);
  }, [getClient]);

  const disconnect = useCallback(() => {
    const client = getClient();
    client.disconnect();
    setMessages([]);
    setSessionId(null);
    setError(null);
  }, [getClient]);

  const authenticate = useCallback((token: string) => {
    const client = getClient();
    setError(null);
    client.authenticate(token);
  }, [getClient]);

  const sendMessage = useCallback((content: string) => {
    const client = getClient();
    setError(null);
    client.sendMessage(content);
  }, [getClient]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const resetMessages = useCallback(() => {
    const client = getClient();
    client.resetMessages();
  }, [getClient]);

  const clearSessionCache = useCallback(() => {
    const client = getClient();
    client.clearSessionCache?.();
  }, [getClient]);

  const hasCachedToken = useCallback(() => {
    const client = getClient();
    return client.hasCachedToken?.() ?? false;
  }, [getClient]);

  const setRole = useCallback((roleInfo: RoleInfo) => {
    const client = getClient();
    client.setRole?.(roleInfo);
  }, [getClient]);

  const resetActivityLogs = useCallback(() => {
    const client = getClient();
    client.resetActivityLogs?.();
    setToolCalls([]);
    setShellExecs([]);
  }, [getClient]);

  return {
    connectionStatus,
    authStatus,
    messages,
    isTyping,
    error,
    sessionId,
    role,
    toolCalls,
    shellExecs,
    connect,
    disconnect,
    authenticate,
    sendMessage,
    clearError,
    resetMessages,
    clearSessionCache,
    hasCachedToken,
    setRole,
    resetActivityLogs,
    isConnected: connectionStatus === 'connected',
    isAuthenticated: authStatus === 'authenticated'
  };
}
