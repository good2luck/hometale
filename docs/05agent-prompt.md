# Agent 系统提示词设计

本文档说明 HomeTale 中 Agent 的系统提示词设计原则和实现方案。

## 设计原则

### 1. 模块化构建

系统提示词不应是一个巨大的硬编码字符串，而应该采用模块化的方式构建，每个部分负责单一职责。

**优点：**
- 可维护性：每个部分独立修改，互不干扰
- 可测试性：可以单独测试每个部分的输出
- 可扩展性：易于添加新的提示词部分

### 2. 静态/动态分离

将系统提示词分为**静态部分**和**动态部分**，用明确的边界分隔。

```typescript
const DYNAMIC_BOUNDARY = "=== DYNAMIC_BOUNDARY ===";
```

**静态部分**（可缓存）：
- 核心指令
- 工具列表说明
- Skill 元数据
- 全局配置 (`AGENTS.md`)
- 操作指南

**动态部分**（每轮重建）：
- 角色信息
- 家庭记忆
- 当前会话相关信息

### 3. Per-turn Reminder

短命上下文（如会话 ID、临时状态）不应混入系统提示词，而应作为独立的用户消息注入：

```typescript
buildReminder(extra?: string): ReminderMessage | null {
  if (!extra) return null;
  return {
    role: 'user',
    content: `<system-reminder>\n${extra}\n</system-reminder>`
  };
}
```

### 4. CLAUDE.md 链式加载

按优先级加载多层 CLAUDE.md：

1. 用户全局：`~/.claude/CLAUDE.md`
2. 项目根：`./CLAUDE.md`
3. 子目录：`./subdir/CLAUDE.md`（可选）

每层的内容都标注来源，便于调试：

```markdown
# CLAUDE.md instructions

## From user global (~/.claude/CLAUDE.md)
[用户全局配置]

## From project root (CLAUDE.md)
[项目配置]
```

## SystemPromptBuilder 实现

### 类结构

```typescript
class SystemPromptBuilder {
  constructor(options: SystemPromptBuilderOptions);

  build(role?: Role | null, familyMemories?: string): string;
  buildReminder(extra?: string): ReminderMessage | null;

  // 可选：静态缓存支持
  getStaticPrefix(): string;
  buildDynamicSuffix(role?: Role | null, familyMemories?: string): string;
}
```

### 部分列表

| 部分 | 方法 | 静态/动态 | 说明 |
|------|------|-----------|------|
| 核心指令 | `buildCore()` | 静态 | Agent 基本角色定位 |
| Skills 元数据 | `buildSkillListing()` | 静态 | 已披露的技能列表 |
| AGENTS.md | `buildAgentsMd()` | 静态 | 全局配置 |
| CLAUDE.md 链 | `buildClaudeMdChain()` | 静态 | 配置链 |
| 操作指南 | `buildOperatingGuide()` | 静态 | 工具使用说明 |
| 角色信息 | `buildDynamicContext()` | 动态 | 当前角色 |
| 家庭记忆 | `buildDynamicContext()` | 动态 | 记忆摘要 |

### 完整输出示例

```
你是 HomeTale（家的故事）智能体，一个贴心的家庭助手。

请用温馨、简单、明了的方式回答问题，像和家人聊天一样。

你的主要职责：
1. 记录家人的日常对话和重要信息
2. 对信息进行分层总结（对话明细 → 每日总结 → 长期记忆）
3. 根据记忆内容回答用户的问题，提供情感关怀

# Available skills
- get_current_time (get_current_time): 获取当前时间
- record_to_memory (record_to_memory): 记录内容到长期记忆
- summarize_memory (summarize_memory): 总结对话并更新记忆
- search_memory (search_memory): 搜索记忆
- calculate (calculate): 计算数学表达式
- compact (compact): 手动触发上下文压缩
- load_skill (load_skill): 加载 Skill 的详细说明

需要了解某个 Skill 的详细使用方法时，请调用 load_skill 工具。

# HomeTale - 家的故事 - 全局上下文
[AGENTS.md 内容]

# CLAUDE.md instructions
## From project root (CLAUDE.md)
[CLAUDE.md 内容]

=== 操作指南 ===

1. 如果需要使用工具，请直接调用相应的工具函数。
2. 如果可以直接回答用户的问题，请直接用自然语言回答。
3. 【重要】如果调用工具失败（返回 [ERROR] 开头的结果），必须在回复中明确告知用户：
   - 说明哪个工具调用失败了
   - 说明失败的原因
   - 告诉用户这可能会影响记忆保存等功能

4. 之前的对话和工具执行结果都已在上下文中。

=== DYNAMIC_BOUNDARY ===

=== 你的角色 ===
爸爸（👨）。你是这个家庭的智能助手。

=== 家庭记忆 ===
[记忆内容]
```

