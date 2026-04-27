# Agent Skill 两层加载机制

## 借鉴来源

`s05_skill_loading.py`（Anthropic 学习项目示例）的核心洞察：

> *"用到什么知识，临时加载什么知识"* — 通过 tool_result 注入，不塞 system prompt。

```python
# 核心设计：22 行关键代码
class SkillLoader:
    def get_descriptions(self) -> str:
        """Layer 1: skill 名称+描述 → 写入 system prompt"""
        for name, skill in self.skills.items():
            lines.append(f"  - {name}: {skill['meta']['description']}")
        return "\n".join(lines)

    def get_content(self, name: str) -> str:
        """Layer 2: 完整 body → 通过 tool_result 注入"""
        return f"<skill name=\"{name}\">\n{skill['body']}\n</skill>"
```

模型看到 skill 列表（便宜），需要时调用 `load_skill("git")` 获取完整内容（贵），通过 tool_result 注入上下文。不是把所有知识都塞进 system prompt，而是按需加载。

## 改造前的 HomeTale 现状

| 维度 | 改造前 | 问题 |
|------|--------|------|
| System Prompt | 所有 skill 的 name+description | 合理，但缺少"可以 load 详情"的提示 |
| Tool 注册 | 全部 skill 都注册为 tools | 5 个无感，20+ 时 tool schema token 成本高 |
| SKILL.md body | 从未注入 LLM 上下文 | body 只是给人看的文档，模型看不到 |
| ProgressiveDisclosure | 代码已写好，但 Agent 循环未调用 | 有基础设施但没接线 |

HomeTale 已具备 80% 的基础设施（frontmatter 解析、ProgressiveDisclosure 类、disclosure 元数据），唯一缺的是把它们接入 Agent 循环。

## 改造点

### 1. `loadSkill()` 保留 body（`server/src/skills/loader.ts`）

```ts
// 改造前：body 被丢弃
const { frontmatter } = parseYamlFrontmatter(skillMdContent);

// 改造后：保留 body
const { frontmatter, body } = parseYamlFrontmatter(skillMdContent);
// ...
const skill: LoadedSkill = {
  // ...
  body: body.trim() || undefined,  // SKILL.md --- 之后的 markdown 内容
};
```

`LoadedSkill` 类型新增 `body?: string` 字段（`server/src/skills/types.ts`）。

### 2. 新增 `load_skill` 内置工具（`server/src/skills/loader.ts`）

```ts
const BUILTIN_EXECUTORS = {
  // ... 原有 5 个 executor ...

  // 新增：两层加载的元工具
  load_skill: async (params: any) => {
    const skillId = params.skill_id;
    const skill = await loadSkill(skillId);
    if (!skill) {
      const available = listSkillIds();
      return `Error: 未找到 Skill '${skillId}'。可用的 Skills: ${available.join(', ')}`;
    }
    const body = skill.body || '(无详细使用说明)';
    return `<skill name="${skillId}">\n${body}\n</skill>`;
  }
};
```

模型调用 `load_skill` → executor 从文件系统读取 SKILL.md body → 以 `<skill>` 标签格式返回到 tool_result → 模型在后续生成中即可引用这些知识。

### 3. 激活 ProgressiveDisclosure（`server/src/agents/family-agent.ts`）

```ts
// 改造前：所有 skill 都注册
const tools = createToolSet(roleId);

// 改造后：按用户消息筛选已披露的 skills
let disclosedSkillIds: string[] | undefined;
if (sessionId) {
  const disclosure = getDisclosureManager(sessionId);
  const disclosedSkills = disclosure.getDisclosedSkills(userMessage);
  disclosedSkillIds = disclosedSkills.map(s => s.id);
}
const tools = createToolSet(roleId, disclosedSkillIds);
```

`createToolSet` 改为接受可选白名单（`server/src/agent-core/tools/index.ts`）：

```ts
// load_skill 始终注册（元工具）；其他 skill 按白名单过滤
if (skillId !== 'load_skill' && disclosedSkillIds && !disclosedSkillIds.includes(skillId)) {
  continue;
}
```

### 4. System Prompt 增加提示（`server/src/agents/context-loader.ts`）

```ts
// 改造前
skillsSummary = context.skillsFrontmatter
  .map(skill => `- ${skill.name} (${skill.id}): ${skill.description}`)
  .join('\n');

// 改造后：增加 load_skill 使用提示
skillsSummary += '\n\n需要了解某个 Skill 的详细使用方法时，请调用 load_skill 工具。';
```

### 5. Session 生命周期清理（`server/src/websocket/server.ts`）

```ts
ws.on('close', () => {
  if (session.sessionId) {
    cleanupDisclosureManager(session.sessionId);
  }
  this.sessions.delete(session.id);
});
```

