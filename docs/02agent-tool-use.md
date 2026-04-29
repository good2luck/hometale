# Agent Tool Use 设计与实现

## 借鉴来源

`s02_tool_use.py`（Anthropic 学习项目示例）提供了一个极简但完整的 Agent 工具实现：

```python
# 核心设计：Dispatch Map + 统一处理
TOOL_HANDLERS = {
    "bash":       lambda **kw: run_bash(kw["command"]),
    "read_file":  lambda **kw: run_read(kw["path"], kw.get("limit")),
    ...
}
```

其 Agent Loop 只做三件事：Call LLM → Dispatch Tool → Append Result。没有业务逻辑混杂，清晰展示了"工具不决定 loop，loop 不依赖工具"的解耦设计。

## 借鉴到 HomeTale 的核心设计

### 1. 输出截断 — 防止 Token 爆炸

**s02 的做法**：所有输出统一截断到 50KB
```python
def run_read(path, limit=None):
    text = safe_path(path).read_text()
    lines = text.splitlines()
    if limit and limit < len(lines):
        lines = lines[:limit] + [f"... ({len(lines) - limit} more lines)"]
    return "\n".join(lines)[:50000]
```

**HomeTale 的实现** (`server/src/lib/fs-utils.ts`)：
- `readTextFile(path, { maxLines?, maxChars? })` — 双维度截断，先按行后按字符
- `searchFiles(pattern, path, limit?)` — 匹配结果数限制，默认 50 条
- 截断时附带 `... (N more lines/chars)` 提示，模型可感知内容被截断

**为什么重要**：LLM 上下文窗口有限，Agent 读取大文件或搜索宽泛关键词时，不截断的输出会直接撑爆上下文，导致后续对话无法进行。

### 2. 危险操作兜底 — 独立于权限的黑名单

**s02 的做法**：简单字符串黑名单
```python
dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"]
if any(d in command for d in dangerous):
    return "Error: Dangerous command blocked"
```

**HomeTale 的实现** (`server/src/agent-core/tools/safety-checks.ts`)：
- 扩展黑名单覆盖更多场景：`mkfs`、`dd if=`、fork bomb、curl|sh 管道等
- 独立于权限系统运行，作为命令执行工具的最后一道防线
- 即使权限系统配置错误或被绕过，危险命令仍会被拦截

### 3. Bash 执行能力 — 扩展 Agent 可操作性

**s02 的做法**：基础 `subprocess.run`，120s 超时
```python
r = subprocess.run(command, shell=True, cwd=WORKDIR,
                   capture_output=True, text=True, timeout=120)
```

**HomeTale 的实现** (`server/src/agent-core/tools/file-tools.ts` `run_bash`)：
- 继承所有安全机制：权限检查 + 危险命令黑名单 + 路径沙箱验证
- 默认 120s 超时，可自定义
- 输出截断到 50000 字符
- `maxBuffer: 1MB` 防止内存爆炸

## HomeTale 工具系统架构

### 分层设计

```
ToolSet (AI SDK v5)
├── 文件工具 (内置) — server/src/agent-core/tools/file-tools.ts
│   ├── read_file    — 读取文件（支持行数限制）
│   ├── write_file   — 写入文件
│   ├── edit_file    — 精确替换
│   ├── delete_file  — 删除文件
│   ├── list_dir     — 列出目录
│   ├── search_files — 搜索内容（支持结果限制）
│   └── run_bash     — 执行命令（带安全控制）
│
└── Skill 工具 (动态) — server/src/skills/
    └── 通过 SkillRegistry 注册，运行时自动加载
```

### 安全机制

安全由三层防线构成，每层独立生效：

| 防线 | 机制 | 文件 | 作用 |
|------|------|------|------|
| 第一层 | 路径沙箱 | `permissions.ts` `resolveAndValidatePath()` | 确保所有操作在 `~/.hometale/` 内 |
| 第二层 | 角色权限 | `permissions.ts` `canPerformAction()` | 记忆文件跨角色访问控制（自己可写，他人只读） |
| 第三层 | 危险命令黑名单 | `safety-checks.ts` `isDangerousCommand()` | 命令执行前的兜底拦截 |

### AI SDK v5 工具定义

```ts
read_file: tool({
  description: '读取指定文件的内容。路径相对于 ~/.hometale/',
  inputSchema: z.object({
    path: z.string().describe('文件路径'),
    limit: z.number().optional().describe('最多返回的行数')
  }),
  execute: async (args) => {
    const rid = resolveRoleId();
    if (!canPerformAction(rid, 'read', args.path)) {
      return `[ERROR] 不允许读取文件: ${args.path}`;
    }
    // ... 执行读取
  }
}),
```

