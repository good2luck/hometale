import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { loadConfig } from '../../lib/config.js';
import { runFamilyAgent } from '../../agents/family-agent.js';
import type { ChatMessage } from '../../agents/types.js';
import { insertMessage, getRecentMessagesBySessionId } from '../../db/message-db.js';
import { createSession } from '../../session/session-store.js';
import crypto from 'node:crypto';

const router = express.Router();

router.post('/messages', authMiddleware, async (req: AuthRequest, res) => {
  if (!req.hometaleSession) {
    res.status(401).json({ error: 'No session' });
    return;
  }

  const { message } = req.body;
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  const config = await loadConfig();

  if (!config.model.apiKey) {
    res.status(500).json({
      error: 'API key not configured. Please set it in ~/.hometale/config.json'
    });
    return;
  }

  try {
    // Ensure we have a session
    let sessionId = req.hometaleSession.sessionId;
    if (!sessionId) {
      const newSession = await createSession(req.hometaleSession.roleId);
      sessionId = newSession.id;
    }

    const timestamp = new Date().toISOString();

    // Save user message to DB
    insertMessage({
      sessionId,
      roleId: req.hometaleSession.roleId,
      role: 'user',
      content: message,
      timestamp
    });

    // 从数据库读取当前 session 的历史消息作为上下文
    let history: ChatMessage[] = [];
    if (sessionId) {
      const recentMessages = getRecentMessagesBySessionId(sessionId, 20);
      // 排除最后一条（当前刚发送的用户消息，family-agent 内部会再次添加）
      const contextMessages = recentMessages.slice(0, -1);
      history = contextMessages.map(m => ({
        role: m.role,
        content: m.content
      }));
    }

    const result = await runFamilyAgent(
      config.model,
      req.hometaleSession.roleId,
      message,
      history,
      sessionId
    );

    // Save assistant response to DB
    if (result.response) {
      insertMessage({
        sessionId,
        roleId: req.hometaleSession.roleId,
        role: 'assistant',
        content: result.response,
        timestamp: new Date().toISOString()
      });
    }

    const conversationId = crypto.randomBytes(8).toString('hex');

    res.json({
      message: result.response,
      conversationId
    });
  } catch (error: any) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message || 'Failed to process message' });
  }
});

export default router;
