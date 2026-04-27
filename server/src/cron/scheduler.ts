import cron from 'node-cron';
import path from 'node:path';
import fs from 'node:fs';
import { getHometaleRoot, ensureDir, getYesterdayDateString } from '../lib/hometale-path.js';
import { loadConfig } from '../lib/config.js';
import {
  summarizeAllRolesDaily,
  updateAllRolesLongTerm
} from '../memory/memory-summarizer.js';

let dailySummaryTask: cron.ScheduledTask | null = null;
let longTermUpdateTask: cron.ScheduledTask | null = null;
const LOCK_FILE = 'memory-summarizer.lock';

function getLockFilePath(): string {
  const root = getHometaleRoot();
  ensureDir(root);
  return path.join(root, LOCK_FILE);
}

export function acquireLock(): boolean {
  const lockFile = getLockFilePath();
  try {
    if (fs.existsSync(lockFile)) {
      const lockTime = parseInt(fs.readFileSync(lockFile, 'utf-8'), 10);
      const now = Date.now();
      if (now - lockTime < 30 * 60 * 1000) {
        console.log('[MemoryScheduler] Lock is still active, skipping');
        return false;
      }
    }
    fs.writeFileSync(lockFile, Date.now().toString());
    return true;
  } catch (error) {
    console.error('[MemoryScheduler] Failed to acquire lock:', error);
    return false;
  }
}

export function releaseLock(): void {
  const lockFile = getLockFilePath();
  try {
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
  } catch (error) {
    console.error('[MemoryScheduler] Failed to release lock:', error);
  }
}

export function checkLock(): boolean {
  const lockFile = getLockFilePath();
  if (!fs.existsSync(lockFile)) {
    return false;
  }
  const lockTime = parseInt(fs.readFileSync(lockFile, 'utf-8'), 10);
  const now = Date.now();
  return now - lockTime < 30 * 60 * 1000;
}

async function runDailySummary(): Promise<void> {
  console.log('[MemoryScheduler] Starting daily summary task...');

  if (!acquireLock()) {
    return;
  }

  try {
    const config = await loadConfig();
    if (!config.model.apiKey) {
      console.warn('[MemoryScheduler] API key not configured, skipping daily summary');
      return;
    }

    const dateStr = getYesterdayDateString();
    await summarizeAllRolesDaily(dateStr, config.model);
    console.log('[MemoryScheduler] Daily summary completed');
  } catch (error) {
    console.error('[MemoryScheduler] Daily summary failed:', error);
  } finally {
    releaseLock();
  }
}

async function runLongTermUpdate(): Promise<void> {
  console.log('[MemoryScheduler] Starting long-term memory update task...');

  if (!acquireLock()) {
    return;
  }

  try {
    const config = await loadConfig();
    if (!config.model.apiKey) {
      console.warn('[MemoryScheduler] API key not configured, skipping long-term update');
      return;
    }

    const dateStr = getYesterdayDateString();
    await updateAllRolesLongTerm(dateStr, config.model);
    console.log('[MemoryScheduler] Long-term memory update completed');
  } catch (error) {
    console.error('[MemoryScheduler] Long-term memory update failed:', error);
  } finally {
    releaseLock();
  }
}

export function startMemorySummarizerCron(): void {
  if (dailySummaryTask || longTermUpdateTask) {
    console.log('[MemoryScheduler] Cron tasks already running');
    return;
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  dailySummaryTask = cron.schedule('0 0 * * *', async () => {
    await runDailySummary();
  }, {
    timezone
  });

  longTermUpdateTask = cron.schedule('0 1 * * *', async () => {
    await runLongTermUpdate();
  }, {
    timezone
  });

  console.log('[MemoryScheduler] Cron tasks started');
  console.log('[MemoryScheduler] - Daily summary at 00:00 (timezone: ' + timezone + ')');
  console.log('[MemoryScheduler] - Long-term update at 01:00 (timezone: ' + timezone + ')');
}

export function stopMemorySummarizerCron(): void {
  if (dailySummaryTask) {
    dailySummaryTask.stop();
    dailySummaryTask = null;
  }
  if (longTermUpdateTask) {
    longTermUpdateTask.stop();
    longTermUpdateTask = null;
  }
  console.log('[MemoryScheduler] Cron tasks stopped');
}

export function triggerDailySummaryNow(): Promise<void> {
  return runDailySummary();
}

export function triggerLongTermUpdateNow(): Promise<void> {
  return runLongTermUpdate();
}
