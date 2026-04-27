# HomeTale CLI

> HomeTale - 家的故事，家庭智能体命令行工具

## 安装

```bash
npm install -g @hometale/cli
```

## 快速开始

### 方式一：配置向导（推荐）

```bash
hometale onboard
```

配置向导会引导你完成：
- LLM 模型配置（OpenAI / Anthropic）
- 微信账号配置（可选）
- 后台守护进程安装（可选）

### 方式二：手动启动

```bash
# 1. 配置模型
hometale onboard --model-only

# 2. 启动 Web 服务
hometale run
```

## 命令参考

### 基础命令

| 命令 | 说明 |
|------|------|
| `hometale` 或 `hometale chat` | 进入交互式对话模式 |
| `hometale run` | 启动 Web 服务器（前台） |
| `hometale start` | 启动后台守护进程 |
| `hometale stop` | 停止守护进程 |
| `hometale status` | 查看守护进程状态 |
| `hometale log` | 查看日志（最近 50 行） |
| `hometale log --follow` | 实时跟踪日志 |
| `hometale log --lines=N` | 指定日志行数 |
| `hometale onboard` | 运行配置向导 |

### 微信命令

| 命令 | 说明 |
|------|------|
| `hometale weixin login` | 扫码登录微信 |
| `hometale weixin list` | 列出已配置账号 |
| `hometale weixin logout <id>` | 登出并移除账号 |
| `hometale weixin status` | 查看所有账号状态 |

### 微信聊天快速启动

```bash
# 首次使用，配置模型和微信
hometale onboard          # 配置模型（可选配置微信）
hometale weixin login     # 扫码登录微信（如 onboarding 时未配置）

# 启动服务（含微信轮询）
hometale start            # 启动守护进程，自动开始微信轮询

# 查看状态
hometale status
hometale weixin status
hometale log --follow
```

## 数据存储

所有数据存储在 `~/.hometale/` 目录：

```
~/.hometale/
├── AGENTS.md              # 全局配置
├── config.json            # LLM 配置
├── messages.db            # 消息记录
├── daemon.log             # 守护进程日志
├── roles/                 # 家庭成员
│   ├── dad/
│   ├── mom/
│   └── ...
├── sessions/              # 会话数据
└── skills/                # 自定义技能
```

## 配置文件

编辑 `~/.hometale/config.json` 配置模型：

```json
{
  "model": {
    "provider": "openai",
    "apiKey": "sk-your-api-key",
    "model": "gpt-4o",
    "baseURL": "https://api.openai.com/v1"
  }
}
```

或使用 Anthropic：

```json
{
  "model": {
    "provider": "anthropic",
    "apiKey": "sk-ant-your-api-key",
    "model": "claude-sonnet-4-20250514"
  }
}
```

## 开发

从源码运行：

```bash
git clone https://github.com/hometale/hometale.git
cd hometale
npm install
npm run build
cd cli
npm link
hometale
```

## 故障排除

### 守护进程无法启动

```bash
hometale log            # 查看日志
```

### 清理所有数据

```bash
rm -rf ~/.hometale
```

### 端口被占用

```bash
PORT=3002 hometale start
```

## 更多信息

- [GitHub 仓库](https://github.com/hometale/hometale)
- [在线文档](https://hometale.org)

## License

MIT