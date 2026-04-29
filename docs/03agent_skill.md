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

---

# 通用 Agent Harness 设计思路

## 设计哲学

Skill 机制的核心命题是：**如何以低门槛方式为 Agent 注入领域能力，同时保证安全边界和运行时可控性。**

关键洞察：
- Skill 不是代码插件，而是**结构化知识 + 可选执行逻辑**的组合
- 知识注入应按需加载，而非全量塞入上下文
- 不同来源的 Skill 具有不同信任等级，安全策略必须分级

---

## 一、多来源发现与优先级合并

### 1.1 三种来源

| 来源 | 信任等级 | 典型路径 | 特点 |
|------|----------|----------|------|
| **策略级** | 最高 | 管理员统一配置 | 组织级强制技能 |
| **用户级** | 高 | `~/.config/agent/skills/` | 用户个人偏好 |
| **项目级** | 中 | `.agent/skills/` | 项目特定工作流 |
| **协议映射** | 低 | 外部 MCP/Plugin Server | 远程动态能力 |

### 1.2 发现策略

```
并行扫描所有来源目录
  │
  ▼ Promise.all 并发
  │
  ├─ 策略级目录
  ├─ 用户级目录
  ├─ 项目级目录（向上爬取至根目录）
  └─ 扩展目录（--add-dir 显式指定）
  │
  ▼
合并 + 去重（inode 级别，防止软链接重复加载）
  │
  ▼
统一为 Command 对象
```

**关键设计**：
- `memoize` 包裹发现函数，同一工作目录只扫描一次
- `fs.realpath` 取 inode 真实路径去重，防止软链接导致重复加载
- 内置技能优先级高于扩展技能，同名覆盖时内置优先

---

## 二、Frontmatter 元数据：技能的声明式协议

每个 Skill 的 YAML 前置数据不仅是描述，更是**声明式运行时协议**：

```yaml
---
name: git-workflow
description: Git 工作流辅助
when_to_use: 当用户需要提交代码、创建分支、解决冲突时
allowed_tools: [bash, read_file, edit_file]  # 限制技能可使用的工具
model: sonnet         # 绑定特定模型
effort: high          # 任务估时级别
user_invocable: true  # 是否出现在用户命令列表
paths:                # 条件技能：文件变更时自动激活
  - "src/**/*.ts"
  - "*.test.*"
context: inline       # inline | fork（上下文注入方式）
---
```

### 关键字段解读

| 字段 | 作用 | Harness 意义 |
|------|------|-------------|
| `paths` | 条件触发路径 | 精准激活，避免认知过载 |
| `allowed_tools` | 工具白名单 | 最小权限原则，限制技能可调用的工具 |
| `user_invocable` | 可见性控制 | `false` = 仅供模型内部调用，不暴露给用户 |
| `context` | 注入方式 | `inline` 在当前对话流注入，`fork` 在隔离上下文执行 |
| `model` | 模型绑定 | 不同技能可绑定不同能力的模型（成本优化） |

---

## 三、Prompt 内嵌 Shell 执行：实时上下文注入

### 3.1 机制

Markdown 内容中可嵌入 Shell 命令，在技能被调用前先在宿主机执行，输出结果替换回正文：

```markdown
当前分支信息：
!`git log --oneline -5`

未提交的变更：
!`git status --short`

请根据以上信息帮我分析当前代码状态。
```

支持两种语法：
- **内联**：`` !`command` `` — 单行输出
- **代码块**：`` ```!\ncommand\n``` `` — 多行输出

### 3.2 安全切断

```
技能来源判断
  │
  ├─ 本地文件系统 / 内置 ──→ 允许执行 Shell（受信任）
  │                           │
  │                           └─ 走统一权限系统检查
  │
  └─ 外部协议映射 (MCP/Plugin) ──→ 跳过 Shell 执行（不信任）
                                     │
                                     └─ 直接返回原始 Markdown
```

**这是最关键的安全边界**：来自远程服务器的技能不执行内嵌 Shell，防止恶意远程注入 RCE 攻击。所有命令执行前都走 `hasPermissionsToUseTool`，遵从同一套权限体系。

### 3.3 Harness 意义

这一机制让 Skill Prompt 携带**实时系统状态**，而非静态文本。模型获取的上下文是调用时刻的真实快照，而非编写时的陈旧信息。

---

## 四、条件技能：文件变更驱动的自动激活

`paths` 字段声明了 glob pattern，当用户操作匹配的文件时，技能自动激活并注入上下文：