**关键设计点**：
- `inputSchema` 使用 Zod schema，AI SDK 自动校验参数类型
- `execute` 闭包注入 `roleId`，实现权限上下文传递
- 错误返回统一 `[ERROR]` 前缀，模型可识别并调整策略

### Skill 工具注册

Skill 通过 `getSkillRegistry()` 动态注册，Schema 从 JSON Schema 自动转 Zod：

```ts
// server/src/agent-core/tools/index.ts
const skillTools: ToolSet = {};
for (const skill of skills) {
  const zodSchema = convertInputSchemaToZod(skill.tool.inputSchema);
  skillTools[skill.tool.name] = tool({
    description: skill.tool.description,
    inputSchema: zodSchema,
    execute: async (params) => {
      return await skill.execute(params, { roleId, hometaleRoot });
    }
  });
}
```

### 工具名称修复

模型偶尔会输错工具名（如 `readFile` 而非 `read_file`）。`getAvailableToolNames()` 提供所有有效工具名列表，用于名称映射和修复。

## 关键文件

| 文件 | 说明 |
|------|------|
| `server/src/lib/fs-utils.ts` | 底层文件操作（带截断） |
| `server/src/agent-core/tools/file-tools.ts` | 文件工具 + run_bash 定义 |
| `server/src/agent-core/tools/permissions.ts` | 路径沙箱 + 角色权限 |
| `server/src/agent-core/tools/safety-checks.ts` | 危险命令黑名单 |
| `server/src/agent-core/tools/index.ts` | ToolSet 组装 + Skill 注册 |
| `server/src/agent-core/tools/tool-info-filter.ts` | 工具信息脱敏（前端展示用） |
| `server/src/agents/types.ts` | ToolCall / ToolResult 类型定义 |

## 参考

- `s02_tool_use.py` — Anthropic SDK 工具使用示例
- [AI SDK Tools](https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling) — Vercel AI SDK 官方文档

---

# 通用 Agent Harness 设计思路

## 设计哲学

工具调用机制的本质是：将模型输出的 `tool_use` 指令，通过一条**可审计、可控制、可回流**的执行管线，转换为可被下一轮对话理解的 `tool_result`。

**核心原则**：
- 工具是协议对象，而非简单函数映射
- 执行过程应透明且可控，而非黑盒调用
- 所有运行时状态最终归约为统一的 Transcript 流

---

## 一、总链路：从 `tool_use` 到 `tool_result`

```
模型输出 assistant message (含 tool_use blocks)
  │
  ▼
收集 tool_use，选择执行模式（流式/批量）
  │
  ▼
按并发安全性分批调度
  │
  ▼
逐个执行每个 tool_use
  │
  ├─ Schema 校验
  ├─ 语义校验
  ├─ PreToolUse Hooks（权限、审计、参数修正）
  ├─ 执行 tool.call()
  └─ 生成标准化结果
  │
  ▼
结果回流为 user-side tool_result messages
  │
  ▼
下一轮 API 调用携带这些结果
```

---

## 二、工具抽象：统一的运行时协议

工具不是简单的 `name + execute` 函数对，而是一个承载**多维度元数据**的协议对象：

| 维度 | 目的 | 示例属性 |
|------|------|----------|
| **能力描述** | 供模型理解工具用途 | `description()`, `prompt()`, `searchHint` |
| **输入输出** | 参数校验、结果转换 | `inputSchema`, `outputSchema`, `mapToolResultToToolResultBlockParam()` |
| **安全声明** | 决定执行策略 | `isConcurrencySafe()`, `isReadOnly()`, `isDestructive()`, `checkPermissions()` |
| **语义校验** | Schema 之外的逻辑验证 | `validateInput()` |
| **UI 表现** | 决定界面展示方式 | `renderToolUseMessage()`, `renderToolResultMessage()` |
| **运行控制** | 控制执行流程 | `interruptBehavior()`, `requiresUserInteraction()`, `backfillObservableInput()` |

**Fail-Closed 默认策略**：
- 并发默认不安全
- 写操作默认存在风险
- 安全相关能力必须显式声明

这保证了系统对新增工具的保守态度，避免安全盲点。

---

## 三、工具池组装：内置与扩展的融合点

