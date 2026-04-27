import http from 'node:http';
import https from 'node:https';
import WebSocket, { WebSocketServer } from 'ws';
import type { Config } from '../lib/config.js';
import { WebSocketSession } from '../agent-core/websocket-session.js';
import { MessageHandler } from '../agent-core/message-handler.js';
import { getSession } from '../session/session-store.js';
import { getRole } from '../roles/role-manager.js';
import { initMessageDb, getRecentMessagesBySessionId } from '../db/message-db.js';
import { cleanupDisclosureManager } from '../skills/discovery.js';

export class HomeTaleWebSocketServer {
  private wss: WebSocketServer | null = null;
  private sessions: Map<string, WebSocketSession> = new Map();
  private config: Config;
  private messageHandler: MessageHandler;

  constructor(config: Config) {
    this.config = config;
    this.messageHandler = new MessageHandler(config.model);
    initMessageDb();
  }

  attachToServer(server: http.Server | https.Server) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '', `http://${request.headers.host}`);

      // 只处理 /ws 路径
      if (url.pathname !== '/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss!.handleUpgrade(request, socket, head, (ws) => {
        this.wss!.emit('connection', ws, request);
      });
    });

    this.wss.on('connection', (ws, request) => {
      this.handleConnection(ws, request);
    });

    console.log('WebSocket server attached to HTTP server');
  }

  private handleConnection(ws: WebSocket, request: http.IncomingMessage) {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const tokenFromUrl = url.searchParams.get('token');
    const sessionIdFromUrl = url.searchParams.get('sessionId');
    const userAgent = request.headers['user-agent'];

    if (!this.config.token) {
      ws.close(1011, 'Server configuration error');
      return;
    }

    // 创建会话
    const session = new WebSocketSession(ws, this.config.token, userAgent);
    this.sessions.set(session.id, session);

    // Store sessionId if provided
    if (sessionIdFromUrl) {
      session.sessionId = sessionIdFromUrl;
    }

    console.log(`WebSocket connected: ${session.id}`);

    // 清理会话
    ws.on('close', () => {
      // 清理 ProgressiveDisclosure 管理器
      if (session.sessionId) {
        cleanupDisclosureManager(session.sessionId);
      }
      this.sessions.delete(session.id);
      console.log(`WebSocket disconnected: ${session.id}`);
    });

    ws.on('error', (err) => {
      console.error(`WebSocket error (${session.id}):`, err);
      this.sessions.delete(session.id);
    });

    // 处理消息
    ws.on('message', (data) => {
      const message = data.toString();
      this.messageHandler.handleMessage(session, message);
    });

    // 等待一小段时间确保连接准备好，然后发送认证相关消息
    setTimeout(async () => {
      // 如果URL中带有token，尝试自动认证
      if (tokenFromUrl) {
        if (session.validateToken(tokenFromUrl)) {
          session.authenticated = true;

          // If sessionId is provided, try to load session and role
          if (sessionIdFromUrl) {
            try {
              console.log('[WebSocket] 尝试加载 session:', sessionIdFromUrl);
              const storedSession = await getSession(sessionIdFromUrl);
              if (storedSession) {
                console.log('[WebSocket] 找到 session, roleId:', storedSession.roleId);
                const role = await getRole(storedSession.roleId);
                if (role) {
                  console.log('[WebSocket] 找到角色:', role);
                  session.setRole(role);
                  session.sessionId = sessionIdFromUrl;  // 重要：设置会话 sessionId
                  session.sendAuthenticated();

                  // Send recent history messages
                  console.log('[WebSocket] 查询历史消息...');
                  const historyMessages = getRecentMessagesBySessionId(sessionIdFromUrl, 10);
                  console.log('[WebSocket] 历史消息数量:', historyMessages.length);
                  if (historyMessages.length > 0) {
                    session.sendHistoryMessages(
                      historyMessages.map(m => ({
                        role: m.role,
                        content: m.content,
                        timestamp: m.timestamp
                      }))
                    );
                  }
                  return;  // Skip role prompt since we have a role
                }
              }
            } catch (err) {
              console.error('Error loading session:', err);
            }
          }

          // Fall through to default flow if session loading failed
          session.sendAuthenticated();
          session.sendRolePrompt();
        } else {
          session.sendAuthFailed('URL中的token无效');
          session.sendAuthRequired();
        }
      } else {
        session.sendAuthRequired();
      }
    }, 100);
  }

  getSessionCount(): number {
    return this.sessions.size;
  }
}
