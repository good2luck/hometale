#!/bin/bash

# HomeTale 安装和启动脚本

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOMETALE_DIR="$HOME/.hometale"

echo "========================================="
echo "  HomeTale - 家的故事"
echo "========================================="
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js，请先安装 Node.js"
    exit 1
fi

NODE_VERSION=$(node -v)
echo "✓ Node.js 版本: $NODE_VERSION"

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "❌ 错误: 未找到 npm"
    exit 1
fi

echo ""
echo "========================================="
echo "  安装依赖..."
echo "========================================="
echo ""

# 安装根目录依赖
echo "→ 安装根目录依赖..."
cd "$PROJECT_DIR"
npm install

# 安装 server 依赖
echo ""
echo "→ 安装 server 依赖..."
cd "$PROJECT_DIR/server"
npm install

# 安装 cli 依赖
echo ""
echo "→ 安装 cli 依赖..."
cd "$PROJECT_DIR/cli"
npm install

# 安装 web 依赖
echo ""
echo "→ 安装 web 依赖..."
cd "$PROJECT_DIR/web"
npm install

echo ""
echo "========================================="
echo "  初始化配置..."
echo "========================================="
echo ""

# 创建 ~/.hometale 目录和默认配置
if [ ! -d "$HOMETALE_DIR" ]; then
    mkdir -p "$HOMETALE_DIR"
    echo "✓ 创建目录: $HOMETALE_DIR"
fi

# 创建默认 config.json（如果不存在）
CONFIG_FILE="$HOMETALE_DIR/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
    cat > "$CONFIG_FILE" << EOF
{
  "model": {
    "provider": "openai",
    "apiKey": "",
    "model": "gpt-4o",
    "baseURL": ""
  }
}
EOF
    echo "✓ 创建配置文件: $CONFIG_FILE"
    echo ""
    echo "⚠️  请编辑 $CONFIG_FILE 配置你的 API Key"
    echo ""
fi

echo ""
echo "========================================="
echo "  安装完成！"
echo "========================================="
echo ""
echo "使用说明："
echo ""
echo "方式一：使用 CLI（推荐）"
echo ""
echo "1. 运行 CLI 并配置模型："
echo "   cd $PROJECT_DIR/cli"
echo "   npm run build"
echo "   npm link"
echo "   hometale --config"
echo ""
echo "2. 开始聊天："
echo "   hometale"
echo ""
echo "方式二：使用 Web UI"
echo ""
echo "1. 配置 API Key（如果还没配置）:"
echo "   编辑 $CONFIG_FILE"
echo ""
echo "2. 启动后端服务（终端 1）:"
echo "   cd $PROJECT_DIR/server"
echo "   npm run dev:web"
echo ""
echo "3. 启动前端服务（终端 2）:"
echo "   cd $PROJECT_DIR/web"
echo "   npm run dev"
echo ""
echo "4. 访问应用:"
echo "   打开浏览器访问 http://localhost:3000"
echo ""
echo "========================================="