## 使用方式

### 在 Agent Loop 中

```typescript
async function* runFamilyAgentStream(
  config: ModelConfig,
  roleId: string,
  userMessage: string,
  _history: ChatMessage[] = [],
  sessionId?: string
) {
  // 1. 初始化
  await initSkillRegistry();
  setCurrentRoleId(roleId);

  // 2. 加载角色和记忆
  const role = await getRole(roleId);
  const familyMemories = await getMemoryForAgent(roleId);

  // 3. 加载历史消息
  let messages: ChatMessage[] = [];
  if (sessionId) {
    const dbMessages = getContextMessages(sessionId, {
      baseLimit: 20,
      expandCompressed: false
    });
    messages = dbMessages.map(m => ({
      role: m.role,
      content: m.content
    }));
  }

  // 4. 添加当前用户消息
  messages.push({ role: 'user', content: userMessage });

  // 5. Progressive Disclosure
  let disclosedSkillIds: string[] | undefined;
  if (sessionId) {
    const disclosure = getDisclosureManager(sessionId);
    const disclosedSkills = disclosure.getDisclosedSkills(userMessage);
    disclosedSkillIds = disclosedSkills.map(s => s.id);
  }

  // 6. 创建工具集
  const tools = createToolSet(roleId, disclosedSkillIds);

  // 7. 构建系统提示词
  const promptBuilder = new SystemPromptBuilder({
    workdir: process.cwd(),
    disclosedSkillIds
  });

  const fullSystemPrompt = promptBuilder.build(role, familyMemories);

  // 8. 添加 per-turn reminder（如果有）
  const reminder = promptBuilder.buildReminder(
    sessionId ? `Session ID: ${sessionId}` : undefined
  );
  if (reminder) {
    messages.unshift(reminder);
  }

  // 9. 运行 Agent
  const result = streamText({
    model: createModel(config),
    system: fullSystemPrompt,
    messages: messages as any,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  });

  // 10. 处理输出...
}
```

## 优化空间

### 1. 静态前缀缓存

由于静态部分在同一会话中不会变化，可以缓存起来：

```typescript
private cachedStaticPrefix: string | null = null;

getStaticPrefix(): string {
  if (!this.cachedStaticPrefix) {
    const sections: string[] = [];

    const core = this.buildCore();
    if (core) sections.push(core);

    const skills = this.buildSkillListing();
    if (skills) sections.push(skills);

    const agentsMd = this.buildAgentsMd();
    if (agentsMd) sections.push(agentsMd);

    const claudeMd = this.buildClaudeMdChain();
    if (claudeMd) sections.push(claudeMd);

    sections.push(this.buildOperatingGuide());
    sections.push(SystemPromptBuilder.DYNAMIC_BOUNDARY);

    this.cachedStaticPrefix = sections.join('\n\n');
  }

  return this.cachedStaticPrefix;
}

buildDynamicSuffix(role?: Role | null, familyMemories?: string): string {
  return this.buildDynamicContext(role, familyMemories);
}
```

### 2. 部分懒加载

某些部分（如 `CLAUDE.md` 链）可以按需加载，避免不必要的文件 I/O。

### 3. 提示词版本管理

可以为不同的场景维护不同的提示词变体（如调试模式、精简模式等）。

## 参考设计

本设计参考了以下项目：

- **s10** (learn-claude-code): 模块化系统提示词构建器的原始设计
- **Claude Code**: `CLAUDE.md` 链式加载机制

---

# 通用 Agent Harness 设计思路

## 设计哲学

Prompt 不是一段固定字符串，而是一套**分层拼装、可缓存、可覆盖、可观测**的 prompt runtime。

关键洞察：
- 真正发给模型的 system prompt 不是来自一个文件，而是多个来源的运行时装配
- 常驻规则、会话上下文、专项任务说明必须分开治理
- Prompt 不仅服务于主 Agent，还服务于压缩、记忆提取等后台子任务
- Prompt 缓存是一级工程问题，不是可选优化

---

## 一、六层 Prompt 架构

```
Layer 1: 默认主系统提示
  定义 Agent 身份、规则、工具使用方式、会话级策略

Layer 2: 有效 System Prompt 组装器
  处理优先级覆盖：override > coordinator > agent > custom > default

Layer 3: 运行时上下文注入
  CLAUDE.md、日期、git status、cache breaker

Layer 4: 启动期附加指令入口
  CLI 参数、环境变量、模式 addendum

Layer 5: Prompt 缓存与失效管理
  section cache、dynamic boundary、cache break

Layer 6: 专项 Prompt 家族
  compact / session memory / extract memories / hooks 等
```

