# HomeTale - 家的故事

> **全家人的智能体**：多角色共享记忆 + 懂家庭关系 + 情感关怀/成长记录

## 项目背景

HomeTale 是一个基于 Subagents 架构的家庭智能体项目，支持多家庭成员沟通、长期记忆、动态子智能体和权限控制。

### 工程设计：借鉴 Claude Code Harness 架构

HomeTale 的核心架构借鉴了 Claude Code 的 Harness 工程设计理念，通过以下关键机制实现稳定可靠的智能体系统：

| 设计原则 | 实现机制 | 效果 |
|----------|----------|------|
| **自动化循环** | Vercel AI SDK `streamText` + `maxSteps` | 工具调用准确率高，流式输出实时推送 |
| **工具安全** | 三层防线（路径沙箱 + 角色权限 + 危险命令黑名单） | 防止未经授权的文件操作和命令执行 |
| **技能渐进披露** | 两层加载（元数据 + 按需展开） | 初始 Token 低（~1000/skill），避免上下文膨胀 |
| **上下文管理** | Micro-Compact + Auto-Compact 双层压缩 | 清理冗余 `tool_result`，LLM 总结替换历史 |
| **系统提示词模块化** | 静态/动态分离，可缓存 | 减少重复计算，支持热更新 |
| **错误自恢复** | 重试机制 + Doom Loop 检测 | 自动终止死循环，API 失败自动重试 |

### 与个人智能助手的根本区别

| 特性 | 个人工具 | HomeTale |
|------|----------|----------|
| 记忆范围 | 单人 | **跨角色共享（带隐私过滤）** |
| 关系理解 | 无 | **懂家庭角色关系** |
| 核心场景 | 任务执行 | **情感关怀 + 成长记录** |

### 设计理念

| 理念 | 说明 |
|------|------|
| **薄而通用的 Agent** | 核心保持简单，不做过多场景化逻辑 |
| **跨角色记忆** | 在关心家人时可读取家人的长期记忆，自动过滤隐私 |
| **内容级隐私** | `[private]` 行级标记，而非目录隔离 |
| **每个角色自包含** | `roles/{id}/memory/` 而非全局 memory |

### 使用场景

**场景 1：家人之间的情感关怀**
```
老婆问："老公爱我们吗？"
→ 智能体读老公记忆（过滤隐私）
→ 提取关于老婆和孩子的点滴
→ 给出温暖回答
```

**场景 2：孩子成长回忆录**
```
家长日常记录孩子成长点滴
→ 智能体整理到长期记忆
→ 用 Skill 生成 Markdown 回忆录、PPT 大纲、时间线
```

## 功能特性

- **角色系统**：支持多个家庭成员，动态创建角色
- **记忆系统**：长期记忆 + 每日总结 + 全量消息 SQLite
- **隐私控制**：`[private]` 行级标记，跨角色读取自动过滤
- **Agent 循环**：基于 Vercel AI SDK 的自动工具调用
- **双界面支持**：CLI 和 Web UI
- **智能角色切换**：对话中说"我是爸爸"自动切换
- **微信集成**：扫码登录，首次对话自动识别角色身份
- **守护进程模式**：后台运行 Web 服务，启动时自动开始微信轮询
- **日志跟踪**：`hometale log --follow` 实时查看服务日志
- **Skills 系统**：两层加载 + 渐进式披露
- **上下文压缩**：Micro-Compact + Auto-Compact

## 技术栈

- **Monorepo**: Turbo + npm workspaces
- **后端**: Express + TypeScript + Vercel AI SDK + better-sqlite3
- **前端**: React + Vite + Tailwind CSS + shadcn/ui
- **AI**: OpenAI / Anthropic SDK + Vercel AI SDK
- **CLI**: Inquirer.js + Chalk

## 快速开始
### 方式一、通过 npm 安装 并 启动
已经安装node，版本不低于18

```bash
npm install -g @hometale/cli
hometale onboard                       # 配置模型
hometale onboard --install-daemon      # 配置并启动守护进程
```