```
内置工具池
  │
  ├─ 始终存在的基础工具
  ├─ Feature Flag 条件启用的工具
  └─ 内部用户专属工具
  │
  ▼ merge (内置优先，同名覆盖)
  │
扩展工具池 (MCP / Plugin / Skill)
  │
  ▼ 过滤 deny 规则
  │
  ▼ 合并、去重、排序
  │
  ▼ 最终工具池
```

**关键设计**：
- 内置工具优先级高于扩展工具，防止同名恶意覆盖
- `uniqBy` 去重确保工具名称唯一性
- 动态过滤机制允许运行时禁用特定工具

---

## 四、调度层：并发不是默认开启的

### 4.1 按安全性分批

```typescript
function partitionToolCalls(toolUses): Batch[] {
  const batches: Batch[] = [];
  let currentConcurrentBatch: ToolUse[] = [];

  for (const toolUse of toolUses) {
    const tool = findTool(toolUse.name);
    const isSafe = tool?.isConcurrencySafe(toolUse.input);

    if (isSafe) {
      currentConcurrentBatch.push(toolUse);
    } else {
      // 收口前面的安全工具
      if (currentConcurrentBatch.length > 0) {
        batches.push({ type: 'concurrent', tools: currentConcurrentBatch });
        currentConcurrentBatch = [];
      }
      // 不安全工具独立串行
      batches.push({ type: 'sequential', tools: [toolUse] });
    }
  }
  return batches;
}
```

**举例**：`[Read, Read, Write, Read]` → `[Read, Read]` 并发, `[Write]` 串行, `[Read]` 独占

### 4.2 上下文修改延迟应用

并发批次的工具可能修改共享状态（如工作目录）。延迟应用可避免竞态污染：
- 收集所有并发工具的 `contextModifier`
- 批次全部完成后依次应用

---

## 五、流式执行：边收边跑

在长响应场景中，不应等待完整的 Assistant Content 接收完才执行工具。

**状态机流转**：`queued` → `executing` → `completed` → `yielded`

1. 并发安全的工具一旦 Schema 解析通过，立即启动
2. 不安全的兄弟节点进入排队
3. 任一工具失败可中断未完成的兄弟节点

---

## 六、执行主干：多层防护

### 6.1 三层校验

| 层级 | 校验内容 | 失败处理 |
|------|----------|----------|
| **Schema 校验** | 参数类型、结构 | 返回错误栈，让模型重试 |
| **语义校验** | 业务逻辑正确性（如新旧字符串是否相等） | 返回语义错误提示 |
| **Backfill** | 隐式依赖注入（如路径展开） | 静默补全，供后续审计 |

### 6.2 PreToolUse Hooks

Hook 系统提供可插拔的前置拦截能力：

```typescript
async function* runPreToolUseHooks(tool, input, context) {
  // 顺序执行：
  // 1. 权限检查 (allow | deny | ask)
  // 2. 审计日志
  // 3. 参数修正
  // 4. 自定义拦截器
}
```

拦截后直接返回 UI 卡片消息，不再调用工具本体。

### 6.3 最终执行

```typescript
try {
  result = await tool.call(args, context, canUseTool, parentMessage, onProgress);
  processResult(result);
} catch (error) {
  yield generateErrorResult(error);
}
```

---

## 七、结果回流：双面向

工具结果有两个消费者：

| 消费者 | 形式 | 用途 |
|--------|------|------|
| **UI** | progress / result / reject / error | 实时用户反馈 |
| **模型** | 标准 `tool_result` messages | 下一轮对话输入 |

**关键清理器**：`normalizeMessagesForAPI()` 从富文本混合队列中提炼 API 可接受格式。

---

## 八、机制设计特点总结

1. **管线代理模式**：工具调用行为被多层管线包装，具备前置拦截、语义补偿等非功能特征
2. **Transcript 是唯一交互真理**：一切复杂运行状态最终化为对话流文本
3. **安全内置于底层接口**：从接口定义开始约束权限和并发限制

---

## 九、具体设计示例

### 示例 1：文件编辑工具

文件编辑工具应包含：
- UNC 文件锁验证（避免并发冲突）
- 超大文件阻断保护
- 秘密钥匹配机制（防泄漏）
- 错误提示补全（"did you mean ...?"）

### 示例 2：用户提问工具

工具不一定是后端代码操作，也可以是 UI 交互：
- `shouldDefer = true` — 延迟执行
- `requiresUserInteraction = true` — 需要用户输入
- `isReadOnly = true` — 纯查询

模型通过调用工具向用户展示表单，用户的输入直接作为工具返回值。这展示了工具调用链路的**双边交互抽象**本质。
