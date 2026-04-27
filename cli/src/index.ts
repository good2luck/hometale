#!/usr/bin/env node

import {
  runCommand,
  onboardCommand,
  startCommand,
  stopCommand,
  statusCommand,
  weixinCommand,
  logCommand
} from './commands/index.js';
import { checkConfig } from './config-wizard.js';
import { startChat } from './chat.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Legacy --config / -c flag
  if (args.includes('--config') || args.includes('-c')) {
    await (await import('./config-wizard.js')).configWizard();
    process.exit(0);
  }

  switch (command) {
    case 'run':
      await runCommand();
      break;

    case 'onboard': {
      const installDaemon = args.includes('--install-daemon');
      await onboardCommand({ installDaemon });
      break;
    }

    case 'start':
      await startCommand();
      // startCommand calls process.exit internally
      break;

    case 'stop':
      await stopCommand();
      // stopCommand calls process.exit internally
      break;

    case 'status':
      await statusCommand();
      // statusCommand calls process.exit internally
      break;

    case 'log': {
      const logArgs = args.slice(1);
      await logCommand(logArgs);
      // logCommand handles exit internally for --follow mode, or exits naturally
      if (!logArgs.includes('--follow') && !logArgs.includes('-f')) {
        process.exit(0);
      }
      break;
    }

    case 'weixin': {
      const subcommand = args[1];
      const subArgs = args.slice(2);
      await weixinCommand(subcommand, subArgs);
      // weixinCommand handles exit internally
      break;
    }

    case 'chat':
    default:
      await checkConfig();
      await startChat();
      // chat runs continuously, exits on /quit
      break;
  }
}

main().catch(console.error);