## 命令参考

### 基础命令

| 命令 | 说明 |
|------|------|
| `hometale` 或 `hometale chat` | 进入交互式对话模式 |
| `hometale run` | 启动 Web 服务器（前台） |
| `hometale onboard` | 运行配置向导 |
| `hometale onboard --install-daemon` | 配置并启动守护进程 |
| `hometale start` | 启动后台守护进程（含所有微信账号轮询） |
| `hometale stop` | 停止后台守护进程 |
| `hometale status` | 查看守护进程状态 |
| `hometale log` | 查看守护进程日志（最近 50 行） |
| `hometale log --follow` | 实时跟踪日志输出 |
| `hometale log --lines=N` | 指定日志行数 |

### 微信命令

| 命令 | 说明 |
|------|------|
| `hometale weixin login` | 扫码登录微信 |
| `hometale weixin list` | 列出已配置账号 |
| `hometale weixin logout <id>` | 登出并移除账号 |
| `hometale weixin status` | 查看所有账号状态 |


**注意**：
- `hometale start` 启动守护进程后，会自动运行 Web 服务器并启动所有已启用的微信账号轮询
- 守护进程运行时，新登录的微信账号会自动加入轮询（无需重启守护进程）
- 首次通过微信发消息时，需告知角色身份（如"我是爸爸"），系统自动创建角色并绑定
- 守护进程需要持续运行才能接收微信消息

## 项目架构

### 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户接入层                                │
├──────────────┬──────────────┬───────────────────────────────────┤
│   CLI Chat   │   Web UI     │         Weixin Gateway            │
│  (本地对话)   │  (H5 界面)   │         (长轮询)                  │
└──────┬───────┴──────┬───────┴────────────────┬──────────────────┘
       │              │                        │
       ▼              ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    HTTP Server (3001)                           │
│              server/src/web/index.ts                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │  REST API   │  │   WebSocket  │  │   Weixin API Mgmt   │   │
│  │ /api/chat   │  │    /ws       │  │    /api/weixin      │   │
│  └──────┬──────┘  └──────┬───────┘  └─────────────────────┘   │
│         │                 │                                        │
│         ▼                 ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │              Family Agent (runFamilyAgent)                   │  │
│  │         - 角色识别 - 记忆管理 - 工具调用                    │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      核心能力层                                  │
├──────────────┬──────────────┬───────────────────────────────────┤
│  记忆管理     │   Skills     │          工具系统                 │
│  Memory Mgr  │   System     │         Tools + Perm              │
└──────────────┴──────────────┴───────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      数据存储层                                  │
├──────────────┬──────────────┬───────────────────────────────────┤
│   SQLite     │   文件系统   │          Session Store             │
│  messages.db │ ~/.hometale/ │   sessions/{id}.json              │
└──────────────┴──────────────┴───────────────────────────────────┘
```

### 模块化说明

```
hometale/
├── cli/                      # CLI 命令行工具
│   └── src/
│       ├── commands/         # 命令处理（onboard / run / start / stop / status / log / weixin）
│       ├── chat.ts           # 交互式对话实现
│       └── lib/              # 守护进程管理等工具
│
├── server/                   # 后端核心
│   └── src/
│       ├── lib/              # 基础工具（路径、配置、文件操作）
│       ├── roles/            # 角色系统
│       ├── session/          # Session 管理
│       ├── memory/           # 记忆系统（读写、隐私过滤、LLM 总结）
│       ├── db/               # 消息数据库
│       ├── agents/           # Agent 核心（家庭智能体、LLM 客户端、系统提示词）
│       ├── agent-core/       # Agent 核心循环（消息处理、工具系统、上下文压缩、WebSocket）
│       ├── skills/           # Skills 系统（加载器、渐进式披露、内置 Skills）
│       ├── cron/             # 定时任务（记忆总结调度）
│       ├── weixin/           # 微信接入（长轮询 Gateway、API、消息处理、账号管理）
│       ├── websocket/        # WebSocket 服务
│       └── web/              # Web API（Express 主服务、路由、中间件）
│
├── web/                      # React 前端
│   └── src/
│       ├── components/       # UI 组件
│       ├── hooks/            # React Hooks
│       └── lib/              # 工具函数
│
└── scripts/                  # 构建脚本
```

## 微信对接说明

### 架构概述

HomeTale 通过独立的长轮询 Gateway 接入微信：

```
Weixin API (长轮询)
    ↓
