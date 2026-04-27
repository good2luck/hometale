import express from 'express';
import { listRoles, getRole, createRole, guessRoleInfo } from '../../roles/role-manager.js';
import { createSession, getSession } from '../../session/session-store.js';
import { ensureHometaleStructure } from '../../lib/hometale-path.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';

const router = express.Router();

router.get('/roles', async (_req, res) => {
  await ensureHometaleStructure();
  const roles = await listRoles();
  res.json({ roles });
});

router.post('/roles', async (req, res) => {
  const { id, name, avatar, robotIdentity } = req.body;

  if (!id || !name || !avatar || !robotIdentity) {
    res.status(400).json({ error: 'id, name, avatar, and robotIdentity are required' });
    return;
  }

  // Check if role already exists
  const existingRole = await getRole(id);
  if (existingRole) {
    res.status(409).json({ error: 'Role already exists' });
    return;
  }

  const role = {
    id,
    name,
    avatar,
    robotIdentity,
    createdAt: new Date().toISOString().split('T')[0]
  };

  await createRole(role);
  res.json({ role });
});

router.post('/login', async (req, res) => {
  const { roleId } = req.body;

  if (!roleId) {
    res.status(400).json({ error: 'roleId is required' });
    return;
  }

  let role = await getRole(roleId);

  // If role not found, try to guess and create it
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
    }
  }

  if (!role) {
    res.status(404).json({ error: 'Role not found' });
    return;
  }

  const session = await createSession(roleId);
  res.json({ session, role });
});

router.get('/session', authMiddleware, async (req: AuthRequest, res) => {
  if (!req.hometaleSession) {
    res.status(401).json({ error: 'No session' });
    return;
  }

  const session = await getSession(req.hometaleSession.id);
  const role = await getRole(req.hometaleSession.roleId);

  res.json({ session, role });
});

export default router;
