/**
 * Local storage utilities for Weixin module.
 */
import path from 'node:path';
import fs from 'node:fs';
import {
  getWeixinAccountPath,
  getWeixinSyncBufPath,
  getWeixinContextTokensPath,
  getWeixinUserMappingsPath,
  getWeixinAccountsPath,
  ensureDir,
} from '../lib/hometale-path.js';
import type { WeixinAccountData, WeixinUserMapping } from './types.js';
import { logger } from './logger.js';

function readJsonFileSync<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function writeJsonFileSync(filePath: string, data: any): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, filePath);
}

// ========== Account storage ==========

export function saveAccountData(accountId: string, data: WeixinAccountData): void {
  const filePath = getWeixinAccountPath(accountId);
  ensureDir(path.dirname(filePath));
  writeJsonFileSync(filePath, data);
  logger.debug(`Saved account data for ${accountId}`);
}

export function loadAccountData(accountId: string): WeixinAccountData | null {
  const filePath = getWeixinAccountPath(accountId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return readJsonFileSync<WeixinAccountData>(filePath);
}

export function listAccountIds(): string[] {
  const dirPath = getWeixinAccountsPath();
  ensureDir(dirPath);
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const files = fs.readdirSync(dirPath);
  return files
    .filter((f) => f.endsWith('.json') && !f.includes('.sync') && !f.includes('.context-tokens'))
    .map((f) => f.replace('.json', ''));
}

export function deleteAccountData(accountId: string): void {
  const filePath = getWeixinAccountPath(accountId);
  const syncPath = getWeixinSyncBufPath(accountId);
  const tokensPath = getWeixinContextTokensPath(accountId);

  [filePath, syncPath, tokensPath].forEach((p) => {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  });
  logger.info(`Deleted account data for ${accountId}`);
}

// ========== Sync buffer storage ==========

export function saveGetUpdatesBuf(accountId: string, buf: string): void {
  const filePath = getWeixinSyncBufPath(accountId);
  writeJsonFileSync(filePath, { buf, updatedAt: new Date().toISOString() });
}

export function loadGetUpdatesBuf(accountId: string): string {
  const filePath = getWeixinSyncBufPath(accountId);
  const data = readJsonFileSync<{ buf: string }>(filePath);
  return data?.buf || '';
}

// ========== Context token storage ==========

export function saveContextTokens(
  accountId: string,
  tokens: Map<string, string>
): void {
  const filePath = getWeixinContextTokensPath(accountId);
  const obj = Object.fromEntries(tokens.entries());
  writeJsonFileSync(filePath, obj);
}

export function loadContextTokens(accountId: string): Map<string, string> {
  const filePath = getWeixinContextTokensPath(accountId);
  const obj = readJsonFileSync<Record<string, string>>(filePath) || {};
  return new Map(Object.entries(obj));
}

// ========== User mappings storage ==========

export function saveUserMappings(mappings: WeixinUserMapping[]): void {
  const filePath = getWeixinUserMappingsPath();
  writeJsonFileSync(filePath, mappings);
}

export function loadUserMappings(): WeixinUserMapping[] {
  const filePath = getWeixinUserMappingsPath();
  const data = readJsonFileSync<WeixinUserMapping[]>(filePath);
  return data || [];
}

export function getUserMapping(weixinUserId: string): WeixinUserMapping | null {
  const mappings = loadUserMappings();
  return mappings.find((m) => m.weixinUserId === weixinUserId) || null;
}

export function saveUserMapping(mapping: WeixinUserMapping): void {
  const mappings = loadUserMappings();
  const index = mappings.findIndex((m) => m.weixinUserId === mapping.weixinUserId);
  if (index >= 0) {
    mappings[index] = mapping;
  } else {
    mappings.push(mapping);
  }
  saveUserMappings(mappings);
}
