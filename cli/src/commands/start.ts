import chalk from 'chalk';
import { loadConfig, listWeixinAccountIds, loadWeixinAccount } from '@hometale/server';
import { startDaemon, getStatus } from '../lib/daemon.js';

export async function startCommand() {
  const config = await loadConfig();
  if (!config.model.apiKey) {
    console.log(chalk.red('请先配置模型: hometale onboard\n'));
    process.exit(1);
  }

  const status = getStatus();
  if (status.running) {
    console.log(chalk.yellow(`守护进程已在运行 (PID: ${status.pid})\n`));
    return;
  }

  // Show WeChat accounts that will be auto-started
  const accounts = listWeixinAccountIds();
  const enabledAccounts = accounts.filter(id => {
    const acc = loadWeixinAccount(id);
    return acc && acc.enabled !== false;
  });

  console.log(chalk.blue('启动守护进程...'));
  if (enabledAccounts.length > 0) {
    console.log(chalk.blue(`将自动启动 ${enabledAccounts.length} 个微信账号轮询: ${enabledAccounts.join(', ')}`));
  }

  try {
    const result = await startDaemon();
    console.log(chalk.green(`守护进程已启动 (PID: ${result.pid})`));
    console.log(chalk.blue(`Web UI: http://localhost:${result.port}`));
    if (enabledAccounts.length > 0) {
      console.log(chalk.green(`微信轮询: ${enabledAccounts.length} 个账号已启动`));
    }
    process.exit(0);
  } catch (error: any) {
    console.error(chalk.red('启动守护进程失败:'), error.message);
    process.exit(1);
  }
}
