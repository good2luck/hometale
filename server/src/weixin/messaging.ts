/**
 * Weixin message handling for HomeTale integration.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { sendMessageApi, getConfig, sendTyping } from "./api.js";
import type { WeixinApiOptions } from "./api.js";
import { logger } from "./logger.js";
import type {
  WeixinMessage,
  MessageItem,
  SendMessageReq,
  GetConfigResp,
} from "./types.js";
import {
  MessageItemType,
  MessageState,
  MessageType,
  TypingStatus,
} from "./types.js";
import { downloadAndDecryptBuffer } from "./cdn.js";
import {
  uploadFileToWeixin,
  uploadVideoToWeixin,
  uploadFileAttachmentToWeixin,
} from "./cdn.js";

// ---------------------------------------------------------------------------
// Context token store (in-process cache + disk persistence)
// ---------------------------------------------------------------------------

const contextTokenStore = new Map<string, string>();

function contextTokenKey(accountId: string, userId: string): string {
  return `${accountId}:${userId}`;
}

export function setContextToken(
  accountId: string,
  userId: string,
  token: string
): void {
  const k = contextTokenKey(accountId, userId);
  logger.debug(`setContextToken: key=${k}`);
  contextTokenStore.set(k, token);
}

export function getContextToken(
  accountId: string,
  userId: string
): string | undefined {
  const k = contextTokenKey(accountId, userId);
  return contextTokenStore.get(k);
}

export function loadContextTokensFromStorage(_accountId: string): void {
  // Load from storage if needed
}

// ---------------------------------------------------------------------------
// Message ID generation
// ---------------------------------------------------------------------------

function generateClientId(): string {
  return `hometale-weixin:${Date.now()}:${crypto.randomBytes(4).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Inbound message parsing
// ---------------------------------------------------------------------------

export interface WeixinInboundMessage {
  accountId: string;
  fromUserId: string;
  text?: string;
  mediaPath?: string;
  mediaType?: string;
  contextToken?: string;
  timestamp?: number;
}

/** Extract text body from item_list. */
function extractTextBody(itemList?: MessageItem[]): string {
  if (!itemList?.length) return "";
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text);
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

/** Check if item is a media type. */
function isMediaItem(item: MessageItem): boolean {
  return (
    item.type === MessageItemType.IMAGE ||
    item.type === MessageItemType.VIDEO ||
    item.type === MessageItemType.FILE ||
    item.type === MessageItemType.VOICE
  );
}

