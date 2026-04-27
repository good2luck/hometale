/**
 * Weixin Gateway - manages long polling and message dispatching for HomeTale.
 */
import type { Config } from "../lib/config.js";
import {
  loadAccountData,
  listAccountIds,
  deleteAccountData,
  saveGetUpdatesBuf,
  loadGetUpdatesBuf,
  getUserMapping,
  saveUserMapping,
} from "./storage.js";
import type { WeixinAccountData } from "./types.js";
import { logger } from "./logger.js";
import { getUpdates } from "./api.js";
import { DEFAULT_BASE_URL, DEFAULT_CDN_BASE_URL } from "./accounts.js";
import type { WeixinMessage } from "./types.js";
import {
  parseInboundMessage,
  sendMessage,
  setContextToken,
  getContextToken,
  fetchTypingConfig,
  sendTypingStatus,
} from "./messaging.js";
import { getRole, createRole, guessRoleInfo } from "../roles/role-manager.js";
import { createSession } from "../session/session-store.js";
import { insertMessage, getContextMessages } from "../db/message-db.js";
import { runFamilyAgentStream } from "../agents/family-agent.js";

// ---------------------------------------------------------------------------
// Gateway state
// ---------------------------------------------------------------------------

interface AccountRuntime {
  accountId: string;
  account: WeixinAccountData;
  abortController: AbortController;
  running: boolean;
  lastInboundAt?: number;
  lastError?: Error;
}

const activeRuntimes = new Map<string, AccountRuntime>();
const SESSION_EXPIRED_ERRCODE = -14;

// ---------------------------------------------------------------------------
// User role mapping
// ---------------------------------------------------------------------------

/** Get role ID for a Weixin user. Returns null if role is pending (not yet identified). */
async function resolveRoleForUser(
  weixinUserId: string
): Promise<string | null> {
  const existing = getUserMapping(weixinUserId);
  if (existing) {
    // Legacy "weixin-user" mapping or pending — treat as unidentified
    if (existing.pending || existing.roleId === "weixin-user" || !existing.roleId) {
      return null;
    }
    return existing.roleId;
  }

  // First message from this user — create a pending mapping
  saveUserMapping({
    weixinUserId,
    roleId: "",
    pending: true,
    createdAt: new Date().toISOString(),
  });

  return null;
}

/** Try to detect role from message text. Returns roleId if detected, null otherwise. */
async function tryDetectAndAssignRole(
  weixinUserId: string,
  messageText: string
): Promise<string | null> {
  const guessed = guessRoleInfo(messageText);
  if (!guessed) {
    return null;
  }

  // Create role if it doesn't exist
  let role = await getRole(guessed.id);
  if (!role) {
    role = {
      id: guessed.id,
      name: guessed.name,
      avatar: guessed.avatar,
      robotIdentity: `你是${guessed.name}的贴心助手，帮助处理日常事务，关心家人。`,
      createdAt: new Date().toISOString().split("T")[0],
    };
    await createRole(role);
    logger.info(`Created role ${guessed.id} (${guessed.name}) for WeChat user ${weixinUserId}`);
  }

  // Update mapping — no longer pending
  saveUserMapping({
    weixinUserId,
    roleId: guessed.id,
    pending: false,
    createdAt: new Date().toISOString(),
  });

  return guessed.id;
}

const ROLE_PROMPT_REPLY = "你好！我是 HomeTale 家庭助手 🏠\n请告诉我你是谁？比如：爸爸、妈妈、爷爷、奶奶…";

// ---------------------------------------------------------------------------
// Message processing
// ---------------------------------------------------------------------------

