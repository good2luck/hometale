import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getHometaleDir(): string {
  return path.join(os.homedir(), '.hometale');
}

function getPidPath(): string {
  return path.join(getHometaleDir(), 'daemon.pid');
}

export function getDaemonLogPath(): string {
  return path.join(getHometaleDir(), 'daemon.log');
}

export function getPort(): number {
  return parseInt(process.env.PORT || '3001', 10);
}

/** Check if a port is in use. */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => { server.close(); resolve(false); });
    server.listen(port);
  });
}

/** Kill the process occupying the given port (macOS/Linux). */
function killProcessOnPort(port: number): void {
  try {
    const pid = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' }).trim();
    if (pid) {
      process.kill(parseInt(pid, 10), 'SIGTERM');
      console.log(`Killed process ${pid} on port ${port}`);
    }
  } catch {
    // lsof returns non-zero if no process found — ignore
  }
}

export function getStatus(): { running: boolean; pid?: number } {
  const pidPath = getPidPath();

  if (!fs.existsSync(pidPath)) {
    return { running: false };
  }

  try {
    const pidStr = fs.readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);

    if (isNaN(pid)) {
      return { running: false };
    }

    // Check if process is running
    try {
      process.kill(pid, 0); // Signal 0 just checks if process exists
      return { running: true, pid };
    } catch {
      // Process doesn't exist, clean up pid file
      fs.unlinkSync(pidPath);
      return { running: false };
    }
  } catch {
    return { running: false };
  }
}

export async function startDaemon(): Promise<{ pid: number; port: number }> {
  const status = getStatus();
  if (status.running) {
    throw new Error(`Daemon is already running (PID: ${status.pid})`);
  }

  const port = getPort();

  // Check if port is in use and kill the occupant if needed
  if (await isPortInUse(port)) {
    console.log(`Port ${port} is in use, killing existing process...`);
    killProcessOnPort(port);
    // Wait for port to be released
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 300));
      if (!(await isPortInUse(port))) break;
    }
    if (await isPortInUse(port)) {
      throw new Error(`Port ${port} is still in use after attempting to free it`);
    }
  }

  const hometaleDir = getHometaleDir();
  if (!fs.existsSync(hometaleDir)) {
    fs.mkdirSync(hometaleDir, { recursive: true });
  }

  const pidPath = getPidPath();
  const logPath = getDaemonLogPath();

  // Find the actual server entry point
  // daemon.js is at dist/lib/, server is at dist/server/
  const serverScript = path.join(__dirname, '../server/web/index.js');

  // Open log file for appending
  const logFd = fs.openSync(logPath, 'a');

  const child = spawn(process.execPath, [serverScript], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      NODE_ENV: 'production'
    }
  });

  child.unref();

  // Wait a bit and check if it started
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Check if process is still running
  try {
    process.kill(child.pid!, 0);
  } catch {
    throw new Error('Failed to start daemon. Check log file: ' + logPath);
  }

  fs.writeFileSync(pidPath, child.pid!.toString());

  return {
    pid: child.pid!,
    port
  };
}

export async function stopDaemon(): Promise<void> {
  const status = getStatus();
  if (!status.running) {
    throw new Error('Daemon is not running');
  }

  try {
    process.kill(status.pid!, 'SIGTERM');

    // Wait for process to stop
    let attempts = 0;
    while (attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 200));
      const newStatus = getStatus();
      if (!newStatus.running) {
        break;
      }
      attempts++;
    }

    // Force kill if still running
    const finalStatus = getStatus();
    if (finalStatus.running) {
      process.kill(finalStatus.pid!, 'SIGKILL');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (err: any) {
    if (err.code !== 'ESRCH') {
      throw err;
    }
    // ESRCH means process doesn't exist - that's fine
  }

  // Clean up pid file
  const pidPath = getPidPath();
  if (fs.existsSync(pidPath)) {
    fs.unlinkSync(pidPath);
  }
}

