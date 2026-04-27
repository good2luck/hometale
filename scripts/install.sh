#!/bin/bash

# HomeTale One-Line Install Script
# Usage: curl -fsSL https://get.hometale.org/install.sh | bash

set -e

echo "========================================="
echo "  HomeTale - 家的故事"
echo "  One-Line Installer"
echo "========================================="
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未找到"
    echo ""
    echo "请先安装 Node.js 18 或更高版本："
    echo "  https://nodejs.org/"
    echo ""
    echo "或使用 nvm:"
    echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    echo "  nvm install --lts"
    echo ""
    exit 1
fi

NODE_VERSION=$(node -v)
echo "✓ Node.js 版本: $NODE_VERSION"

# Check for npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm 未找到"
    exit 1
fi

echo ""
echo "========================================="
echo "  安装 HomeTale..."
echo "========================================="
echo ""

# Install globally
npm install -g @hometale/cli

echo ""
echo "========================================="
echo "  安装完成!"
echo "========================================="
echo ""
echo "接下来运行配置向导:"
echo ""
echo "  hometale onboard"
echo ""
echo "或配置并启动守护进程:"
echo ""
echo "  hometale onboard --install-daemon"
echo ""
echo "查看帮助:"
echo "  hometale --help"
echo ""
echo "========================================="