async function processOneMessage(
  msg: WeixinMessage,
  runtime: AccountRuntime,
  config: Config
) {
  const { accountId, account } = runtime;
  const fromUserId = msg.from_user_id || "";
  if (!fromUserId) return;

  const now = Date.now();
  runtime.lastInboundAt = now;

  try {
    logger.info(`[${accountId}] Processing message from=${fromUserId}`);

    const inbound = await parseInboundMessage(
      msg,
      accountId,
      DEFAULT_CDN_BASE_URL
    );

    if (inbound.contextToken) {
      setContextToken(accountId, fromUserId, inbound.contextToken);
    }

    // --- Role resolution ---
    let roleId = await resolveRoleForUser(fromUserId);

    // No role assigned yet — try to detect from message text
    if (!roleId) {
      if (inbound.text) {
        const detectedRoleId = await tryDetectAndAssignRole(fromUserId, inbound.text);
        if (detectedRoleId) {
          roleId = detectedRoleId;
          logger.info(`[${accountId}] Detected role=${roleId} for WeChat user ${fromUserId}`);
        }
      }

      // Still no role — ask the user who they are
      if (!roleId) {
        logger.info(`[${accountId}] WeChat user ${fromUserId} has no role, prompting for identity`);
        const contextToken = getContextToken(accountId, fromUserId);
        await sendMessage({
          to: fromUserId,
          text: ROLE_PROMPT_REPLY,
          mediaPath: undefined,
          contextToken,
          opts: {
            baseUrl: account.baseUrl || DEFAULT_BASE_URL,
            token: account.token,
          },
          cdnBaseUrl: DEFAULT_CDN_BASE_URL,
        });
        return;
      }
    }

    const role = await getRole(roleId);
    if (!role) {
      logger.error(`[${accountId}] Failed to get role=${roleId}`);
      return;
    }

    const session = await createSession(roleId);
    const sessionId = session.id;

    if (inbound.text) {
      insertMessage({
        sessionId,
        roleId,
        role: "user",
        content: inbound.text,
        timestamp: new Date().toISOString(),
      });
    }

    if (!inbound.text && !inbound.mediaPath) {
      logger.debug(`[${accountId}] No text or media in message, skipping`);
      return;
    }

    const typingConfig = await fetchTypingConfig({
      toUserId: fromUserId,
      contextToken: inbound.contextToken,
      opts: {
        baseUrl: account.baseUrl || DEFAULT_BASE_URL,
        token: account.token,
      },
    });

    await sendTypingStatus({
      toUserId: fromUserId,
      typing: true,
      typingTicket: typingConfig.typingTicket,
      opts: {
        baseUrl: account.baseUrl || DEFAULT_BASE_URL,
        token: account.token,
      },
    });

    const contextMsgs = getContextMessages(sessionId, {
      baseLimit: 20,
      expandCompressed: false,
    });

    const promptText =
      inbound.text || (inbound.mediaPath ? "[用户发送了媒体文件]" : "");

    let fullResponse = "";
    try {
      const stream = runFamilyAgentStream(
        config.model,
        roleId,
        promptText,
        contextMsgs.map((m) => ({ role: m.role, content: m.content })),
        sessionId
      );

      while (true) {
        const result = await stream.next();
        if (result.done) break;

        const event = result.value;
        if (event.type === "text") {
          fullResponse += event.content;
        }
      }
    } catch (err) {
      logger.error(`[${accountId}] Agent error: ${String(err)}`);
      fullResponse = "抱歉，处理您的消息时遇到了问题，请稍后重试。";
    }

    await sendTypingStatus({
      toUserId: fromUserId,
      typing: false,
      typingTicket: typingConfig.typingTicket,
      opts: {
        baseUrl: account.baseUrl || DEFAULT_BASE_URL,
        token: account.token,
      },
    });

    if (fullResponse) {
      insertMessage({
        sessionId,
        roleId,
        role: "assistant",
        content: fullResponse,
        timestamp: new Date().toISOString(),
      });

      const contextToken = getContextToken(accountId, fromUserId);
      await sendMessage({
        to: fromUserId,
        text: fullResponse,
        mediaPath: undefined,
        contextToken,
        opts: {
          baseUrl: account.baseUrl || DEFAULT_BASE_URL,
          token: account.token,
        },
        cdnBaseUrl: DEFAULT_CDN_BASE_URL,
      });
    }
  } catch (err) {
    logger.error(`[${accountId}] Error processing message: ${String(err)}`);
    runtime.lastError = err as Error;
  }
}

// ---------------------------------------------------------------------------
// Long polling loop
// ---------------------------------------------------------------------------

