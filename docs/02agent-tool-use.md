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