```
用户编辑 src/auth/login.ts
  │
  ▼ 匹配 paths: ["src/**/*.ts"]
  │
  ▼ 自动激活 "typescript-best-practices" 技能
  │
  ▼ 技能内容注入模型上下文
  │
  ▼ 模型在后续生成中自动遵循该技能的规范
```

**设计要点**：
- 不是所有 Skill 都需要条件触发，只有声明了 `paths` 的才是条件技能
- 这是一种**精准触发的 Hook 订阅模式**，避免无关技能污染上下文
- 条件激活与两层加载可以叠加：条件触发后仍按需加载 body

---

## 五、两层加载 + ProgressiveDisclosure：三级上下文控制

```
Level 0: 不激活
  │  技能完全不可见，不注册工具，不占 token
  │
  ▼ 条件触发 / 用户调用
  │
Level 1: 名称+描述（System Prompt，~100 token/skill）
  │  模型知道技能存在，可以选择调用
  │
  ▼ 模型调用 load_skill
  │
Level 2: 完整 body（tool_result，~2000 token/skill）
  │  模型获取详细工作流、参数指南、注意事项
  │
  ▼ 模型调用具体 Skill 工具
  │
Level 3: 执行（skill.execute()）
   真正产生副作用
```

### 为什么需要三级

| 级别 | Token 成本 | 模型决策 | 适用场景 |
|------|-----------|---------|---------|
| Level 0 | 0 | 无 | 与当前任务无关 |
| Level 1 | ~100/skill | "我知道有这个能力" | 列出可选项 |
| Level 2 | ~2000/skill | "我知道具体怎么做" | 执行前获取指南 |
| Level 3 | 视业务而定 | "我开始行动" | 产生实际效果 |

10 个 Skill 的成本对比：
- **全量 Level 2**：20,000 token/轮，大部分无用
- **三级控制**：~1,000 (L1) + 按需 2-3 个 L2 = ~7,000 token

---

## 六、执行器分层：内置 vs 自定义

```
技能执行器
  │
  ├─ 内置 Executor（代码中硬编码）
  │   ├── 安全：经过审计，无动态 import 风险
  │   ├── 性能：无文件系统 I/O 开销
  │   └── 典型：get_current_time, calculate, load_skill
  │
  └─ 自定义 Executor（executor.js 动态 import）
      ├── 灵活：用户可扩展任意逻辑
      ├── 风险：未审计代码，需沙箱隔离
      └── 典型：领域特定 API 调用、复杂工作流
```

**优先级**：内置 > 自定义。内置技能不需要文件系统上的 `executor.js`，减少 I/O 和攻击面。

`load_skill` 作为**元工具**始终注册，不受白名单过滤——它是两级加载的入口，必须永远可用。

---

## 七、Session 级状态管理

Skill 披露状态是 session 级的：

```
Session 开始
  │
  ▼ 创建 ProgressiveDisclosure 实例
  │
  ▼ 用户消息 → 关键词匹配 → 披露相关 Skill
  │
  ▼ 已披露的 Skill 不会"收回"（单调递增）
  │
  ▼ Session 结束 → 清理实例，防止内存泄漏
```

**设计原则**：
- 披露是单调递增的：已暴露的技能不再收回，避免模型上下文断裂
- 状态绑定到 session 而非全局：不同会话独立计算
- 必须有清理机制：`cleanupDisclosureManager(sessionId)` 防止长期运行的进程泄漏

---

## 八、机制设计特点总结

| 特性 | 实现方式 | Harness 意义 |
|------|----------|-------------|
| 低门槛扩展 | Markdown + YAML + 可选 Shell | 非程序员也能创建技能 |
| 实时系统上下文 | Prompt 内嵌 Shell 执行 | 技能携带调用时刻的真实状态 |
| 条件精准触发 | `paths` 字段订阅文件变更 | 避免无关技能污染上下文 |
| 三级上下文控制 | L0 不激活 → L1 描述 → L2 完整内容 | Token 成本随需增长 |
| 安全隔离 | 远程来源跳过 Shell，统一权限体系 | 防止 RCE 和权限逃逸 |
| 统一协议 | 所有来源最终归约为 Command 对象 | 内置/扩展/远程技能平级消费 |
| 最小权限 | `allowed_tools` 限制技能可调用工具 | 技能只能使用声明的工具 |
| Session 作用域 | 披露状态随 Session 生灭 | 隔离性 + 无泄漏 |