Weixin Gateway (weixin/gateway.ts)
    ↓
runFamilyAgentStream()
    ↓
AI SDK
```

### 对接流程

#### 1. 扫码登录

```bash
hometale weixin login
```

系统会显示二维码，用微信扫码登录。登录后：
- 账号信息保存在 `~/.hometale/weixin/accounts/{accountId}.json`
- Token 保存在 `~/.hometale/weixin/tokens/{accountId}.json`

#### 2. 长轮询机制

Gateway 启动后会持续调用 `getUpdates` API：
- 默认超时：30 秒
- 失败重试：指数退避（2s → 30s）
- Session 过期：自动停止轮询

#### 3. 消息处理流程

```
收到微信消息
    ↓
解析消息（文本、图片、语音）
    ↓
识别用户身份（weixinUserId → roleId）
    ↓
如果未识别：询问"你是谁？"
    ↓
调用 Family Agent
    ↓
发送回复到微信
```

#### 4. 角色识别

首次对话时，用户需要说明身份：
```
用户: 我是爸爸
系统: 自动创建 dad 角色，绑定微信号
```

后续对话自动使用该角色，无需重复识别。

### 配置说明

微信配置存储在 `~/.hometale/weixin/`：

```
~/.hometale/weixin/
├── accounts/
│   └── {accountId}.json       # 账号信息（baseUrl, enabled）
├── tokens/
│   └── {accountId}.json       # 登录 Token
├── buffers/
│   └── {accountId}.json       # 轮询 Buffer（避免重复消息）
└── user-mapping.json          # 微信用户ID → 角色映射
```

### 管理命令

```bash
# 查看所有账号
hometale weixin list

# 查看账号状态
hometale weixin status

# 登出账号
hometale weixin logout <accountId>

# 重新加载配置（无需重启守护进程）
curl http://localhost:3001/api/weixin/reload
```

### 注意事项

1. **守护进程必须运行**：只有守护进程运行时才能接收微信消息
2. **Token 有效期**：微信 Token 有限期，过期后需要重新登录
3. **网络稳定性**：长轮询需要稳定的网络连接
4. **多账号支持**：支持同时登录多个微信账号

### ilink 协议文档

完整的 ilink 协议说明（接口定义、消息结构、CDN 上传流程等）请参考：
📄 [docs/weixin-ilink-protocol.md](./docs/weixin-ilink-protocol.md)

## ⚙️ Harness 技术实现详解

以下是对项目背景中所述 Harness 设计理念的详细技术说明，包括具体实现和代码示例。

### 1. Agent 循环机制

HomeTale 使用 Vercel AI SDK 的 `streamText` 实现自动 Agent 循环：

```typescript
const result = streamText({
  model,
  system: fullSystemPrompt,
  messages,
  tools,
  maxSteps: 10,
});

