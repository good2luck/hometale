# CLAUDE.md

本文件是 Claude Code 工作时的索引。**项目说明、目录结构、数据存储与开发命令请直接看 [README.md](./README.md)**;实施计划见 [PROJECT_PLAN.md](./PROJECT_PLAN.md)。

## 项目本质

HomeTale 是"全家人的智能体":多角色共享记忆(带隐私控制)+ 懂家庭关系 + 情感关怀/成长记录场景。与 OpenClaw(个人工具)的根本区别在于跨角色记忆共享。

## 关键约束(改代码前必读)

- **路径全部走 `server/src/lib/hometale-path.ts`**,不要硬编码 `~/.hometale/...`
- **写文本/JSON 用 `lib/fs-utils.ts` 中的 `writeTextFile`/`writeJsonFile`**:已实现 `.tmp` + rename 原子写
- **跨角色读取记忆必须经 `filterPrivateContent`**:`[private]` 是行级标记,不是目录隔离
- **对话消息一律走 `server/src/db/message-db.ts`**:不要再写 `conv-*.md` 文件(已废弃)
- **Skills 内置 executor 优先**:见 `server/src/skills/loader.ts` 的 `BUILTIN_EXECUTORS`,自定义 skill 才走 `executor.js` 动态 import

## 模块速查

| 模块 | 路径 |
|------|------|
| 路径管理 | server/src/lib/hometale-path.ts |
| 原子文件读写 | server/src/lib/fs-utils.ts |
| 配置加载 | server/src/lib/config.ts |
| 角色 | server/src/roles/role-manager.ts |
| Session | server/src/session/session-store.ts |
| 记忆读写 | server/src/memory/memory-manager.ts |
| 记忆总结 | server/src/memory/memory-summarizer.ts |
| 消息 DB | server/src/db/message-db.ts |
| 主 Agent | server/src/agents/family-agent.ts |
| 工具系统 | server/src/agent-core/tools/ |
| Skills 加载 | server/src/skills/loader.ts |
| Skills 初始化 | server/src/skills/initializer.ts |

## 常用命令

```bash
npm run dev          # 同时启动 server + web
npm run build
npm run lint
```

更多见 [README.md#开发](./README.md#开发)。

## 文档

- [README.md](./README.md) - 安装、目录结构、数据存储、文件读写机制
- [PROJECT_PLAN.md](./PROJECT_PLAN.md) - 设计理念、场景、实施进度
- [docs/superpowers/specs/2026-04-01-hometale-core-design.md](./docs/superpowers/specs/2026-04-01-hometale-core-design.md) - 核心设计
- [docs/01agent-loop.md](./docs/01agent-loop.md) - Agent 循环
- [docs/02agent-tool-use.md](./docs/02agent-tool-use.md) - 工具系统与安全机制
- [docs/03agent_skill.md](./docs/03agent_skill.md) - Skill 两层加载与 ProgressiveDisclosure
