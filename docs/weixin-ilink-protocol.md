# 微信 ilink 协议说明

HomeTale 使用腾讯微信的 ilink 协议与后端网关通信。开发者如需对接自己的后端，需实现以下接口。

> 协议参考：[openclaw-weixin](https://github.com/tencent-weixin/openclaw-weixin)

## 通用请求

所有接口均使用 `POST` 方法，JSON 请求/响应体。

### 请求头

| Header | 描述 |
|--------|------|
| `Content-Type` | `application/json` |
| `AuthorizationType` | 固定值 `ilink_bot_token` |
| `Authorization` | `Bearer <token>`（登录后获取） |
| `X-WECHAT-UIN` | Base64 编码的随机 uint32 |

## 接口列表

| 接口 | 路径 | 描述 |
|------|--------|------|
| getUpdates | `getupdates` | 长轮询获取新消息 |
| sendMessage | `sendmessage` | 发送消息（文本/图片/视频/文件） |
| getUploadUrl | `getuploadurl` | 获取 CDN 上传预签名 URL |
| getConfig | `getconfig` | 获取账号配置（typing ticket 等） |
| sendTyping | `sendtyping` | 发送/取消输入状态指示器 |

### 1. getUpdates - 长轮询获取新消息

服务器在有新消息到达或超时时响应。

**请求体：**

```json
{
  "get_updates_buf": ""
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `get_updates_buf` | `string` | 上次响应返回的同步游标；首次请求传空字符串 |

**响应体：**

```json
{
  "ret": 0,
  "msgs": [...],
  "get_updates_buf": "<new cursor>",
  "longpolling_timeout_ms": 35000
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `ret` | `number` | 返回码，`0` = 成功 |
| `errcode` | `number?` | 错误码（如 `-14` = session 超时） |
| `errmsg` | `string?` | 错误描述 |
| `msgs` | `WeixinMessage[]` | 消息列表（结构见下文） |
| `get_updates_buf` | `string` | 下次请求传递的新同步游标 |
| `longpolling_timeout_ms` | `number?` | 服务器建议的下一次长轮询超时时间（毫秒） |

### 2. sendMessage - 发送消息

向用户发送消息。

**请求体：**

```json
{
  "msg": {
    "to_user_id": "<target user ID>",
    "context_token": "<conversation context token>",
    "item_list": [
      {
        "type": 1,
        "text_item": { "text": "Hello" }
      }
    ]
  }
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `to_user_id` | `string` | 目标用户 ID |
| `context_token` | `string` | 会话上下文 Token（从消息中获取） |
| `item_list` | `MessageItem[]` | 消息内容列表 |

**消息类型：**

| type | 描述 | item 字段 |
|------|------|----------|
| `1` | 文本 | `text_item: { text: string }` |
| `2` | 图片 | `image_item: { cdnMedia: CDNMedia }` |
| `3` | 语音 | `voice_item: { cdnMedia: CDNMedia }` |
| `4` | 文件 | `file_item: { cdnMedia: CDNMedia }` |
| `5` | 视频 | `video_item: { cdnMedia: CDNMedia }` |

### 3. getUploadUrl - 获取上传 URL

上传文件前需先调用此接口获取 CDN 预签名参数。

**请求体：**

```json
{
  "filekey": "<file identifier>",
  "media_type": 1,
  "to_user_id": "<target user ID>",
  "rawsize": 12345,
  "rawfilemd5": "<plaintext MD5>",
  "filesize": 12352,
  "thumb_rawsize": 1024,
  "thumb_rawfilemd5": "<thumbnail plaintext MD5>",
  "thumb_filesize": 1040
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `media_type` | `number` | `1` = IMAGE, `2` = VIDEO, `3` = FILE |
| `rawsize` | `number` | 原始文件明文大小 |
| `rawfilemd5` | `string` | 原始文件明文 MD5 |
| `filesize` | `number` | AES-128-ECB 加密后的密文大小 |
| `thumb_rawsize` | `number?` | 缩略图明文大小（IMAGE/VIDEO 必填） |
| `thumb_rawfilemd5` | `string?` | 缩略图明文 MD5（IMAGE/VIDEO 必填） |
| `thumb_filesize` | `number?` | 缩略图密文大小（IMAGE/VIDEO 必填） |

**响应体：**

```json
{
  "upload_param": "<original image upload encrypted parameters>",
  "thumb_upload_param": "<thumbnail upload encrypted parameters>"
}
```

### 4. getConfig - 获取账号配置

获取账号配置，包括 typing ticket。

**请求体：**

```json
{
  "ilink_user_id": "<user ID>",
  "context_token": "<optional, conversation context token>"
}
```

**响应体：**

```json
{
  "ret": 0,
  "typing_ticket": "<base64-encoded typing ticket>"
}
```

### 5. sendTyping - 发送输入状态

发送或取消输入状态指示器。

**请求体：**

```json
{
  "ilink_user_id": "<user ID>",
  "typing_ticket": "<obtained from getConfig>",
  "status": 1
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `status` | `number` | `1` = 输入中, `2` = 取消输入 |

## 消息结构

### WeixinMessage

| 字段 | 类型 | 描述 |
|------|------|------|
| `seq` | `number?` | 消息序号 |
| `message_id` | `number?` | 唯一消息 ID |
| `from_user_id` | `string?` | 发送者 ID |
| `to_user_id` | `string?` | 接收者 ID |
| `create_time_ms` | `number?` | 创建时间戳（毫秒） |
| `session_id` | `string?` | 会话 ID |
| `message_type` | `number?` | `1` = USER, `2` = BOT |
| `message_state` | `number?` | `0` = NEW, `1` = GENERATING, `2` = FINISH |
| `item_list` | `MessageItem[]?` | 消息内容列表 |
| `context_token` | `string?` | 会话上下文 Token，回复时需传回 |

### MessageItem

| 字段 | 类型 | 描述 |
|------|------|------|
| `type` | `number` | `1` TEXT, `2` IMAGE, `3` VOICE, `4` FILE, `5` VIDEO |
| `text_item` | `{ text: string }?` | 文本内容 |
| `image_item` | `ImageItem?` | 图片（含 CDN 引用和 AES 密钥） |
| `voice_item` | `VoiceItem?` | 语音（SILK 编码） |
| `file_item` | `FileItem?` | 文件附件 |
| `video_item` | `VideoItem?` | 视频 |
| `ref_msg` | `RefMessage?` | 引用消息 |

## CDN 媒体引用 (CDNMedia)

所有媒体类型（图片/语音/文件/视频）均通过 CDN 使用 AES-128-ECB 加密传输：

| 字段 | 类型 | 描述 |
|------|------|------|
| `encrypt_query_param` | `string?` | CDN 下载/上传的加密参数 |
| `aes_key` | `string?` | Base64 编码的 AES-128 密钥 |

## CDN 媒体上传流程

1. **计算文件参数**：计算文件的明文大小、MD5，以及 AES-128-ECB 加密后的密文大小
2. **缩略图参数**（如需要）：同样计算缩略图的明文和密文参数
3. **获取上传 URL**：调用 `getUploadUrl` 获取 `upload_param`（和 `thumb_upload_param`）
4. **加密并上传**：使用 AES-128-ECB 加密文件内容并 PUT 上传到 CDN
5. **上传缩略图**：同样方式加密并上传缩略图
6. **构造消息**：使用返回的 `encrypt_query_param` 构建消息，包含在 `MessageItem` 中发送

## HomeTale 实现

### 代码位置

| 文件 | 描述 |
|------|------|
| `server/src/weixin/api.ts` | API 调用实现 |
| `server/src/weixin/types.ts` | 完整类型定义 |
| `server/src/weixin/messaging.ts` | 消息处理（发送/接收） |
| `server/src/weixin/gateway.ts` | 长轮询 Gateway 实现 |

### 快速对接示例

```typescript
import { getUpdates, sendMessage, getUploadUrl, getConfig, sendTyping } from './weixin/api';

// 1. 长轮询
async function pollLoop() {
  let buffer = '';
  while (true) {
    const result = await getUpdates({ baseUrl, token, get_updates_buf: buffer });
    if (result.ret === 0) {
      buffer = result.get_updates_buf || '';
      for (const msg of result.msgs || []) {
        await processMessage(msg);
      }
    }
  }
}

// 2. 发送文本消息
await sendMessage({
  to: fromUserId,
  text: 'Hello!',
  contextToken: inbound.contextToken,
  opts: { baseUrl, token },
  cdnBaseUrl: DEFAULT_CDN_BASE_URL,
});

// 3. 发送输入状态
const typingConfig = await fetchTypingConfig({
  toUserId: fromUserId,
  contextToken: inbound.contextToken,
  opts: { baseUrl, token },
});

await sendTypingStatus({
  toUserId: fromUserId,
  typing: true,
  typingTicket: typingConfig.typingTicket,
  opts: { baseUrl, token },
});
```

## 错误处理

| 错误码 | 描述 | 处理建议 |
|---------|------|----------|
| `-14` | Session 过期 | 重新登录，停止轮询 |
| 非 0 | API 错误 | 根据 errmsg 提示用户，重试 |

```typescript
if (resp.errcode === -14 || resp.ret === -14) {
  logger.error('Session expired, stopping');
  runtime.running = false;
  return;
}
```