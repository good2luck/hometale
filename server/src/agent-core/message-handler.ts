import type { ModelConfig } from '../lib/config.js';
import { runFamilyAgentStream } from '../agents/family-agent.js';
import { getRole, createRole, guessRoleInfo } from '../roles/role-manager.js';
import type { WebSocketSession, WebSocketMessage } from './websocket-session.js';
import { RoleDetector } from './role-detector.js';
import { insertMessage, getContextMessages } from '../db/message-db.js';
import { createSession } from '../session/session-store.js';
import type { ChatMessage } from '../agents/types.js';

export class MessageHandler {
  private roleDetector: RoleDetector;
  private modelConfig: ModelConfig;

  constructor(modelConfig: ModelConfig) {
    this.roleDetector = new RoleDetector();
    this.modelConfig = modelConfig;
  }

  private saveMessage(session: WebSocketSession, role: 'user' | 'assistant', content: string) {
    if (!session.role || !session.sessionId) {
      return;
    }
    try {
      insertMessage({
        sessionId: session.sessionId,
        roleId: session.role.id,
        role,
        content,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('Failed to save message:', err);
    }
  }

  async handleMessage(session: WebSocketSession, rawMessage: string) {
    try {
      const message: WebSocketMessage = JSON.parse(rawMessage);

      if (!session.authenticated) {
        await this.handleUnauthenticatedMessage(session, message);
        return;
      }

      await this.handleAuthenticatedMessage(session, message);
    } catch (err) {
      console.error('Message handling error:', err);
      session.sendError('消息处理失败');
    }
  }

  private async handleUnauthenticatedMessage(session: WebSocketSession, message: WebSocketMessage) {
    if (message.type === 'authenticate') {
      const token = message.data?.token;
      if (token && session.validateToken(token)) {
        session.authenticated = true;
        session.sendAuthenticated();
        session.sendRolePrompt();
      } else {
        session.sendAuthFailed();
      }
    } else {
      session.sendAuthRequired();
    }
  }

  private async handleAuthenticatedMessage(session: WebSocketSession, message: WebSocketMessage) {
    if (message.type === 'set_role') {
      const roleId = message.data?.roleId;
      if (!roleId) {
        session.sendError('roleId 不能为空');
        return;
      }

      let role = await getRole(roleId);
      if (!role) {
        const guessed = guessRoleInfo(roleId);
        if (guessed) {
          role = {
            id: guessed.id,
            name: guessed.name,
            avatar: guessed.avatar,
            robotIdentity: `你是${guessed.name}的贴心助手，帮助处理日常事务，关心家人。`,
            createdAt: new Date().toISOString().split('T')[0]
          };
          await createRole(role);
        } else {
          session.sendError('无法识别的角色');
          return;
        }
      }

      session.setRole(role);
      session.sendMessage(`你好，${role.name}！很高兴为你服务。`);

      if (!session.sessionId) {
        try {
          const newSession = await createSession(role.id);
          session.sessionId = newSession.id;
          session.send({
            type: 'session_created',
            data: { sessionId: newSession.id }
          });
        } catch (err) {
          console.error('Failed to create session:', err);
        }
      }
      return;
    }

    if (message.type === 'message') {
      const content = message.data?.content;
      if (!content) {
        session.sendError('消息内容不能为空');
        return;
      }

      if (session.role && session.sessionId) {
        this.saveMessage(session, 'user', content);
      }

      if (!session.role) {
        const role = await this.roleDetector.detectAndBindRole(session, content);
        if (!role) {
          session.sendRolePrompt();
          return;
        }
        session.sendMessage(`你好，${role.name}！很高兴为你服务。`);

        if (!session.sessionId) {
          try {
            const newSession = await createSession(role.id);
            session.sessionId = newSession.id;
            session.send({
              type: 'session_created',
              data: { sessionId: newSession.id }
            });
          } catch (err) {
            console.error('Failed to create session:', err);
          }
        }
        return;
      }

      await this.handleChat(session, content);
    }
  }

  private async handleChat(session: WebSocketSession, userMessage: string) {
    if (!session.role) return;

    try {
      session.sendTyping(true);

      console.log('[handleChat] Calling family agent with:', userMessage);

      // 从数据库读取当前 session 的历史消息作为上下文（智能处理压缩标记）
      let history: ChatMessage[] = [];
      if (session.sessionId) {
        const contextMessages = getContextMessages(session.sessionId, {
          baseLimit: 20,
          expandCompressed: false
        });
        // family-agent 内部会再次添加用户消息，所以不需要在这里添加
        history = contextMessages.map(m => ({
          role: m.role,
          content: m.content
        }));
      }

      const stream = runFamilyAgentStream(
        this.modelConfig,
        session.role.id,
        userMessage,
        history,
        session.sessionId ?? undefined
      );

      // 流式输出响应
      let isFirst = true;
      let fullResponse = '';

      // 收集工具调用信息用于保存完整对话记录
      interface ToolCallRecord {
        id: string;
        name: string;
        args: any;
        success: boolean;
        result: string;
        timestamp: string;
      }
      const toolCalls: ToolCallRecord[] = [];
      let currentToolCall: { id: string; name: string; args: any; startTime: string } | null = null;

      while (true) {
        const result = await stream.next();
        if (result.done) {
          break;
        }

        const event = result.value;
        if (event.type === 'text') {
          session.sendMessageChunk(event.content, isFirst, false);
          fullResponse += event.content;
          isFirst = false;
        } else if (event.type === 'tool_call_started') {
          // 如果有正在进行的流式消息，先结束它
          if (!isFirst) {
            session.sendMessageChunk('', false, true);
          }

          const toolStartTime = new Date().toISOString();
          currentToolCall = {
            id: event.toolCallId,
            name: event.name,
            args: event.args,
            startTime: toolStartTime
          };
          session.sendToolCallStarted(
            event.toolCallId,
            event.name,
            event.args
          );
        } else if (event.type === 'tool_call_completed') {
          // 确保 result 可以被安全序列化
          const safeResult = typeof event.result === 'string'
            ? event.result
            : JSON.stringify(event.result, null, 2);

          if (currentToolCall) {
            toolCalls.push({
              id: currentToolCall.id,
              name: currentToolCall.name,
              args: currentToolCall.args,
              success: event.success,
              result: safeResult,
              timestamp: new Date().toISOString()
            });
          }
          session.sendToolCallCompleted(
            event.toolCallId,
            event.name,
            currentToolCall ? currentToolCall.args : {},
            { success: event.success, result: safeResult },
            currentToolCall ? currentToolCall.startTime : new Date().toISOString()
          );
          currentToolCall = null;

          // 工具调用完成后，重置 isFirst 以开始新的流式消息
          isFirst = true;
        }
      }

      // 发送结束标记
      session.sendMessageChunk('', false, true);

      if (session.role && session.sessionId) {
        if (fullResponse) {
          this.saveMessage(session, 'assistant', fullResponse);
        }
      }

    } catch (err) {
      console.error('Chat error:', err);
      session.sendError('对话处理失败，请稍后重试');
    } finally {
      session.sendTyping(false);
    }
  }
}
