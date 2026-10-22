#!/usr/bin/env bash
# =============================================================================
# 一键把前端（懒羊羊界面）发布到云服务器 80 端口
#
# 用法（在本机项目根目录执行）：
#   bash deploy/push-web.sh                    # 默认服务器 120.48.55.183
#   bash deploy/push-web.sh root@1.2.3.4       # 换服务器
#
# 做的事：npm run build -> 打包 dist -> scp -> 服务器解包到 /opt/lanyangyang-web
# 前置：本机已把 deploy 公钥加到服务器（~/.ssh/lanyangyang_deploy）
# =============================================================================
set -euo pipefail

TARGET="${1:-root@120.48.55.183}"
KEY="${SSH_KEY:-$HOME/.ssh/lanyangyang_deploy}"
REMOTE_DIR="/opt/lanyangyang-web"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "== 1/4 构建前端 =="
npm run build

echo "== 2/4 打包 dist =="
TMP_TGZ="$(mktemp -t lyy-web-XXXXXX.tar.gz)"
tar czf "$TMP_TGZ" -C dist .
echo "   包大小: $(du -h "$TMP_TGZ" | cut -f1)"

echo "== 3/4 上传 =="
scp -i "$KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=20 "$TMP_TGZ" "$TARGET:/root/lyy-web.tar.gz"

echo "== 4/4 服务器解包 =="
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 "$TARGET" "
  set -e
  mkdir -p '$REMOTE_DIR/download'
  rm -rf '$REMOTE_DIR/assets' '$REMOTE_DIR/index.html'
  tar xzf /root/lyy-web.tar.gz -C '$REMOTE_DIR'
  chmod -R a+rX '$REMOTE_DIR'
  echo '  已更新:'; ls '$REMOTE_DIR'
  echo '  自检:'; curl -s -o /dev/null -w '  GET / -> %{http_code}\n' http://127.0.0.1/
"

rm -f "$TMP_TGZ"
echo
echo "== 完成: http://${TARGET#*@}/ =="
echo "提示：静态文件带 hash，浏览器会自动拿新版；页面仍是旧的可 Ctrl+F5 强刷。"
