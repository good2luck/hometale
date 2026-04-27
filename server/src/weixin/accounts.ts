/**
 * Weixin account management.
 */
import { logger } from "./logger.js";
import { normalizeAccountId } from "./util.js";
import {
  saveAccountData,
  loadAccountData,
  listAccountIds,
  deleteAccountData,
} from "./storage.js";
import type { WeixinAccountData, ResolvedWeixinAccount } from "./types.js";

/** Default API base URL. */
export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
/** Default CDN base URL. */
export const DEFAULT_CDN_BASE_URL = "https://mmbiz.qpic.cn";

/** Registered account IDs in memory cache. */
const registeredAccountIds = new Set<string>();

/**
 * Load registered account IDs from storage and populate cache.
 */
export function loadRegisteredAccounts(): void {
  const ids = listAccountIds();
  for (const id of ids) {
    registeredAccountIds.add(id);
  }
  logger.info(`Loaded ${ids.length} Weixin accounts`);
}

/**
 * Register an account ID in memory.
 */
export function registerWeixinAccountId(accountId: string): void {
  registeredAccountIds.add(accountId);
}

/**
 * List all registered account IDs.
 */
export function listWeixinAccountIds(): string[] {
  return Array.from(registeredAccountIds);
}

/**
 * Save account data to storage.
 * @returns The normalized account ID
 */
export function saveWeixinAccount(
  rawAccountId: string,
  data: {
    token: string;
    baseUrl?: string;
    userId?: string;
  }
): string {
  const accountId = normalizeAccountId(rawAccountId);
  const accountData: WeixinAccountData = {
    token: data.token,
    baseUrl: data.baseUrl || DEFAULT_BASE_URL,
    userId: data.userId || "",
    savedAt: new Date().toISOString(),
    enabled: true,
  };
  saveAccountData(accountId, accountData);
  registeredAccountIds.add(accountId);
  logger.info(`Saved account data for: ${accountId}`);
  return accountId;
}

/**
 * Load account data from storage.
 */
export function loadWeixinAccount(
  accountId: string
): WeixinAccountData | null {
  return loadAccountData(accountId);
}

/**
 * Resolve an account to its full configuration.
 */
export function resolveWeixinAccount(
  accountId: string
): ResolvedWeixinAccount {
  const data = loadAccountData(accountId);
  if (!data) {
    return {
      accountId,
      baseUrl: DEFAULT_BASE_URL,
      cdnBaseUrl: DEFAULT_CDN_BASE_URL,
      token: "",
      enabled: false,
      configured: false,
      name: accountId,
    };
  }
  return {
    accountId,
    baseUrl: data.baseUrl || DEFAULT_BASE_URL,
    cdnBaseUrl: DEFAULT_CDN_BASE_URL,
    token: data.token,
    enabled: data.enabled ?? true,
    configured: true,
    name: accountId,
  };
}

/**
 * Delete an account.
 */
export function deleteWeixinAccount(accountId: string): void {
  deleteAccountData(accountId);
  registeredAccountIds.delete(accountId);
  logger.info(`Deleted account: ${accountId}`);
}

/**
 * Enable/disable an account.
 */
export function setWeixinAccountEnabled(
  accountId: string,
  enabled: boolean
): void {
  const data = loadAccountData(accountId);
  if (data) {
    data.enabled = enabled;
    saveAccountData(accountId, data);
    logger.info(`${enabled ? "Enabled" : "Disabled"} account: ${accountId}`);
  }
}

/**
 * Clear context tokens for an account (placeholder for future implementation).
 */
export function clearContextTokensForAccount(accountId: string): void {
  // Context tokens are stored separately in storage.ts
  // This is called when a user logs in again to clean up old sessions
  logger.debug(`clearContextTokensForAccount: ${accountId}`);
}

/**
 * Clear stale accounts for a user (placeholder for future implementation).
 */
export function clearStaleAccountsForUserId(
  newAccountId: string,
  userId: string | undefined,
  _clearContextTokensFn: (accountId: string) => void
): void {
  if (!userId) return;
  logger.debug(`clearStaleAccountsForUserId: userId=${userId} newAccountId=${newAccountId}`);
  // In the future, we could remove old accounts belonging to the same user
}

/**
 * Placeholder for config route tag loading (not used in HomeTale integration).
 */
export function loadConfigRouteTag(): string | undefined {
  return undefined;
}

/**
 * Placeholder for triggering reload (not used in HomeTale integration).
 */
export function triggerWeixinChannelReload(): void {
  logger.debug("triggerWeixinChannelReload called");
}