管理的不是"prompt 文本"，而是：
- 哪些 prompt 属于主循环，哪些属于子任务
- 哪些内容要长期缓存，哪些必须逐轮重算
- 哪些内容允许外部覆盖，哪些可以被导出和审计

---

## 二、System Prompt 的 Section 化

### 2.1 返回字符串数组，而非单个字符串

```typescript
function getSystemPrompt(tools, model, ...): Promise<string[]>
```

设计意图：
- 每个 section 可以单独缓存、单独插拔、单独统计 token
- 后续能在 section 级别做 cache boundary 和动态失效

### 2.2 静态主干 + 动态边界 + 动态段

```
[静态段: 身份 + 规则 + 工具说明 + 语气]
  │
  ├─ getSimpleIntroSection()     — 身份
  ├─ getSimpleSystemSection()    — 基础规则
  ├─ getDoingTasksSection()      — 工作规则
  ├─ getActionsSection()         — 行为约束
  ├─ getUsingYourToolsSection()  — 工具使用
  ├─ getToneAndStyleSection()    — 语气风格
  ├─ getOutputEfficiencySection()— 输出效率
  │
  ▼
[DYNAMIC_BOUNDARY] — 缓存分界线
  │
  ▼
[动态段: session_guidance / memory / env / language / mcp / ...]
  │
  └─ 这些 section 依赖运行态：当前工具集、设置、模型、外部服务
```

**Harness 意义**：不是只在"内容层面"写 prompt，而是在"缓存层面"设计 prompt。boundary 之前尽可能稳定，boundary 之后允许 session 级变化。

---

## 三、覆盖优先级：五种来源的合成

### 3.1 优先级链

```
0. Override — 完全替换，不保留任何默认内容
   │
1. Coordinator — 协调者模式专用
   │
2. Agent — Agent 定义自带的 prompt
   │
3. Custom — 用户自定义 prompt
   │
4. Default — 系统默认 prompt
   │
└─ Plus: Append — 始终追加到最后
```

### 3.2 关键区分

| 操作 | 效果 | 用途 |
|------|------|------|
| Override | **完全替代**默认 prompt | 彻底的角色切换 |
| Custom | **替代**默认 prompt | 用户自定义身份 |
| Agent | 普通模式下**替代**默认 prompt；Proactive 模式下**追加**到默认 prompt 后 | 不同模式不同行为 |
| Append | 始终**追加**到最后 | 补充规则，不改变主体 |

**设计原则**：
- "覆写"和"加尾注"是两种完全不同的控制力度，工程上必须严格区分
- Append 是一条**追加指令总线**，不仅用于用户手动加一句，还承载模式 addendum、teammate 指令等

---

## 四、主 Prompt 之外的上下文注入

### 4.1 User Context：用户级

```
getUserContext() →
  ├─ CLAUDE.md — 运行时扫描、读取、拼接，非硬编码
  └─ currentDate — 独立字段，非模板文本
```

### 4.2 System Context：系统级

```
getSystemContext() →
  ├─ gitStatus — "环境前情摘要"，给 Agent 的当前状态快照
  └─ cacheBreaker — 缓存失效控制
```

### 4.3 与 System Prompt 的区别

| 维度 | System Prompt | User/System Context |
|------|---------------|---------------------|
| 性质 | Agent 身份与规则 | 本轮推理必须知道的上下文 |
| 来源 | 模板 + 覆盖 | 运行时动态获取 |
| 缓存 | 可缓存 | 通常不缓存或短生命周期 |
| 写入方式 | `system` 角色 | `system` 或 `user` 角色 |

**关键结论**：研究 Agent 的 prompt 不能只看 system prompt 模板，还必须把 context 注入算进去。

---

## 五、Prompt 缓存工程

### 5.1 Section 级缓存

```typescript
// 可缓存 section
systemPromptSection('memory', computeFn)
  → { name, compute, cacheBreak: false }

// 显式声明打断缓存的 section
DANGEROUS_uncachedSystemPromptSection('mcp_instructions', computeFn, 'reason')
  → { name, compute, cacheBreak: true }
```

**默认缓存，显式打断**：这是一种 prompt cache discipline。如果要让某段 prompt 每轮重算，必须显式声明"这是危险操作"。

### 5.2 缓存解析逻辑

```
resolveSystemPromptSections(sections)
  │
  ├─ 遍历每个 section
  │   ├─ cacheBreak=false 且 cache 命中 → 返回缓存值
  │   └─ 否则 → 执行 compute()，写入缓存
  │
  └─ Promise.all 并行解析
```

