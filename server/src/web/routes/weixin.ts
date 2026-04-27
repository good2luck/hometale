import express from 'express';
import {
  listAccounts,
  getAccount,
  getAccountStatus,
  isAccountRunning,
  startAllEnabledAccounts,
} from '../../weixin/gateway.js';
import { loadRegisteredAccounts } from '../../weixin/accounts.js';
import { loadConfig } from '../../lib/config.js';

const router = express.Router();

router.get('/status', (_req, res) => {
  const accountIds = listAccounts();
  const accounts = accountIds.map((id) => {
    const data = getAccount(id);
    const status = getAccountStatus(id);
    const running = isAccountRunning(id);
    return {
      accountId: id,
      enabled: data?.enabled !== false,
      running,
      lastInboundAt: status.lastInboundAt,
      lastError: status.lastError,
    };
  });
  res.json({ accounts });
});

router.post('/reload', async (_req, res) => {
  try {
    loadRegisteredAccounts();
    const config = await loadConfig();
    await startAllEnabledAccounts(config);
    res.json({ success: true, message: 'WeChat accounts reloaded' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
