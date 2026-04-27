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