缓存的是**section 结果**，不是整个大 prompt 字符串。

### 5.3 缓存失效时机

与"会话生命周期事件"绑定：

| 事件 | 触发缓存清除 |
|------|-------------|
| `/clear` 清空对话 | 是 |
| `/compact` 压缩对话 | 是 |
| 切换 worktree | 是 |
| resume / restore session | 是 |

**Harness 意义**：Prompt cache 不是永久缓存，而是 session 级的。它与对话生命周期事件对齐，而非时间过期。

---

## 六、专项 Prompt：后台任务也有自己的协议

### 6.1 主 Prompt vs 专项 Prompt

| 维度 | 主会话 Prompt | 专项 Prompt |
|------|--------------|-------------|
| 目的 | 定义长期身份 | 单次任务强力约束 |
| 工具 | 全部可用 | 严格限制 |
| 轮次 | 多轮 | 单轮或有限轮次 |
| 输出格式 | 开放 | 严格结构化 |

### 6.2 专项 Prompt 的共同特征

**压缩 Prompt**：
```
CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.
- 禁止工具
- 限制格式 (<analysis> + <summary>)
- 限制轮次（只有一次机会）
```

**记忆更新 Prompt**：
```
Your ONLY task is to use the Edit tool to update the notes file, then stop.
Do not call any other tools.
- 禁止修改 section headers
- 禁止修改描述行
- 只更新内容区
```

**记忆提取 Prompt**：
```
- 可用工具仅限：Read / Grep / Glob / 只读 Bash / Edit / Write
- 禁止 MCP、Agent、可写 Bash
- 先并行读，再并行写
- 只用最近若干消息
```

**Harness 意义**：后台子任务的 prompt 不是"自由发挥"，而是被写成一套**轻量协议**。这种协议化约束保证了子任务不会跑偏、不会产生副作用、不会浪费 token。

---

## 七、可观测性：Prompt 是可审计的

### 7.1 请求级导出

```
拦截 API 请求 → 落盘到 JSONL
  ├─ init data
  ├─ system update
  ├─ user messages
  └─ responses
```

### 7.2 Section 级 Token 分析

```
effectiveSystemPrompt
  │
  ├─ 拆成 named entries
  │
  └─ 逐段算 token
      ├─ 哪一段最贵？
      ├─ 哪些段应该继续缓存？
      └─ 总成本是否可控？
```

**设计原则**：不仅关心 prompt 对不对，还关心 prompt 吃了多少 token。这是"运营侧视角"，是 prompt 工程成熟度的标志。

---

## 八、不同路径下的 Prompt 重建

同一个 Agent 系统在不同场景下需要重建出一致的 prompt 前缀：

| 场景 | Prompt 来源 |
|------|------------|
| 主 REPL 交互 | `getSystemPrompt()` + `getUserContext()` + `getSystemContext()` → `buildEffectiveSystemPrompt()` |
| 压缩任务 | 重新计算一份适合共享 cache key 的 prompt 前缀 |
| Side Question | `fetchSystemPromptParts()` 尽量重建与主会话一致的前缀 |
| SDK Resume | 同上 |
| Subagent | 继承主会话的 `renderedSystemPrompt` |

**Harness 意义**：Prompt 构造逻辑必须被抽到共享 helper，不能散落在各个入口。它是 query infrastructure 的一部分，不是 UI 层逻辑。

---

## 九、机制设计特点总结

| 特性 | 实现方式 | Harness 意义 |
|------|----------|-------------|
| Section 化 | 返回字符串数组，每个 section 独立管理 | 单独缓存、插拔、统计 token |
| 静态/动态分离 | DYNAMIC_BOUNDARY 分界 | 缓存前缀最大化，动态部分按需重算 |
| 优先级覆盖 | 5 级来源 + append 总线 | 覆写与追加严格区分，控制力度精确 |
| 运行时上下文 | User Context + System Context 独立于 System Prompt | 身份与状态解耦 |
| Section 级缓存 | 默认缓存，显式打断 | Cache discipline，减少无效重算 |
| 缓存与生命周期绑定 | clear/compact/worktree 切换时失效 | 缓存策略与会话语义对齐 |
| 专项 Prompt 协议 | 后台任务用独立 prompt，强力约束 | 子任务不跑偏、无副作用 |
| 可观测性 | 请求导出 + Section token 分析 | Prompt 成本可控、可审计 |
| Prompt 重建 | 共享 helper 保证多路径一致性 | Subagent/Compact/SideQuestion 行为一致 |
