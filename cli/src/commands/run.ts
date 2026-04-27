import chalk from 'chalk';
import { loadConfig } from '@hometale/server';
import { checkConfig } from '../config-wizard.js';

// Import server bootstrap dynamically
async function startServer() {
  // Import the server module
  const modulePath = new URL('../web/index.js', import.meta.url);
  await import(modulePath.href);
}

export async function runCommand() {
  console.log(chalk.cyan('\n╔═══════════════════════════════════════╗'));
  console.log(chalk.cyan('║     HomeTale - 家的故事                ║'));
  console.log(chalk.cyan('╚═══════════════════════════════════════╝\n'));

  // Check and load config
  await checkConfig();

  const config = await loadConfig();
  if (!config.model.apiKey) {
    console.log(chalk.red('❌ 请先配置模型: hometale onboard\n'));
    process.exit(1);
  }

  const port = process.env.PORT || 3001;
  console.log(chalk.green(`✅ 启动服务器...\n`));
  console.log(chalk.blue(`Web UI: http://localhost:${port}\n`));

  try {
    await startServer();
  } catch (error: any) {
    console.error(chalk.red('❌ 启动失败:'), error.message);
    process.exit(1);
  }
}
