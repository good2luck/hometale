import { useEffect, useState, useMemo, useRef } from 'react';
import { Send, Home, User, Bot, Loader2, Key, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useWebSocket } from '../hooks/use-websocket';
import { ToolCall } from '../components/tool-call';
import type { RoleInfo, ToolCallMessage, ChatMessage } from '../lib/websocket';

function getTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('token');
}

// 简单的角色信息检测
function guessRoleInfo(message: string): { id: string; name: string; avatar: string } | null {
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

  // 先检查是否匹配预设角色
  const lowerMsg = message.toLowerCase();
  for (const [key, info] of Object.entries(roleMap)) {
    if (lowerMsg.includes(key)) {
      return info;
    }
  }

  //  fallback 到通用匹配
  const patterns = [
    /^我是(.+)$/,
    /^我叫(.+)$/,
    /^我的名字是(.+)$/,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const name = match[1].trim();
      if (name) {
        return {
          id: name.toLowerCase().replace(/\s+/g, '_'),
          name,
          avatar: name.charAt(0)
        };
      }
    }
  }
  return null;
}

export function ChatPage() {
  const {
    connectionStatus,
    authStatus,
    messages,
    isTyping,
    error,
    connect,
    disconnect,
    authenticate,
    sendMessage,
    clearError,
    clearSessionCache,
    hasCachedToken,
    setRole,
    role,
    toolCalls,
    isAuthenticated
  } = useWebSocket();

  const [input, setInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasConnectedRef = useRef(false);

  // 自动连接 - URL token 优先，其次缓存
  useEffect(() => {
    if (hasConnectedRef.current) return;
    hasConnectedRef.current = true;

    const tokenFromUrl = getTokenFromUrl();
    console.log('[ChatPage] URL token:', tokenFromUrl ? '存在' : '不存在');
    console.log('[ChatPage] 缓存 token:', hasCachedToken() ? '存在' : '不存在');

    // 优先使用 URL token
    if (tokenFromUrl) {
      connect(tokenFromUrl);
    } else if (hasCachedToken()) {
      // 其次使用缓存 token
      connect();
    } else {
      // 没有 token，也先建立连接（等待用户输入）
      connect();
    }
  }, [connect, hasCachedToken]);

  // 处理初始化状态
  useEffect(() => {
    console.log('[ChatPage] 状态更新:', { connectionStatus, authStatus, isInitializing });
    // 只要连接建立了就结束初始化，不管认证状态
    if (connectionStatus === 'connected') {
      console.log('[ChatPage] 连接已建立，结束初始化');
      setIsInitializing(false);
    }
    // 如果连接失败，也结束初始化
    if (connectionStatus === 'disconnected') {
      console.log('[ChatPage] 连接断开，结束初始化');
      setIsInitializing(false);
    }
    // 超时保护：5秒后强制结束初始化状态
    const timeout = setTimeout(() => {
      console.log('[ChatPage] 超时，强制结束初始化');
      setIsInitializing(false);
    }, 5000);
    return () => clearTimeout(timeout);
  }, [connectionStatus, authStatus]);

  // 自动滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolCalls]);

  // 合并消息和工具调用，按时间排序
  const allItems = useMemo(() => {
    const items: Array<
      | { type: 'message'; data: ChatMessage; id: string }
      | { type: 'tool_call'; data: ToolCallMessage; id: string }
    > = [];

    messages.forEach((msg, idx) => {
      items.push({
        type: 'message',
        data: msg,
        id: `msg-${idx}-${msg.timestamp}`
      });
    });

    toolCalls.forEach((tc) => {
      items.push({
        type: 'tool_call',
        data: tc,
        id: tc.id
      });
    });

    // 按时间排序
    items.sort((a, b) => {
      const timeA = a.type === 'message'
        ? new Date(a.data.timestamp).getTime()
        : new Date(a.data.timestamp).getTime();
      const timeB = b.type === 'message'
        ? new Date(b.data.timestamp).getTime()
        : new Date(b.data.timestamp).getTime();
      return timeA - timeB;
    });

    return items;
  }, [messages, toolCalls]);

  const handleAuthenticate = (e: React.FormEvent) => {
    e.preventDefault();
    if (tokenInput.trim()) {
      authenticate(tokenInput.trim());
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isTyping) {
      const content = input.trim();

      // 处理 /new 命令
      if (content === '/new') {
        console.log('[ChatPage] 收到 /new 命令');
        // 清除 session 缓存，断开连接，重新连接
        clearSessionCache();
        disconnect();
        // 延迟重连，确保断开完成
        setTimeout(() => {
          // 重新连接，会自动使用缓存的 token
          console.log('[ChatPage] 重新连接...');
          connect();
        }, 300);
        setInput('');
        return;
      }

      // 检测是否是角色信息，如果是则保存
      const guessedRole = guessRoleInfo(content);
      if (guessedRole) {
        console.log('[ChatPage] 检测到角色信息:', guessedRole);
        const roleInfo: RoleInfo = {
          id: guessedRole.id,
          name: guessedRole.name,
          avatar: guessedRole.avatar
        };
        setRole(roleInfo);
      }

      sendMessage(content);
      setInput('');
    }
  };

  // 初始化中 - 加载界面
  if (isInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--color-background)' }}>
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary)' }}>
              <Loader2 className="w-10 h-10 text-white animate-spin" />
            </div>
          </div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text)' }}>
            正在连接...
          </h1>
          <p style={{ color: 'var(--color-text-muted)' }}>
            请稍候
          </p>
        </div>
      </div>
    );
  }

  // 未认证状态 - Token输入界面
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--color-background)' }}>
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary)' }}>
                <Home className="w-10 h-10 text-white" />
              </div>
            </div>
            <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--color-text)' }}>
              Welcome to HomeTale
            </h1>
            <p style={{ color: 'var(--color-text-muted)' }}>
              家的故事
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <Key className="w-5 h-5" style={{ color: 'var(--color-primary)' }} />
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                请输入访问令牌
              </h2>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-lg flex items-center gap-2" style={{ backgroundColor: '#FEF2F2' }}>
                <AlertCircle className="w-5 h-5 text-red-500" />
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            <form onSubmit={handleAuthenticate} className="space-y-4">
              <div>
                <input
                  type="text"
                  value={tokenInput}
                  onChange={(e) => {
                    setTokenInput(e.target.value);
                    if (error) clearError();
                  }}
                  placeholder="输入你的token..."
                  className="w-full px-4 py-3 rounded-xl border-2 focus:outline-none transition-colors"
                  style={{
                    borderColor: error ? '#FCA5A5' : '#E2E8F0',
                    color: 'var(--color-text)'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'var(--color-primary)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = error ? '#FCA5A5' : '#E2E8F0';
                  }}
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={!tokenInput.trim() || authStatus === 'authenticating'}
                className="w-full py-3 px-4 rounded-xl font-semibold text-white transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                style={{ backgroundColor: 'var(--color-primary)' }}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.backgroundColor = 'var(--color-primary-dark)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.backgroundColor = 'var(--color-primary)';
                  }
                }}
              >
                {authStatus === 'authenticating' ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    验证中...
                  </>
                ) : (
                  '进入聊天'
                )}
              </button>
            </form>

            <div className="mt-4 flex items-center gap-2">
              {connectionStatus === 'connected' ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-sm text-green-600">已连接</span>
                </>
              ) : (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--color-text-muted)' }} />
                  <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    {connectionStatus === 'connecting' ? '连接中...' : '断开连接'}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 已认证状态 - 聊天界面
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--color-background)' }}>
      {/* Header */}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-center shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary)' }}>
            <Home className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-semibold" style={{ color: 'var(--color-text)' }}>
              HomeTale
              {role && <span className="ml-2 text-sm font-normal" style={{ color: 'var(--color-text-muted)' }}>
                ({role.name})
              </span>}
            </h1>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>在线</span>
            </div>
          </div>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {allItems.length === 0 && (
            <div className="text-center py-12">
              <div className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: 'rgba(13, 148, 136, 0.1)' }}>
                <Bot className="w-12 h-12" style={{ color: 'var(--color-primary)' }} />
              </div>
              <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
                你好！
              </h2>
              <p className="max-w-sm mx-auto" style={{ color: 'var(--color-text-muted)' }}>
                请告诉我你的身份，比如"我是爸爸"
              </p>
            </div>
          )}

          {allItems.map((item) => {
            if (item.type === 'message') {
              const msg = item.data;
              return (
                <div
                  key={item.id}
                  className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`flex items-start gap-2 max-w-[80%] ${
                      msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0`}
                      style={{
                        backgroundColor: msg.role === 'user' ? 'var(--color-secondary)' : 'var(--color-primary)'
                      }}
                    >
                      {msg.role === 'user' ? (
                        <User className="w-5 h-5 text-white" />
                      ) : (
                        <Bot className="w-5 h-5 text-white" />
                      )}
                    </div>
                    <div
                      className={`px-4 py-3 rounded-2xl ${
                        msg.role === 'user'
                          ? 'text-white rounded-tr-sm'
                          : 'bg-white rounded-tl-sm shadow-sm border'
                      }`}
                      style={{
                        backgroundColor: msg.role === 'user' ? 'var(--color-primary)' : undefined,
                        borderColor: msg.role === 'user' ? undefined : '#F0F0F0',
                        color: msg.role === 'user' ? 'white' : 'var(--color-text)'
                      }}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                </div>
              );
            } else {
              // 工具调用
              return (
                <div key={item.id} className="flex justify-start">
                  <div className="max-w-[80%] w-full">
                    <ToolCall toolCall={item.data} />
                  </div>
                </div>
              );
            }
          })}

          {isTyping && (
            <div className="flex gap-3 justify-start">
              <div className="flex items-start gap-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary)' }}>
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div className="px-4 py-3 bg-white rounded-2xl rounded-tl-sm shadow-sm border" style={{ borderColor: '#F0F0F0' }}>
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-text-muted)', animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-text-muted)', animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-text-muted)', animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mx-auto max-w-[80%]">
              <p className="text-red-600">{error}</p>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input */}
      <footer className="bg-white border-t px-4 py-3" style={{ borderColor: '#F0F0F0' }}>
        <form onSubmit={handleSendMessage} className="max-w-2xl mx-auto">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (error) clearError();
              }}
              placeholder="输入消息..."
              disabled={isTyping}
              className="flex-1 px-4 py-3 rounded-full border-2 focus:outline-none transition-colors disabled:opacity-50 log-scrollbar"
              style={{
                borderColor: '#E2E8F0',
                color: 'var(--color-text)'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'var(--color-primary)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#E2E8F0';
              }}
            />
            <button
              type="submit"
              disabled={!input.trim() || isTyping}
              className="px-4 py-3 rounded-full text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-primary)' }}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.backgroundColor = 'var(--color-primary-dark)';
                }
              }}
              onMouseLeave={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.backgroundColor = 'var(--color-primary)';
                }
              }}
            >
              {isTyping ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </form>
      </footer>
    </div>
  );
}
