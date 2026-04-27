import chalk from 'chalk';
import { stopDaemon, getStatus } from '../lib/daemon.js';

export async function stopCommand() {
  const status = getStatus();
  if (!status.running) {
    console.log(chalk.yellow('⚠️  守护进程未运行\n'));
    process.exit(0);
  }

  console.log(chalk.blue('停止守护进程...\n'));
  try {
    await stopDaemon();
    console.log(chalk.green('✅ 守护进程已停止\n'));
    process.exit(0);
  } catch (error: any) {
    console.error(chalk.red('❌ 停止守护进程失败:'), error.message);
    process.exit(1);
  }
}
