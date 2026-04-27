import type { Request, Response, NextFunction } from 'express';
import { getSession } from '../../session/session-store.js';

export interface AuthRequest extends Request {
  hometaleSession?: {
    id: string;
    roleId: string;
    sessionId?: string;
  };
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const sessionId = req.headers['x-session-id'] as string;

  if (!sessionId) {
    res.status(401).json({ error: 'No session ID provided' });
    return;
  }

  const session = await getSession(sessionId);
  if (!session) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  req.hometaleSession = {
    id: session.id,
    roleId: session.roleId
  };

  next();
}
