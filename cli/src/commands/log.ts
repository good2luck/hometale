/**
 * Log command for HomeTale - view and follow daemon logs.
 */
import chalk from 'chalk';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { getDaemonLogPath, getStatus } from '../lib/daemon.js';

const DEFAULT_LINES = 50;

export async function logCommand(args: string[]) {
  const follow = args.includes('--follow') || args.includes('-f');
  const linesArg = args.find(a => a.startsWith('--lines=') || a.startsWith('-n'));
  const lines = linesArg
    ? parseInt(linesArg.split('=')[1] || linesArg.replace('-n', ''), 10)
    : DEFAULT_LINES;

  const logPath = getDaemonLogPath();

  if (!fs.existsSync(logPath)) {
    const status = getStatus();
    if (!status.running) {
      console.log(chalk.yellow('Daemon is not running and no log file exists.'));
      console.log(chalk.blue('Run "hometale start" to start the daemon.'));
    } else {
      console.log(chalk.yellow('Log file not found at: ' + logPath));
    }
    return;
  }

  if (follow) {
    // Use tail -f for real-time following
    const tail = spawn('tail', ['-n', String(lines), '-f', logPath], {
      stdio: 'inherit',
    });

    tail.on('error', (err) => {
      console.error(chalk.red(`Failed to tail log: ${err.message}`));
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      tail.kill();
      process.exit(0);
    });

    tail.on('exit', () => {
      process.exit(0);
    });
  } else {
    // Show last N lines
    const content = fs.readFileSync(logPath, 'utf-8');
    const allLines = content.trim().split('\n');
    const lastLines = allLines.slice(-lines);
    console.log(lastLines.join('\n'));
  }
}
