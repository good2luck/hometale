export interface MemoryEntry {
  content: string;
  isPrivate: boolean;
  roleId?: string;
  createdAt: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}