/** Download media from message item to temp directory. */
async function downloadMediaFromItem(
  item: MessageItem,
  cdnBaseUrl: string,
  tempDir: string
): Promise<{ mediaPath: string; mediaType: string } | undefined> {
  try {
    await fs.mkdir(tempDir, { recursive: true });

    if (item.type === MessageItemType.IMAGE && item.image_item?.media) {
      const media = item.image_item.media;
      const aesKey =
        item.image_item.aeskey || media.aes_key || "";
      const encParam = media.encrypt_query_param || "";
      const fullUrl = media.full_url || "";

      if (encParam || fullUrl) {
        const buf = await downloadAndDecryptBuffer(
          encParam,
          aesKey,
          cdnBaseUrl,
          "image-download",
          fullUrl
        );
        const ext = ".jpg";
        const filename = `weixin-img-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
        const filepath = path.join(tempDir, filename);
        await fs.writeFile(filepath, buf);
        return { mediaPath: filepath, mediaType: "image/jpeg" };
      }
    }

    if (item.type === MessageItemType.FILE && item.file_item?.media) {
      const media = item.file_item.media;
      const aesKey = media.aes_key || "";
      const encParam = media.encrypt_query_param || "";
      const fullUrl = media.full_url || "";
      const fileName = item.file_item.file_name || "file";

      if (encParam || fullUrl) {
        const buf = await downloadAndDecryptBuffer(
          encParam,
          aesKey,
          cdnBaseUrl,
          "file-download",
          fullUrl
        );
        const ext = path.extname(fileName) || ".bin";
        const filename = `weixin-file-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
        const filepath = path.join(tempDir, filename);
        await fs.writeFile(filepath, buf);
        return { mediaPath: filepath, mediaType: "application/octet-stream" };
      }
    }

    if (item.type === MessageItemType.VIDEO && item.video_item?.media) {
      const media = item.video_item.media;
      const aesKey = media.aes_key || "";
      const encParam = media.encrypt_query_param || "";
      const fullUrl = media.full_url || "";

      if (encParam || fullUrl) {
        const buf = await downloadAndDecryptBuffer(
          encParam,
          aesKey,
          cdnBaseUrl,
          "video-download",
          fullUrl
        );
        const ext = ".mp4";
        const filename = `weixin-video-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
        const filepath = path.join(tempDir, filename);
        await fs.writeFile(filepath, buf);
        return { mediaPath: filepath, mediaType: "video/mp4" };
      }
    }
  } catch (err) {
    logger.error(`Failed to download media: ${String(err)}`);
  }
  return undefined;
}

/**
 * Convert a WeixinMessage to a HomeTale-friendly inbound message.
 */
export async function parseInboundMessage(
  msg: WeixinMessage,
  accountId: string,
  cdnBaseUrl: string
): Promise<WeixinInboundMessage> {
  const fromUserId = msg.from_user_id || "";
  const text = extractTextBody(msg.item_list);
  const tempDir = path.join(os.tmpdir(), "hometale-weixin");
  let mediaInfo: { mediaPath: string; mediaType: string } | undefined;

  if (msg.item_list) {
    for (const item of msg.item_list) {
      if (isMediaItem(item)) {
        mediaInfo = await downloadMediaFromItem(item, cdnBaseUrl, tempDir);
        if (mediaInfo) break;
      }
    }
  }

  return {
    accountId,
    fromUserId,
    text,
    mediaPath: mediaInfo?.mediaPath,
    mediaType: mediaInfo?.mediaType,
    contextToken: msg.context_token,
    timestamp: msg.create_time_ms,
  };
}

// ---------------------------------------------------------------------------
// Outbound message sending
// ---------------------------------------------------------------------------

/** Build a SendMessageReq containing a single text message. */
function buildTextMessageReq(params: {
  to: string;
  text: string;
  contextToken?: string;
  clientId: string;
}): SendMessageReq {
  const { to, text, contextToken, clientId } = params;
  const item_list: MessageItem[] = text
    ? [{ type: MessageItemType.TEXT, text_item: { text } }]
    : [];
  return {
    msg: {
      from_user_id: "",
      to_user_id: to,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: item_list.length ? item_list : undefined,
      context_token: contextToken ?? undefined,
    },
  };
}

/** Send a plain text message to Weixin. */
export async function sendTextMessage(params: {
  to: string;
  text: string;
  contextToken?: string;
  opts: WeixinApiOptions;
}): Promise<void> {
  const { to, text, contextToken, opts } = params;
  const clientId = generateClientId();
  const req = buildTextMessageReq({ to, text, contextToken, clientId });
  try {
    await sendMessageApi({
      baseUrl: opts.baseUrl,
      token: opts.token,
      timeoutMs: opts.timeoutMs,
      body: req,
    });
    logger.info(`sendTextMessage: OK to=${to}`);
  } catch (err) {
    logger.error(`sendTextMessage: FAILED to=${to} err=${String(err)}`);
    throw err;
  }
}

/** Send one or more media items (optionally with text caption). */
async function sendMediaItems(params: {
  to: string;
  text: string;
  mediaItem: MessageItem;
  contextToken?: string;
  opts: WeixinApiOptions;
  label: string;
}): Promise<void> {
  const { to, text, mediaItem, contextToken, opts, label } = params;
  const items: MessageItem[] = [];
  if (text) {
    items.push({ type: MessageItemType.TEXT, text_item: { text } });
  }
  items.push(mediaItem);

  for (const item of items) {
    const clientId = generateClientId();
    const req: SendMessageReq = {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [item],
        context_token: contextToken ?? undefined,
      },
    };
    try {
      await sendMessageApi({
        baseUrl: opts.baseUrl,
        token: opts.token,
        timeoutMs: opts.timeoutMs,
        body: req,
      });
    } catch (err) {
      logger.error(`${label}: FAILED to=${to} err=${String(err)}`);
      throw err;
    }
  }
  logger.info(`${label}: OK to=${to}`);
}

/** Send an image message (with optional text caption). */
export async function sendImageMessage(params: {
  to: string;
  text: string;
  imagePath: string;
  contextToken?: string;
  opts: WeixinApiOptions;
  cdnBaseUrl: string;
}): Promise<void> {
  const { to, text, imagePath, contextToken, opts, cdnBaseUrl } = params;
  const uploaded = await uploadFileToWeixin({
    filePath: imagePath,
    toUserId: to,
    opts,
    cdnBaseUrl,
  });

  const imageItem: MessageItem = {
    type: MessageItemType.IMAGE,
    image_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
        encrypt_type: 1,
      },
      mid_size: uploaded.fileSizeCiphertext,
    },
  };

  await sendMediaItems({
    to,
    text,
    mediaItem: imageItem,
    contextToken,
    opts,
    label: "sendImageMessage",
  });
}

/** Send a video message (with optional text caption). */
export async function sendVideoMessage(params: {
  to: string;
  text: string;
  videoPath: string;
  contextToken?: string;
  opts: WeixinApiOptions;
  cdnBaseUrl: string;
}): Promise<void> {
  const { to, text, videoPath, contextToken, opts, cdnBaseUrl } = params;
  const uploaded = await uploadVideoToWeixin({
    filePath: videoPath,
    toUserId: to,
    opts,
    cdnBaseUrl,
  });

  const videoItem: MessageItem = {
    type: MessageItemType.VIDEO,
    video_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
        encrypt_type: 1,
      },
      video_size: uploaded.fileSizeCiphertext,
    },
  };

  await sendMediaItems({
    to,
    text,
    mediaItem: videoItem,
    contextToken,
    opts,
    label: "sendVideoMessage",
  });
}

/** Send a file message (with optional text caption). */
export async function sendFileMessage(params: {
  to: string;
  text: string;
  filePath: string;
  fileName?: string;
  contextToken?: string;
  opts: WeixinApiOptions;
  cdnBaseUrl: string;
}): Promise<void> {
  const { to, text, filePath, fileName, contextToken, opts, cdnBaseUrl } = params;
  const uploaded = await uploadFileAttachmentToWeixin({
    filePath,
    toUserId: to,
    opts,
    cdnBaseUrl,
  });

  const fileItem: MessageItem = {
    type: MessageItemType.FILE,
    file_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
        encrypt_type: 1,
      },
      file_name: fileName || path.basename(filePath),
      len: String(uploaded.fileSize),
    },
  };

  await sendMediaItems({
    to,
    text,
    mediaItem: fileItem,
    contextToken,
    opts,
    label: "sendFileMessage",
  });
}

/** Generic send function that handles text or media. */
export async function sendMessage(params: {
  to: string;
  text: string;
  mediaPath?: string;
  contextToken?: string;
  opts: WeixinApiOptions;
  cdnBaseUrl: string;
}): Promise<void> {
  const { to, text, mediaPath, contextToken, opts, cdnBaseUrl } = params;

  if (!mediaPath) {
    await sendTextMessage({ to, text, contextToken, opts });
    return;
  }

  const ext = path.extname(mediaPath).toLowerCase();
  const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
  const videoExts = [".mp4", ".mov", ".webm", ".avi", ".mkv"];

  if (imageExts.includes(ext)) {
    await sendImageMessage({
      to,
      text,
      imagePath: mediaPath,
      contextToken,
      opts,
      cdnBaseUrl,
    });
  } else if (videoExts.includes(ext)) {
    await sendVideoMessage({
      to,
      text,
      videoPath: mediaPath,
      contextToken,
      opts,
      cdnBaseUrl,
    });
  } else {
    await sendFileMessage({
      to,
      text,
      filePath: mediaPath,
      contextToken,
      opts,
      cdnBaseUrl,
    });
  }
}

// ---------------------------------------------------------------------------
// Typing status
// ---------------------------------------------------------------------------

export interface TypingConfig {
  typingTicket?: string;
}

/** Get typing ticket from Weixin API. */
export async function fetchTypingConfig(params: {
  toUserId: string;
  contextToken?: string;
  opts: WeixinApiOptions;
}): Promise<TypingConfig> {
  try {
    const resp: GetConfigResp = await getConfig({
      baseUrl: params.opts.baseUrl,
      token: params.opts.token,
      ilinkUserId: params.toUserId,
      contextToken: params.contextToken,
    });
    return { typingTicket: resp.typing_ticket };
  } catch (err) {
    logger.warn(`Failed to get typing ticket: ${String(err)}`);
    return {};
  }
}

/** Send typing status indicator. */
export async function sendTypingStatus(params: {
  toUserId: string;
  typing: boolean;
  typingTicket?: string;
  opts: WeixinApiOptions;
}): Promise<void> {
  if (!params.typingTicket) return;

  try {
    await sendTyping({
      baseUrl: params.opts.baseUrl,
      token: params.opts.token,
      body: {
        ilink_user_id: params.toUserId,
        typing_ticket: params.typingTicket,
        status: params.typing ? TypingStatus.TYPING : TypingStatus.CANCEL,
      },
    });
  } catch (err) {
    logger.debug(`Failed to send typing status: ${String(err)}`);
  }
}
