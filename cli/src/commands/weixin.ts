/**
 * Weixin CLI commands for HomeTale.
 */
import chalk from 'chalk';
import {
  startWeixinLoginWithQr,
  waitForWeixinLogin,
  saveWeixinAccount,
  loadWeixinAccount,
  deleteWeixinAccount,
  listWeixinAccountIds,
  stopAccount,
  isAccountRunning,
  getAccountStatus,
  initGateway,
  loadRegisteredAccounts,
  DEFAULT_BASE_URL,
} from '@hometale/server';
import { getStatus, getPort } from '../lib/daemon.js';

/** Query the daemon's /api/weixin/status endpoint. */
async function queryWeixinStatusFromDaemon(): Promise<Array<{
  accountId: string;
  enabled: boolean;
  running: boolean;
  lastInboundAt?: number;
  lastError?: string;
}> | null> {
  const daemonStatus = getStatus();
  if (!daemonStatus.running) return null;

  const port = getPort();
  try {
    const resp = await fetch(`http://localhost:${port}/api/weixin/status`);
    if (!resp.ok) return null;
    const data = await resp.json() as { accounts: Array<{
      accountId: string;
      enabled: boolean;
      running: boolean;
      lastInboundAt?: number;
      lastError?: string;
    }> };
    return data.accounts;
  } catch {
    return null;
  }
}

export async function weixinCommand(subcommand: string, args: string[]) {
  // 'status' can query the daemon API — no need to init gateway
  if (subcommand !== 'status') {
    await initGateway();
    loadRegisteredAccounts();
  }

  // Commands that should exit after completion
  const exitAfterCommands = ['login', 'list', 'logout', 'status'];

  try {
    switch (subcommand) {
      case 'login':
        await weixinLogin(args);
        break;
      case 'list':
        await weixinList(args);
        break;
      case 'logout':
        await weixinLogout(args);
        break;
      case 'status':
        await weixinStatus(args);
        break;
      default:
        console.log(chalk.blue('Weixin commands:'));
        console.log('  login          - Login with QR code');
        console.log('  list           - List configured accounts');
        console.log('  logout <id>    - Logout and remove an account');
        console.log('  status         - Show status of all accounts');
        break;
    }
  } finally {
    if (exitAfterCommands.includes(subcommand) || !subcommand) {
      process.exit(0);
    }
  }
}

async function weixinLogin(_args: string[]) {
  console.log(chalk.blue('Starting Weixin QR login...'));

  const startResult = await startWeixinLoginWithQr({
    apiBaseUrl: DEFAULT_BASE_URL,
    verbose: true,
  });

  if (!startResult.qrcodeUrl) {
    console.error(chalk.red('Failed to get QR code:'), startResult.message);
    return;
  }

  console.log(chalk.blue('\n=== QR Code Login ==='));
  console.log(chalk.blue('Scan this QR code with Weixin:\n'));

  try {
    const qrcodeTerminal = await import('qrcode-terminal');
    await new Promise<void>((resolve) => {
      qrcodeTerminal.default.generate(startResult.qrcodeUrl!, { small: true }, (qr: string) => {
        console.log(qr);
        console.log(chalk.blue('\nOr open this URL in a browser:'));
        console.log(startResult.qrcodeUrl!);
        console.log(chalk.blue('\nWaiting for scan and confirmation...'));
        resolve();
      });
    });
  } catch {
    console.log(chalk.blue('Open this URL in a browser to scan:'));
    console.log(startResult.qrcodeUrl!);
    console.log(chalk.blue('\nWaiting for scan and confirmation...'));
  }

  const waitResult = await waitForWeixinLogin({
    sessionKey: startResult.sessionKey,
    apiBaseUrl: DEFAULT_BASE_URL,
    timeoutMs: 480000,
    verbose: true,
    onQrRefresh: (newUrl: string) => {
      console.log(chalk.blue('\nQR code refreshed. New URL:'));
      console.log(newUrl);
    },
  });

  if (waitResult.connected && waitResult.botToken && waitResult.accountId) {
    const normalizedId = saveWeixinAccount(waitResult.accountId, {
      token: waitResult.botToken,
      baseUrl: waitResult.baseUrl,
      userId: waitResult.userId,
    });

    console.log(chalk.green('\n✅ Login successful!'));
    console.log(chalk.blue(`Account ID: ${normalizedId}`));

    // Check if daemon is running and reload accounts
    const daemonStatus = getStatus();
    if (daemonStatus.running) {
      const port = getPort();
      try {
        const resp = await fetch(`http://localhost:${port}/api/weixin/reload`, { method: 'POST' });
        if (resp.ok) {
          console.log(chalk.blue('\n已自动加入守护进程轮询'));
        }
      } catch {
        console.log(chalk.yellow('\n守护进程运行中，请手动重启以加载新账号: hometale stop && hometale start'));
      }
    } else {
      console.log(chalk.blue('\n📱 Next steps:'));
      console.log(chalk.blue(`  Run: hometale start`));
    }
  } else {
    console.error(chalk.red('\n❌ Login failed:'), waitResult.message);
  }
}

