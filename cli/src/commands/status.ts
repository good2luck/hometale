import chalk from 'chalk';
import { getStatus, getDaemonLogPath } from '../lib/daemon.js';
import {
  listWeixinAccountIds,
  isAccountRunning,
  getAccountStatus,
  initGateway,
  loadRegisteredAccounts
} from '@hometale/server';

export async function statusCommand() {
  // 初始化微信网关
  await initGateway();
  loadRegisteredAccounts();

  const status = getStatus();

  console.log(chalk.cyan('\n╔═══════════════════════════════════════╗'));
  console.log(chalk.cyan('║     HomeTale - 状态                    ║'));
  console.log(chalk.cyan('╚═══════════════════════════════════════╝\n'));

  // 守护进程状态
  if (status.running) {
    console.log(chalk.green('✅ 守护进程运行中\n'));
    console.log(`  PID: ${status.pid}`);
    console.log(`  端口: ${process.env.PORT || 3001}`);
    console.log(`  日志: ${getDaemonLogPath()}\n`);
    console.log(chalk.blue(`Web UI: http://localhost:${process.env.PORT || 3001}\n`));
  } else {
    console.log(chalk.yellow('⚠️  守护进程未运行\n'));
    console.log('  使用以下命令启动:');
    console.log('    hometale start\n');
  }

  // 微信账号状态
  const accounts = listWeixinAccountIds();
  if (accounts.length > 0) {
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('📱 微信账号状态'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    for (const accountId of accounts) {
      const running = isAccountRunning(accountId);
      const status = getAccountStatus(accountId);
      const statusIcon = running ? '🟢' : '🔴';

      console.log(`${statusIcon} ${chalk.bold(accountId)}`);
      console.log(`   状态: ${running ? chalk.green('运行中') : chalk.red('已停止')}`);

      if (status.lastInboundAt) {
        const lastMsgTime = new Date(status.lastInboundAt);
        const now = new Date();
        const diffMinutes = Math.floor((now.getTime() - lastMsgTime.getTime()) / 60000);
        let timeStr = lastMsgTime.toLocaleString('zh-CN', { hour12: false });

        if (diffMinutes < 1) {
          timeStr += ' (刚刚)';
        } else if (diffMinutes < 60) {
          timeStr += ` (${diffMinutes} 分钟前)`;
        } else if (diffMinutes < 1440) {
          timeStr += ` (${Math.floor(diffMinutes / 60)} 小时前)`;
        } else {
          timeStr += ` (${Math.floor(diffMinutes / 1440)} 天前)`;
        }
        console.log(`   最后消息: ${timeStr}`);
      }

      if (status.lastError) {
        console.log(chalk.red(`   错误: ${status.lastError}`));
      }
      console.log();
    }
  } else {
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.gray('📱 未配置微信账号'));
    console.log(chalk.gray('   运行 "hometale weixin login" 进行配置\n'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  }

  process.exit(0);
}
