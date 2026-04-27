import crypto from 'node:crypto';
import path from 'node:path';
import { getSessionsPath, ensureDir } from '../lib/hometale-path.js';
import { readJsonFile, writeJsonFile, fileExists } from '../lib/fs-utils.js';
import type { Session } from './types.js';

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function createSession(roleId: string): Promise<Session> {
  ensureDir(getSessionsPath());

  const now = new Date();
  const session: Session = {
    id: generateSessionId(),
    roleId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_DURATION_MS).toISOString(),
    metadata: {
      clientType: 'web'
    }
  };

  const sessionPath = path.join(getSessionsPath(), `${session.id}.json`);
  await writeJsonFile(sessionPath, session);
  return session;
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const sessionPath = path.join(getSessionsPath(), `${sessionId}.json`);
  if (!fileExists(sessionPath)) {
    return null;
  }
  const session = await readJsonFile<Session>(sessionPath);
  if (!session) {
    return null;
  }
  if (new Date(session.expiresAt) < new Date()) {
    return null;
  }
  return session;
}

export async function validateSession(sessionId: string): Promise<boolean> {
  const session = await getSession(sessionId);
  return session !== null;
}
