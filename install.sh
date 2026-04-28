#!/bin/bash

# HomeTale 一键安装脚本
# 用法: curl -fsSL https://raw.githubusercontent.com/good2luck/hometale/master/install.sh | bash
#   或: curl -fsSL https://raw.githubusercontent.com/good2luck/hometale/master/install.sh | bash -s -- --install-daemon

set -e

REPO_URL="https://github.com/good2luck/hometale.git"
INSTALL_DIR="$HOME/.hometale-src"
HOMETALE_DIR="$HOME/.hometale"
INSTALL_DAEMON=false

# 解析参数
for arg in "$@"; do
  case $arg in
    --install-daemon) INSTALL_DAEMON=true ;;
  esac
done

echo "========================================="
echo "  HomeTale - 家的故事 一键安装"
echo "========================================="
echo ""

# ── 检查前置依赖 ──

if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js，请先安装 Node.js 18+"
    echo "   https://nodejs.org/"
    exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "❌ 错误: Node.js 版本过低 ($(node -v))，需要 18+"
    exit 1
fi
echo "✓ Node.js $(node -v)"

if ! command -v npm &> /dev/null; then
    echo "❌ 错误: 未找到 npm"
    exit 1
fi
echo "✓ npm $(npm -v)"

if ! command -v git &> /dev/null; then
    echo "❌ 错误: 未找到 git，请先安装 git"
    exit 1
fi
echo "✓ git $(git --version 2>&1 | awk '{print $3}')"

echo ""

# ── 克隆仓库 ──

if [ -d "$INSTALL_DIR" ]; then
    echo "→ 更新已有源码: $INSTALL_DIR"
    cd "$INSTALL_DIR"
    git pull --ff-only || {
        echo "⚠️  git pull 失败，重新克隆..."
        rm -rf "$INSTALL_DIR"
        git clone "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    }
else
    echo "→ 克隆仓库: $REPO_URL"
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

echo ""

# ── 安装依赖 ──

echo "→ 安装依赖..."
npm install

echo ""

# ── 构建 ──

echo "→ 构建项目..."
npm run build

echo ""

# ── 链接 CLI ──

echo "→ 链接 hometale 命令..."
cd "$INSTALL_DIR/cli"
npm link 2>/dev/null || sudo npm link

echo ""

# ── 初始化配置 ──

if [ ! -d "$HOMETALE_DIR" ]; then
    mkdir -p "$HOMETALE_DIR"
    echo "✓ 创建目录: $HOMETALE_DIR"
fi

CONFIG_FILE="$HOMETALE_DIR/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
    cat > "$CONFIG_FILE" << 'EOF'
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
fi

echo ""

# ── 运行 onboard ──

if [ "$INSTALL_DAEMON" = true ]; then
    echo "→ 运行配置向导并启动守护进程..."
    hometale onboard --install-daemon
else
    echo "→ 运行配置向导..."
    hometale onboard
fi

echo ""
echo "========================================="
echo "  安装完成！"
echo "========================================="
echo ""
echo "常用命令："
echo "  hometale              # 进入交互式对话"
echo "  hometale chat         # 同上"
echo "  hometale run          # 启动 Web 服务器（前台）"
echo "  hometale start        # 启动后台守护进程"
echo "  hometale stop         # 停止守护进程"
echo "  hometale log --follow # 查看实时日志"
echo ""
echo "源码目录: $INSTALL_DIR"
echo "数据目录: $HOMETALE_DIR"
echo ""
echo "如需更新，重新运行此脚本即可。"
echo "========================================="
