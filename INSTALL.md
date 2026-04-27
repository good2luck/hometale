# 安装指南

本文档介绍如何从源码构建和开发 HomeTale。

## 前置要求

- Node.js 18 或更高版本
- npm 10 或更高版本

## 从源码安装

### 1. 克隆仓库

```bash
git clone https://github.com/hometale/hometale.git
cd hometale
```

### 2. 安装依赖

```bash
npm install
```

### 3. 构建

```bash
# 构建所有包
npm run build

# 或使用发布脚本
./scripts/prepublish.sh
```

### 4. 链接 CLI 到全局

```bash
cd cli
npm link
```

### 5. 配置

```bash
hometale onboard
```

## 开发模式

### 启动 Web 开发服务器

**终端 1 - 后端**:
```bash
cd server
npm run dev:web
```

**终端 2 - 前端**:
```bash
cd web
npm run dev
```

访问 http://localhost:3000

### 启动 CLI 开发模式

```bash
cd cli
npm start
```

## 配置模型

编辑 `~/.hometale/config.json`：

```json
{
  "model": {
    "provider": "openai",
    "apiKey": "sk-your-api-key-here",
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
    "apiKey": "sk-ant-your-api-key-here",
    "model": "claude-3-5-sonnet-20241022",
    "baseURL": "https://api.anthropic.com"
  }
}
```

`baseURL` 是可选的，用于自定义 API 端点（如兼容 OpenAI 格式的第三方服务）。

## 故障排除

### 守护进程无法启动

检查日志：
```bash
tail -f ~/.hometale/daemon.log
```

### 清理所有数据

```bash
rm -rf ~/.hometale
```

### 端口被占用

修改端口：
```bash
PORT=3002 hometale start
```