async function weixinList(_args: string[]) {
  const accounts = listWeixinAccountIds();
  if (accounts.length === 0) {
    console.log(chalk.yellow('No Weixin accounts configured.'));
    console.log(chalk.blue('Run "hometale weixin login" to set up an account.'));
    return;
  }

  console.log(chalk.blue('Weixin accounts:'));
  console.log(chalk.blue('================'));
  for (const accountId of accounts) {
    const account = loadWeixinAccount(accountId);
    const running = isAccountRunning(accountId);
    const status = getAccountStatus(accountId);
    console.log(`\n${chalk.bold(accountId)}`);
    if (account) {
      console.log(`  Enabled: ${account.enabled !== false ? chalk.green('yes') : chalk.red('no')}`);
      console.log(`  Saved: ${account.savedAt}`);
    }
    console.log(`  Running: ${running ? chalk.green('yes') : chalk.red('no')}`);
    if (status.lastInboundAt) {
      console.log(`  Last message: ${new Date(status.lastInboundAt).toLocaleString()}`);
    }
    if (status.lastError) {
      console.log(chalk.red(`  Last error: ${status.lastError}`));
    }
  }
}

async function weixinLogout(args: string[]) {
  const accountId = args[0];
  if (!accountId) {
    console.error(chalk.red('Please specify an account ID: hometale weixin logout <id>'));
    return;
  }

  const account = loadWeixinAccount(accountId);
  if (!account) {
    console.error(chalk.red(`Account "${accountId}" not found.`));
    return;
  }

  await stopAccount(accountId);
  deleteWeixinAccount(accountId);
  console.log(chalk.green(`✅ Account "${accountId}" logged out and removed.`));
}

async function weixinStatus(_args: string[]) {
  // Try to get live status from the running daemon
  const daemonAccounts = await queryWeixinStatusFromDaemon();

  if (daemonAccounts && daemonAccounts.length > 0) {
    console.log(chalk.blue('Weixin status (from daemon):'));
    console.log(chalk.blue('============================'));
    for (const acc of daemonAccounts) {
      console.log(`\n${chalk.bold(acc.accountId)}: ${acc.running ? chalk.green('running') : chalk.red('stopped')}`);
      if (acc.lastInboundAt) {
        console.log(`  Last message: ${new Date(acc.lastInboundAt).toLocaleString()}`);
      }
      if (acc.lastError) {
        console.log(chalk.red(`  Last error: ${acc.lastError}`));
      }
    }
    return;
  }

  // Fallback: daemon not running, show static account info
  const accounts = listWeixinAccountIds();
  if (accounts.length === 0) {
    console.log(chalk.yellow('No Weixin accounts configured.'));
    return;
  }

  console.log(chalk.blue('Weixin accounts (daemon not running):'));
  console.log(chalk.blue('====================================='));
  for (const accountId of accounts) {
    const account = loadWeixinAccount(accountId);
    console.log(`\n${chalk.bold(accountId)}: ${chalk.red('stopped')}`);
    if (account) {
      console.log(`  Enabled: ${account.enabled !== false ? chalk.green('yes') : chalk.red('no')}`);
    }
  }
}
