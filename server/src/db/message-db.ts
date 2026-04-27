import Database from 'better-sqlite3';
import path from 'node:path';
import { getMessagesDbPath, ensureDir } from '../lib/hometale-path.js';

export interface Message {
  id?: number;
  sessionId: string;
  roleId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  createdAt?: string;
  isCompactionMarker?: boolean;
  compactionMeta?: {
    summary: string;
    originalCount: number;
    compactedAt: string;
  };
}

let db: Database.Database | null = null;

export function initMessageDb(): void {
  const dbPath = getMessagesDbPath();
  ensureDir(path.dirname(dbPath));

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Create messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_compaction_marker INTEGER DEFAULT 0,
      compaction_meta TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_role_id ON messages(role_id);
    CREATE INDEX IF NOT EXISTS idx_compaction_marker ON messages(is_compaction_marker);
  `);
}

export function getMessageDb(): Database.Database {
  if (!db) {
    initMessageDb();
  }
  return db!;
}

export function insertMessage(message: Message): number {
  const db = getMessageDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO messages (session_id, role_id, role, content, timestamp, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    message.sessionId,
    message.roleId,
    message.role,
    message.content,
    message.timestamp,
    message.createdAt || now
  );
  return Number(result.lastInsertRowid);
}

export function getMessagesBySessionId(sessionId: string, limit: number = 10): Message[] {
  const db = getMessageDb();
  const stmt = db.prepare(`
    SELECT id, session_id as sessionId, role_id as roleId, role, content, timestamp, created_at as createdAt
    FROM messages
    WHERE session_id = ?
    ORDER BY id ASC
    LIMIT ?
  `);
  const rows = stmt.all(sessionId, limit);
  return rows as Message[];
}

export function getRecentMessagesBySessionId(sessionId: string, limit: number = 10): Message[] {
  const db = getMessageDb();
  // First get the last N messages in descending order, then reverse to get chronological order
  const stmt = db.prepare(`
    SELECT id, session_id as sessionId, role_id as roleId, role, content, timestamp, created_at as createdAt
    FROM messages
    WHERE session_id = ?
    ORDER BY id DESC
    LIMIT ?
  `);
  const rows = stmt.all(sessionId, limit) as Message[];
  return rows.reverse();
}

export function getMessagesByRoleIdAndDate(roleId: string, date: string): Message[] {
  const db = getMessageDb();
  // date is in YYYY-MM-DD format
  const stmt = db.prepare(`
    SELECT id, session_id as sessionId, role_id as roleId, role, content, timestamp, created_at as createdAt
    FROM messages
    WHERE role_id = ? AND timestamp LIKE ?
    ORDER BY id ASC
  `);
  const rows = stmt.all(roleId, `${date}%`) as Message[];
  return rows;
}

/**
 * 插入压缩标记消息
 *
 * @param sessionId 会话 ID
 * @param roleId 角色 ID
 * @param summary 对话总结
 * @param originalCount 压缩前消息数量
 * @returns 插入消息的 ID
 */
export function insertCompactionMarker(
  sessionId: string,
  roleId: string,
  summary: string,
  originalCount: number
): number {
  const db = getMessageDb();
  const now = new Date().toISOString();
  const compactionMeta = JSON.stringify({
    summary,
    originalCount,
    compactedAt: now
  });

  const stmt = db.prepare(`
    INSERT INTO messages (session_id, role_id, role, content, timestamp, created_at, is_compaction_marker, compaction_meta)
    VALUES (?, ?, 'assistant', ?, ?, ?, 1, ?)
  `);
  const result = stmt.run(
    sessionId,
    roleId,
    `[COMPRESSED] ${summary}`,
    now,
    now,
    compactionMeta
  );
  return Number(result.lastInsertRowid);
}

/**
 * 智能加载历史消息（支持压缩标记）
 *
 * @param sessionId 会话 ID
 * @param options 加载选项
 * @returns 消息列表
 */
export interface ContextMessagesOptions {
  baseLimit?: number;
  expandCompressed?: boolean;
  maxTokens?: number;
}

export function getContextMessages(
  sessionId: string,
  options: ContextMessagesOptions = {}
): Message[] {
  const { baseLimit = 20, expandCompressed = false, maxTokens } = options;

  const db = getMessageDb();

  // 1. 读取最近的消息
  let messages: Message[];
  const stmt = db.prepare(`
    SELECT id, session_id as sessionId, role_id as roleId, role, content, timestamp, created_at as createdAt, is_compaction_marker as isCompactionMarker, compaction_meta as compactionMeta
    FROM messages
    WHERE session_id = ?
    ORDER BY id DESC
    LIMIT ?
  `);
  messages = stmt.all(sessionId, baseLimit) as Message[];
  messages = messages.reverse();

  // 2. 检测是否有压缩标记
  const compactionMarkerIndex = messages.findIndex(m => m.isCompactionMarker);

  if (compactionMarkerIndex === -1) {
    // 没有压缩标记，正常返回
    return truncateByTokens(messages, maxTokens);
  }

  const marker = messages[compactionMarkerIndex];

  // 3. 如果需要展开，加载更多历史
  if (expandCompressed && marker.compactionMeta) {
    const meta = marker.compactionMeta;
    const beforeMessages = getMessagesBeforeMarker(sessionId, meta.originalCount);

    // 组合：压缩前的消息 + 压缩标记后的消息
    messages = [
      ...beforeMessages,
      ...messages.slice(compactionMarkerIndex + 1)
    ];
  }

  // 4. Token 控制（可选）
  return truncateByTokens(messages, maxTokens);
}

/**
 * 获取压缩标记前的消息
 *
 * @param sessionId 会话 ID
 * @param count 要获取的消息数量
 * @returns 压缩标记前的消息
 */
function getMessagesBeforeMarker(sessionId: string, count: number): Message[] {
  const db = getMessageDb();

  const stmt = db.prepare(`
    SELECT id, session_id as sessionId, role_id as roleId, role, content, timestamp, created_at as createdAt
    FROM messages
    WHERE session_id = ? AND is_compaction_marker != 1
    ORDER BY id DESC
    LIMIT ?
  `);
  const rows = stmt.all(sessionId, count) as Message[];
  return rows.reverse();
}

/**
 * 按截断消息列表（简单的字符数估算）
 *
 * @param messages 消息列表
 * @param maxTokens 最大 token 数（约等于 maxTokens * 4 字符）
 * @returns 截断后的消息列表
 */
function truncateByTokens(messages: Message[], maxTokens?: number): Message[] {
  if (!maxTokens) {
    return messages;
  }

  const maxChars = maxTokens * 4; // 粗略估算：1 token ≈ 4 字符
  let currentChars = 0;
  const result: Message[] = [];

  for (const msg of messages) {
    const msgChars = JSON.stringify(msg).length;
    if (currentChars + msgChars > maxChars) {
      break;
    }
    result.push(msg);
    currentChars += msgChars;
  }

  return result;
}
