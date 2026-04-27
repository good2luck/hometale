import chalk from 'chalk';
import { configWizard } from '../config-wizard.js';
import { startDaemon, getStatus } from '../lib/daemon.js';
import inquirer from 'inquirer';

export async function onboardCommand(options: { installDaemon?: boolean } = {}) {
  console.log(chalk.cyan('\n╔═══════════════════════════════════════╗'));
  console.log(chalk.cyan('║     HomeTale - 配置向导                ║'));
  console.log(chalk.cyan('╚═══════════════════════════════════════╝\n'));

  await configWizard();

  console.log(chalk.green('\n配置完成!\n'));

  // 检查是否需要自动启动
  const shouldAutoStart = options.installDaemon || await askAutoStart();

  if (!shouldAutoStart) {
    console.log(chalk.blue('提示：运行 "hometale start" 启动服务\n'));
    process.exit(0);
  }

  const status = getStatus();
  if (status.running) {
    console.log(chalk.yellow(`守护进程已在运行 (PID: ${status.pid})`));
    console.log(chalk.blue('微信账号轮询已在守护进程中运行\n'));
    process.exit(0);
  }

  console.log(chalk.blue('启动守护进程...'));
  try {
    const result = await startDaemon();
    console.log(chalk.green(`守护进程已启动 (PID: ${result.pid})`));
    console.log(chalk.blue(`Web UI: http://localhost:${result.port}`));
    console.log(chalk.blue('所有已启用的微信账号轮询已自动启动\n'));
    process.exit(0);
  } catch (error: any) {
    console.error(chalk.red('启动守护进程失败:'), error.message);
    process.exit(1);
  }
}

async function askAutoStart(): Promise<boolean> {
  const answer = await inquirer.prompt([{
    type: 'confirm',
    name: 'autoStart',
    message: '是否现在启动服务？（微信聊天需要）',
    default: true
  }]);
  return answer.autoStart;
}