for await (const part of result.fullStream) {
  switch (part.type) {
    case 'text-delta':      // 实时文本块
    case 'tool-call':       // 工具调用开始
    case 'tool-result':     // 工具执行结果
  }
}
```

**优势**：
- 工具调用准确率高（API 原生 tool_use）
- 流式输出实时推送
- 自动管理消息历史
- 多 LLM 兼容统一 API

详见 [docs/01agent-loop.md](./docs/01agent-loop.md)

### 2. 工具系统

工具系统由三层安全防线构成：

| 防线 | 机制 | 文件 |
|------|------|------|
| 第一层 | 路径沙箱 | `permissions.ts` `resolveAndValidatePath()` |
| 第二层 | 角色权限 | `permissions.ts` `canPerformAction()` |
| 第三层 | 危险命令黑名单 | `safety-checks.ts` `isDangerousCommand()` |

**工具列表**：
- `read_file` - 读取文件（支持行数限制）
- `write_file` - 写入文件
- `edit_file` - 精确替换
- `delete_file` - 删除文件
- `list_dir` - 列出目录
- `search_files` - 搜索内容
- `run_bash` - 执行命令（带安全控制）

详见 [docs/02agent-tool-use.md](./docs/02agent-tool-use.md)

### 3. Skills 两层加载

```
System Prompt (Layer 1 — always present, cheap):
+------------------------------------------+
| Skills available:                        |
|   - git: Git workflow helpers            |  ~100 tokens/skill
|   - pdf: Process PDF files              |
+------------------------------------------+

When model calls load_skill("git"):
+------------------------------------------+
| tool_result (Layer 2 — on demand, costly):|
| <skill name="git">                       |
|   Full git workflow instructions...      |  ~2000 tokens
| </skill>                                 |
+------------------------------------------+
```

**优势**：
- 描述列表便宜（~1,000 tokens）
- 详细内容按需加载（避免 20,000+ tokens）
- ProgressiveDisclosure：只暴露相关 Skill

详见 [docs/03agent_skill.md](./docs/03agent_skill.md)

### 4. 上下文压缩

两层压缩策略：

| 压缩类型 | 触发时机 | 策略 |
|----------|----------|------|
| **Micro-Compact** | 每次消息处理 | 清理旧 `tool_result` |
| **Auto-Compact** | Token > 50,000 | LLM 总结替换历史 |

**压缩标记**：
```
[COMPACTED]
summary: 对话总结...
originalCount: 100
compactedAt: 2026-03-31T10:00:00Z
```

详见 [docs/04agent-context-compact.md](./docs/04agent-context-compact.md)

### 5. 系统提示词设计

模块化构建系统提示词：

| 部分 | 静态/动态 | 说明 |
|------|-----------|------|
| 核心指令 | 静态 | Agent 基本角色定位 |
| Skills 元数据 | 静态 | 已披露的技能列表 |
| AGENTS.md | 静态 | 全局配置 |
| 操作指南 | 静态 | 工具使用说明 |
| 角色信息 | 动态 | 当前角色 |
| 家庭记忆 | 动态 | 记忆摘要 |

**静态/动态分离**：
```typescript
const DYNAMIC_BOUNDARY = "=== DYNAMIC_BOUNDARY ===";

// 静态部分可缓存
const staticPrefix = promptBuilder.getStaticPrefix();

// 动态部分每轮重建
const dynamicSuffix = promptBuilder.buildDynamicSuffix(role, familyMemories);
```

详见 [docs/05agent-prompt.md](./docs/05agent-prompt.md)

### 6. 错误发现与处理

错误分类与处理策略：

| 错误类型 | 处理策略 |
|----------|----------|
| LLM 调用失败 | 重试 3 次，指数退避 |
| 工具执行失败 | 返回 `[ERROR]` 前缀，模型感知 |
| 权限拒绝 | 返回 `[ERROR]` 前缀 |
| 危险命令 | 黑名单拦截 |

**Doom Loop 检测**：
```typescript
if (detectToolLoop(recentToolCalls, tool.name)) {
  return `[ERROR] 工具调用进入循环，已自动终止`;
}
```

详见 [docs/06agent-error-discover.md](./docs/06agent-error-discover.md)

## 数据存储

所有用户数据存储在 `~/.hometale/` 下，首次启动由 `ensureHometaleStructure()` 自动创建。

```
~/.hometale/
├── AGENTS.md                       # 全局上下文（角色列表/约定/隐私规则）
├── config.json                     # LLM 配置 + Web 访问 token
├── messages.db                     # 全部对话消息（SQLite, WAL）
├── daemon.pid                      # 守护进程 PID
├── daemon.log                      # 守护进程日志
├── roles/
│   └── {role-id}/                  # dad / mom / grandpa / 拼音名
│       ├── INDEX.md                # 角色配置（Markdown 字段列表）
│       └── memory/
│           ├── MEMORY.md           # 长期记忆
│           ├── memory-YYYY-MM-DD.md  # 每日 LLM 总结
│           └── .summary-state.json   # 增量总结进度
├── sessions/
│   └── {session-id}.json           # Session（7 天有效）
├── skills/
│   └── {skill-id}/                 # SKILL.md + tool.json + 可选 executor.js
└── weixin/
    ├── accounts/                   # 微信账号配置
    ├── tokens/                     # 微信登录 Token
    ├── buffers/                    # 轮询 Buffer
    └── user-mapping.json           # 微信用户ID → 角色映射
