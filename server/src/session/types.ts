export interface Session {
  id: string;
  roleId: string;
  createdAt: string;
  expiresAt: string;
  metadata: {
    clientType: 'web';
  };
}