## 通用 Agent 的 Skill 处理机制

以上改造提炼为通用模式，适用于任何 Agent 项目：

### 两层加载模式

```
System Prompt (Layer 1 — always present, cheap):
+------------------------------------------+
| You are a [domain] agent.                |
| Skills available:                        |
|   - git: Git workflow helpers            |  ~100 tokens/skill
|   - pdf: Process PDF files              |
|   - code-review: Review code            |
+------------------------------------------+

When model calls load_skill("git"):
+------------------------------------------+
| tool_result (Layer 2 — on demand, costly):|
| <skill name="git">                       |
|   Full git workflow instructions...      |  ~2000 tokens
|   Step 1: ...                            |
|   Step 2: ...                            |
| </skill>                                 |
+------------------------------------------+
```

### 为什么不全塞 System Prompt

假设 10 个 Skill，每个 2000 token body：
- **全塞 system prompt**：20,000 token，大部分跟当前任务无关
- **两层加载**：~1,000 token（描述列表）+ 按需加载 1-2 个 = ~5,000 token

当前 5 个 Skill 时差异不大，但随着 Skill 数量增长，两层加载的 token 节省是线性的。

### ProgressiveDisclosure：按需暴露 Tool

不是所有 Skill 都需要在每轮对话中可用。根据用户消息关键词筛选：

```ts
// 渐进式披露：只暴露与当前消息相关的 Skill
class ProgressiveDisclosure {
  getDisclosedSkills(userMessage?: string): LoadedSkill[] {
    // 关键词匹配
    const hasKeywordMatch = skill.disclosure.keywords.some(kw =>
      lowerMessage.includes(kw.toLowerCase())
    );
    // 触发词匹配
    const hasTriggerMatch = skill.disclosure.triggers.some(t =>
      lowerMessage.includes(t.toLowerCase())
    );
    return hasKeywordMatch || hasTriggerMatch;
  }
}
```

这减少了模型需要考虑的工具数量，提高选择准确率。

### Skill 文件结构（SKILL.md + tool.json）

```
skills/
  search_memory/
    SKILL.md       # YAML frontmatter (metadata) + markdown body (knowledge)
    tool.json      # OpenAI function schema (name, description, inputSchema)
    executor.js    # 可选：自定义执行器（内置 skill 不需要）
```

**frontmatter = Layer 1 的数据源**（name, description, keywords, triggers）
**body = Layer 2 的数据源**（详细工作流、参数指南、注意事项）
**tool.json = 工具注册的 schema**（模型调用时的参数定义）

三层数据各司其职，互不冗余。

### 内置 vs 自定义 Executor

```
BUILTIN_EXECUTORS = {        ← 内置：安全、已审计、性能好
  get_current_time,
  calculate,
  search_memory,
  load_skill,                ← 元工具，始终可用
}

自定义 Skill → executor.js   ← 动态 import，用户扩展用
```

优先级：内置 executor > 外部 executor.js。内置 skill 不需要文件系统上的 executor.js，减少 I/O。

### Session 级状态管理

ProgressiveDisclosure 是 session 级的——同一个 session 内，已经披露的 Skill 不会被"收回"：

```ts
const disclosureManagers: Map<string, ProgressiveDisclosure> = new Map();

// 按 sessionId 获取或创建
function getDisclosureManager(sessionId: string): ProgressiveDisclosure

// session 结束时清理，防止内存泄漏
function cleanupDisclosureManager(sessionId: string)
```

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `server/src/skills/types.ts` | `LoadedSkill` 新增 `body?: string` |
| `server/src/skills/loader.ts` | `loadSkill()` 保留 body；新增 `load_skill` executor |
| `server/src/skills/defaults/load_skill/` | 新建 SKILL.md + tool.json |
| `server/src/skills/initializer.ts` | 注册 load_skill 默认 Skill |
| `server/src/agent-core/tools/index.ts` | `createToolSet` 支持 skill 白名单过滤 |
| `server/src/agents/family-agent.ts` | 接入 ProgressiveDisclosure，传 sessionId |
| `server/src/agents/context-loader.ts` | system prompt 增加 load_skill 提示 |
| `server/src/websocket/server.ts` | session 关闭时清理 disclosure |
| `server/src/skills/defaults/*/SKILL.md` | 丰富 body 内容（5 个文件） |

## 参考

- `s05_skill_loading.py` — Anthropic SDK 两层 Skill 加载示例
- `server/src/skills/discovery.ts` — ProgressiveDisclosure 实现
- `server/src/skills/loader.ts` — Skill 加载、BUILTIN_EXECUTORS、YAML 解析
