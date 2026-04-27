const API_BASE = '/api';

export interface Role {
  id: string;
  name: string;
  avatar: string;
  robotIdentity: string;
  createdAt: string;
}

export interface Session {
  id: string;
  roleId: string;
  createdAt: string;
  expiresAt: string;
}

let sessionId: string | null = localStorage.getItem('hometale_session_id');

export function setSessionId(id: string | null) {
  sessionId = id;
  if (id) {
    localStorage.setItem('hometale_session_id', id);
  } else {
    localStorage.removeItem('hometale_session_id');
  }
}

export function getSessionId(): string | null {
  return sessionId;
}

async function fetchAPI<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  if (sessionId) {
    headers.set('x-session-id', sessionId);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export async function getRoles(): Promise<Role[]> {
  const data = await fetchAPI<{ roles: Role[] }>('/auth/roles');
  return data.roles;
}

export async function login(roleId: string): Promise<{ session: Session; role: Role }> {
  const data = await fetchAPI<{ session: Session; role: Role }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ roleId })
  });
  setSessionId(data.session.id);
  return data;
}

export async function createRole(role: Omit<Role, 'createdAt'>): Promise<{ role: Role }> {
  return fetchAPI<{ role: Role }>('/auth/roles', {
    method: 'POST',
    body: JSON.stringify(role)
  });
}

export async function getCurrentSession(): Promise<{ session: Session; role: Role } | null> {
  if (!sessionId) return null;
  try {
    return await fetchAPI<{ session: Session; role: Role }>('/auth/session');
  } catch {
    setSessionId(null);
    return null;
  }
}

export async function sendMessage(message: string): Promise<{ message: string; conversationId: string }> {
  return fetchAPI<{ message: string; conversationId: string }>('/chat/messages', {
    method: 'POST',
    body: JSON.stringify({ message })
  });
}

export async function getLongTermMemory(): Promise<{ memory: string }> {
  return fetchAPI<{ memory: string }>('/memory/long-term');
}