async function runLongPollLoop(
  runtime: AccountRuntime,
  config: Config
): Promise<void> {
  const { accountId, account, abortController } = runtime;
  const baseUrl = account.baseUrl || DEFAULT_BASE_URL;

  let getUpdatesBuf = loadGetUpdatesBuf(accountId);
  let consecutiveFailures = 0;

  logger.info(`[${accountId}] Starting long poll loop`);

  while (!abortController.signal.aborted) {
    try {
      const resp = await getUpdates({
        baseUrl,
        token: account.token,
        get_updates_buf: getUpdatesBuf,
      });

      const isApiError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);

      if (isApiError) {
        if (resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE) {
          logger.error(`[${accountId}] Session expired, stopping`);
          runtime.lastError = new Error("Session expired");
          runtime.running = false;
          return;
        }

        consecutiveFailures++;
        logger.warn(
          `[${accountId}] API error (fail=${consecutiveFailures}): ret=${resp.ret} errcode=${resp.errcode}`
        );
        if (consecutiveFailures >= 3) {
          await new Promise((r) => setTimeout(r, 30000));
        } else {
          await new Promise((r) => setTimeout(r, 2000));
        }
        continue;
      }

      consecutiveFailures = 0;

      if (resp.get_updates_buf && resp.get_updates_buf !== getUpdatesBuf) {
        getUpdatesBuf = resp.get_updates_buf;
        saveGetUpdatesBuf(accountId, getUpdatesBuf);
      }

      const msgs = resp.msgs || [];
      for (const msg of msgs) {
        await processOneMessage(msg, runtime, config);
      }
    } catch (err) {
      if (abortController.signal.aborted) break;

      consecutiveFailures++;
      logger.error(
        `[${accountId}] Poll error (fail=${consecutiveFailures}): ${String(err)}`
      );

      runtime.lastError = err as Error;
      if (consecutiveFailures >= 3) {
        await new Promise((r) => setTimeout(r, 30000));
      } else {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  logger.info(`[${accountId}] Long poll loop stopped`);
  runtime.running = false;
}

// ---------------------------------------------------------------------------
// Account management
// ---------------------------------------------------------------------------

/** Start an account's long poll loop. */
export async function startAccount(
  accountId: string,
  config: Config
): Promise<void> {
  if (activeRuntimes.has(accountId)) {
    logger.warn(`[${accountId}] Account already running`);
    return;
  }

  const account = loadAccountData(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  const abortController = new AbortController();
  const runtime: AccountRuntime = {
    accountId,
    account,
    abortController,
    running: true,
  };

  activeRuntimes.set(accountId, runtime);

  runLongPollLoop(runtime, config).catch((err) => {
    logger.error(`[${accountId}] Long poll loop failed: ${String(err)}`);
    runtime.lastError = err;
    runtime.running = false;
  });
}

/** Stop an account's long poll loop. */
export async function stopAccount(accountId: string): Promise<void> {
  const runtime = activeRuntimes.get(accountId);
  if (!runtime) {
    logger.warn(`[${accountId}] Account not running`);
    return;
  }

  runtime.abortController.abort();
  activeRuntimes.delete(accountId);
  logger.info(`[${accountId}] Account stopped`);
}

/** Check if an account is running. */
export function isAccountRunning(accountId: string): boolean {
  return activeRuntimes.has(accountId) && activeRuntimes.get(accountId)!.running;
}

/** Get account status. */
export function getAccountStatus(accountId: string): {
  running: boolean;
  lastInboundAt?: number;
  lastError?: string;
} {
  const runtime = activeRuntimes.get(accountId);
  if (!runtime) {
    return { running: false };
  }
  return {
    running: runtime.running,
    lastInboundAt: runtime.lastInboundAt,
    lastError: runtime.lastError?.message,
  };
}

/** List all registered accounts. */
export function listAccounts(): string[] {
  return listAccountIds();
}

/** Get account data. */
export function getAccount(accountId: string): WeixinAccountData | null {
  return loadAccountData(accountId);
}

/** Delete an account. */
export async function removeAccount(accountId: string): Promise<void> {
  await stopAccount(accountId);
  deleteAccountData(accountId);
  logger.info(`Account ${accountId} deleted`);
}

/** Start all enabled accounts. */
export async function startAllEnabledAccounts(config: Config): Promise<void> {
  const accounts = listAccountIds();
  for (const accountId of accounts) {
    const account = loadAccountData(accountId);
    if (account && account.enabled !== false) {
      try {
        await startAccount(accountId, config);
      } catch (err) {
        logger.error(`Failed to start account ${accountId}: ${String(err)}`);
      }
    }
  }
}

/** Stop all running accounts. */
export async function stopAllAccounts(): Promise<void> {
  const accountIds = [...activeRuntimes.keys()];
  for (const accountId of accountIds) {
    await stopAccount(accountId);
  }
}

// ---------------------------------------------------------------------------
// Gateway initialization
// ---------------------------------------------------------------------------

export async function initGateway(): Promise<void> {
  logger.info("Weixin Gateway initialized");
}
