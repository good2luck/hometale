import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getLongTermMemory, updateLongTermMemory } from '../../memory/memory-manager.js';

const router = express.Router();

router.get('/long-term', authMiddleware, async (req: AuthRequest, res) => {
  if (!req.hometaleSession) {
    res.status(401).json({ error: 'No session' });
    return;
  }

  const { includePrivate } = req.query;
  const memory = await getLongTermMemory(
    req.hometaleSession.roleId,
    includePrivate !== 'true'
  );

  res.json({ memory });
});

router.put('/long-term', authMiddleware, async (req: AuthRequest, res) => {
  if (!req.hometaleSession) {
    res.status(401).json({ error: 'No session' });
    return;
  }

  const { content } = req.body;
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  await updateLongTermMemory(req.hometaleSession.roleId, content);
  res.json({ success: true });
});

export default router;
