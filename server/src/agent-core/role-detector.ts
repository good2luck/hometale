import { getRole, createRole, guessRoleInfo } from '../roles/role-manager.js';
import type { Role } from '../roles/types.js';
import type { WebSocketSession } from './websocket-session.js';

export class RoleDetector {
  async detectAndBindRole(session: WebSocketSession, message: string): Promise<Role | null> {
    const guessed = guessRoleInfo(message);

    if (!guessed) {
      return null;
    }

    // 查找已有角色
    let role = await getRole(guessed.id);

    // 如果不存在，创建新角色
    if (!role) {
      role = {
        id: guessed.id,
        name: guessed.name,
        avatar: guessed.avatar,
        robotIdentity: `你是${guessed.name}的贴心助手，帮助处理日常事务，关心家人。`,
        createdAt: new Date().toISOString().split('T')[0]
      };
      await createRole(role);
    }

    // 绑定到会话
    session.setRole(role);
    return role;
  }
}