```

### 文件读写机制

| 文件/目录 | 读 | 写 | 说明 |
|----------|----|----|------|
| `AGENTS.md` | 启动时确保存在 | 仅在缺失时写入默认模板 | 用户可手动编辑 |
| `config.json` | `loadConfig()` 合并默认值 | `saveConfig()` 临时文件 + rename | 缺 token 自动补 |
| `messages.db` | `getMessagesBySessionId` / `getMessagesByRoleIdAndDate` | `insertMessage()` 追加 | better-sqlite3, WAL, 索引 session_id/role_id |
| `roles/{id}/INDEX.md` | `listRoles()` 枚举后 `getRole()` 解析 | `createRole()` 模板写入 | 按"`- 字段名:`"匹配 |
| `MEMORY.md` | `getLongTermMemory(filterPrivate=true)` 默认过滤 `[private]` | `updateLongTermMemory()` 追加；`updateLongTermFromDaily()` LLM 整合后整体覆盖 | 跨角色读取强制过滤 |
| `memory-YYYY-MM-DD.md` | `getDailySummaryForDate()` | `appendDailySummary()` 追加 | 每日 LLM 总结 |
| `.summary-state.json` | `loadSummaryState()` | `saveSummaryState()` 全量覆盖 | 记录已总结的 message id, 避免重复 |
| `sessions/{id}.json` | `getSession()`(过期返回 null) | `createSession()` 写入 | 32 字节 ID, 7 天过期 |
| `skills/{id}/*` | `loadAllSkills()` 启动扫描；`loadExecutor()` 动态 import | `initializeDefaultSkills()` 仅在目录为空时写入内置 skill | 内置 executor 优先 |

**通用约束**（`server/src/lib/fs-utils.ts`）：
- 文本/JSON 写入一律 `.tmp` + rename（原子）
- 读取失败返回 `null`，调用方判空
- `readTextFile` 支持 `maxLines`/`maxChars` 截断

**隐私机制**（`server/src/memory/memory-manager.ts`）：
- 行级 `[private]` 标记；`filterPrivateContent()` 按行过滤
- 跨角色读取（`getMemoryForAgent`）强制开启过滤
- LLM 总结前先过滤，避免私密内容污染长期记忆


## 开发

```bash
npm install            # 根目录安装依赖
npm run dev            # 启动整个项目（server + web）
npm run build          # 构建所有项目
npm run lint           # 代码检查

cd server && npm run dev   # 仅后端
cd web && npm run dev      # 仅前端
cd cli && npm start        # 启动 CLI
```

### 开发验证流程（CLI 修改后测试）

修改 CLI 代码后，按以下步骤验证：

```bash
# 1. 构建所有项目并打包 CLI，项目根目录执行，对应脚本定义在根目录的 package.json
npm run pack

# 2. 全局安装打包后的 CLI，cd 到 cli 目录
npm install -g hometale-cli-0.1.0.tgz

# 3. 测试命令
hometale              # 进入对话模式
hometale onboard      # 测试配置向导（包括新增的微信配置步骤）
hometale weixin login # 测试微信扫码登录
```

