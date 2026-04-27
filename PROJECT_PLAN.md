# HomeTale - 家的故事 - 实施计划

> 数据目录与读写机制详见 [CLAUDE.md](./CLAUDE.md)。本文聚焦设计理念、场景与实施进度。

## 设计理念

**HomeTale 是"全家人的智能体"**,与 OpenClaw 的根本区别在于:记忆可在家人间共享(带隐私控制),智能体懂家庭关系,擅长情感关怀和成长记录。

- **薄而通用的 Agent**:核心保持简单,不做过多场景化逻辑
- **跨角色记忆**:在关心家人时可读取家人的长期记忆,自动过滤隐私
- **内容级隐私**:`[private]` 行级标记,而非目录隔离
- **每个角色自包含**:`roles/{id}/memory/` 而非全局 memory

### Skills vs Subagents

| | 适用场景 | 特点 |
|---|---|---|
| Skills | 单个查询任务 | 串行、简单、可插拔 |
| Subagents | 并行复杂任务 | 动态创建、用完销毁 |

### 角色 ID 约定

固定:`dad` / `mom` / `grandpa` / `grandma`;孩子用小名拼音(如 `xiaoming`)。约定记录在 `~/.hometale/AGENTS.md`。

## 使用场景

### 场景 1:家人之间的情感关怀
老婆问"老公爱我们吗?" → 智能体读老公记忆(过滤隐私) → 提取关于老婆和孩子的点滴 → 给出温暖回答。

### 场景 2:孩子成长回忆录
家长日常记录孩子成长点滴 → 智能体整理到长期记忆 → 用 Skill/Subagent 生成 Markdown 回忆录、PPT 大纲、时间线。

## 需求矩阵

| 维度 | 选择 |
|------|------|
| 访问方式 | Web UI (H5) + 微信 ilink + 长期运行 Node 后端 |
| 角色认证 | Session(支持 Web 和 ilink) |
| 权限控制 | 内容级隐私标记 + 应用层校验 |
| 角色管理 | 枚举 `roles/` 目录,每个角色一个 `INDEX.md` |
| 数据存储 | `~/.hometale/` |
| 记忆结构 | 每个角色自包含 `memory/` |
| 对话存储 | SQLite (`messages.db`) |
| 私有存储 | 规划中(原计划 `private.db`,暂未实现) |
| Subagent | 对话中触发动态创建,完成即销毁 |
| 记忆格式 | 纯 Markdown |
| Agent 框架 | LangGraph JS + Vercel AI SDK |

## 技术栈

- TypeScript + Express(后端长期运行)
- React + Vite + Tailwind CSS + shadcn/ui(前端 H5)
- LangGraph JS + Vercel AI SDK(Agent)
- better-sqlite3(消息存储)
- Session:文件持久化(`sessions/{id}.json`,7 天过期)

## 文件格式示例

### `~/.hometale/roles/{id}/INDEX.md`
```markdown
# 爸爸 - 角色配置

- 角色 ID: dad
- 名字: 爸爸
- 头像: 👨
- 机器人身份: 你是一个贴心的助手...
- 创建时间: 2026-03-31

---

密码哈希: [hashed-password]
```

### `~/.hometale/roles/{id}/memory/MEMORY.md`
```markdown
# 爸爸的长期记忆

## 关于自己
- 喜欢喝咖啡
- 对花粉过敏

## 关于家人
- 妈妈喜欢养花,每周三晚上有瑜伽课

[private] 银行卡密码 123456    ← 该行不会被其他角色读取,也不会进入总结
```

### `~/.hometale/roles/{id}/memory/memory-2026-03-31.md`
```markdown
# 2026-03-31 对话总结

- 上午讨论了周末去哪里玩,决定去植物园春游
- 记得带帐篷和零食
```

## 实施进度

- [x] 项目初始化(monorepo + TypeScript + workspaces)
- [x] `~/.hometale` 目录初始化(`ensureHometaleStructure`)
- [x] 角色与 Session 系统
- [x] 记忆系统(读写、隐私过滤、LLM 总结、`.summary-state.json` 增量)
- [x] SQLite 消息存储(替代原 `conv-*.md` 设计)
- [x] 主 Agent + 工具系统(file-tools / permissions / safety-checks)
- [x] Skills 系统(注册、渐进式披露、内置 + 自定义 executor)
- [x] Express API + WebSocket
- [x] React Web UI
- [x] 微信 ilink 协议接入
- [x] 动态 Subagent 工厂（支持多agent协同和子agent创建）
- [x] 权限系统
- [ ] 错误恢复
- [ ] Hook系统
- [ ] 后台任务和定时调度
- [ ] mcp和插件