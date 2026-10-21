#!/usr/bin/env bash
# 《文枢·寻迹》云服务器一键部署脚本（Ubuntu / Debian）
#
# 用法：先把 platform/ 目录上传到服务器（git clone 或 scp），
#      然后 cd 到 platform/ 执行：  bash deploy.sh
#
# 若提示 "bad interpreter"（Windows 换行符导致），先执行：  sed -i 's/\r$//' deploy.sh
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "==> 部署目录：$APP_DIR"

# 1. 安装 Node 18（若未装）
if ! command -v node >/dev/null 2>&1; then
  echo "==> 安装 Node.js 18 ..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "==> Node 版本：$(node -v)"

# 2. 安装依赖
cd "$APP_DIR"
echo "==> 安装依赖 ..."
npm install --production

# 3. 安装 PM2 并用配置启动（server.js 内部已 cluster，PM2 单实例守护）
if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> 安装 PM2 ..."
  sudo npm i -g pm2
fi
pm2 start ecosystem.config.js
pm2 save
echo "==> 已通过 PM2 启动，可用：pm2 logs wenshu-xunji 查看日志"

# 4. Nginx（可选）
if command -v nginx >/dev/null 2>&1; then
  echo "==> 检测到 Nginx：请把 nginx.conf 内容复制到站点配置后执行 nginx -t && nginx -s reload"
else
  echo "==> 提示：可安装 Nginx 反代（sudo apt-get install -y nginx），或直接 http://服务器IP:3000 访问"
fi

echo ""
echo "=============================================="
echo "  ✅ 部署完成！"
echo "  直接访问： http://$(curl -s ifconfig.me 2>/dev/null || echo '服务器IP'):3000"
echo "  进程状态： pm2 status"
echo "  查看日志： pm2 logs wenshu-xunji"
echo "=============================================="
