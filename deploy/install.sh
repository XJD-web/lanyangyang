#!/usr/bin/env bash
# =============================================================================
# Lanyangyang API - 一键部署脚本（Ubuntu / Debian）
#
# 用法（在服务器上以 root 执行）：
#   1) 上传并解压：  tar xzf lanyangyang-api.tar.gz
#   2) 执行：        cd lanyangyang-api && bash install.sh
#
# 步骤：
#   [1] 安装 Node.js 20（官方二进制包，不改 apt 源；已装则跳过）
#   [2] 代码复制到 /opt/lanyangyang-api
#   [3] 安装生产依赖（npmjs 失败时自动切国内镜像）
#   [4] 注册 systemd 服务（开机自启 + 崩溃自动重启）
#   [5] 本地健康检查 + 接口自检
#   [6] 接管 80 端口：
#         · 完整备份 /etc/nginx 与 nginx -T 全文
#         · 只移走「占用 80 default_server」的那一个配置（域名站点/SSL 不动）
#         · 安装本服务站点，nginx -t 通过才 reload，失败自动还原
#         · 生成 /root/lanyangyang-rollback.sh
#   [7] 汇总
#
# 环境变量：
#   PORT=3000                后端监听端口
#   APP_DIR=/opt/lanyangyang-api
#   SKIP_NGINX=1             只装后端，不动 nginx
#   KEEP_DEFAULT_SITE=1      不接管 80（新服务只监听端口，需自行放行）
#   SITE_NAME=lanyangyang-api
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lanyangyang-api}"
SERVICE="lanyangyang-api"
PORT="${PORT:-3000}"
SKIP_NGINX="${SKIP_NGINX:-0}"
KEEP_DEFAULT_SITE="${KEEP_DEFAULT_SITE:-0}"
SITE_NAME="${SITE_NAME:-lanyangyang-api}"
NODE_VERSION="${NODE_VERSION:-20.19.0}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/root/lanyangyang-backup/${STAMP}"
ROLLBACK="/root/lanyangyang-rollback.sh"

echo "=============================================="
echo " Lanyangyang API 部署"
echo "  源码   : $SRC_DIR"
echo "  目标   : $APP_DIR"
echo "  端口   : $PORT"
echo "  接管80 : $([ "$SKIP_NGINX" = "1" ] || [ "$KEEP_DEFAULT_SITE" = "1" ] && echo 否 || echo 是)"
echo "=============================================="
echo

if [ "$(id -u)" != "0" ]; then
  echo "ERROR: 需要 root 权限（sudo bash install.sh）"
  exit 1
fi

# 站点配置：优先用部署包自带的那份
NGINX_CONF_SRC=""
for p in "$SRC_DIR/nginx-lanyangyang.conf" "$SRC_DIR/../deploy/nginx-lanyangyang.conf" "$SRC_DIR/deploy/nginx-lanyangyang.conf"; do
  if [ -f "$p" ]; then NGINX_CONF_SRC="$p"; break; fi
done

# --- 1) Node.js -------------------------------------------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  CUR_MAJOR="$(node -v | sed 's/^v//; s/\..*//')"
  if [ "${CUR_MAJOR:-0}" -ge 16 ] 2>/dev/null; then
    need_node=0
    echo "[1/7] 已安装 Node.js: $(node -v)"
  else
    echo "[1/7] 现有 Node.js $(node -v) 版本过低，安装 v${NODE_VERSION}"
  fi
fi

if [ "$need_node" = "1" ]; then
  echo "[1/7] 安装 Node.js v${NODE_VERSION}（官方二进制包）..."
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64) NODE_ARCH="linux-x64" ;;
    aarch64|arm64) NODE_ARCH="linux-arm64" ;;
    *) echo "ERROR: 不支持的架构 $ARCH，请手动安装 Node.js 18+"; exit 1 ;;
  esac
  PKG="node-v${NODE_VERSION}-${NODE_ARCH}"
  TMPD="$(mktemp -d)"

  ok=0
  for BASE in "https://nodejs.org/dist" "https://registry.npmmirror.com/-/binary/node"; do
    echo "      下载源: $BASE"
    if curl -fsSL --connect-timeout 10 -m 300 -o "$TMPD/node.tar.xz" "$BASE/v${NODE_VERSION}/${PKG}.tar.xz"; then
      ok=1; break
    fi
    echo "      ! 该源失败，换下一个"
  done
  if [ "$ok" != "1" ]; then
    echo "ERROR: Node.js 下载失败，请检查服务器外网出口"; rm -rf "$TMPD"; exit 1
  fi

  mkdir -p /usr/local/lib/nodejs
  tar -xJf "$TMPD/node.tar.xz" -C /usr/local/lib/nodejs
  rm -rf "$TMPD"
  # 软链到 /usr/local/bin，全局可用
  for b in node npm npx corepack; do
    if [ -e "/usr/local/lib/nodejs/${PKG}/bin/${b}" ]; then
      ln -sfn "/usr/local/lib/nodejs/${PKG}/bin/${b}" "/usr/local/bin/${b}"
    fi
  done
  hash -r
  echo "      ✓ $(node -v) / npm $(npm -v)"
fi
NODE_BIN="$(command -v node | head -n1)"

# --- 2) 复制代码 ------------------------------------------------------------
echo "[2/7] 复制代码到 $APP_DIR ..."
mkdir -p "$APP_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  for f in server.js softwares.js package.json package-lock.json .env.example; do
    [ -f "$SRC_DIR/$f" ] && cp -f "$SRC_DIR/$f" "$APP_DIR"/
  done
fi

# 前端界面（可选）：部署包里带 web.tar.gz 就一并铺到 /opt/lanyangyang-web
WEB_DIR="/opt/lanyangyang-web"
if [ -f "$SRC_DIR/web.tar.gz" ]; then
  echo "       部署前端界面到 $WEB_DIR"
  mkdir -p "$WEB_DIR/download"
  tar xzf "$SRC_DIR/web.tar.gz" -C "$WEB_DIR"
  chmod -R a+rX "$WEB_DIR"
else
  mkdir -p "$WEB_DIR"
fi

# --- 3) 依赖 ----------------------------------------------------------------
echo "[3/7] 安装生产依赖 ..."
cd "$APP_DIR"
if ! npm install --omit=dev --no-audit --no-fund --loglevel=error; then
  echo "      ! 默认源失败，切换国内镜像重试"
  npm install --omit=dev --no-audit --no-fund --loglevel=error \
    --registry=https://registry.npmmirror.com
fi
[ -d "$APP_DIR/node_modules/express" ] || { echo "ERROR: express 未安装成功"; exit 1; }
echo "      ✓ 依赖就绪"

# --- 4) systemd -------------------------------------------------------------
echo "[4/7] 注册 systemd 服务: $SERVICE ..."
cat > "/etc/systemd/system/${SERVICE}.service" <<SUNIT
[Unit]
Description=Lanyangyang API Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} ${APP_DIR}/server.js
Environment=PORT=${PORT}
Environment=NODE_ENV=production
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SUNIT

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true
systemctl restart "$SERVICE"
sleep 3

# --- 5) 健康检查 ------------------------------------------------------------
echo "[5/7] 健康检查 ..."
HEALTH_OK=0
for _ in 1 2 3 4 5; do
  if curl -fsS -m 3 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null; then HEALTH_OK=1; echo; break; fi
  sleep 1
done
if [ "$HEALTH_OK" = "1" ]; then
  echo "      ✓ 后端在 127.0.0.1:${PORT} 正常响应"
  COUNT=$(curl -fsS -m 5 "http://127.0.0.1:${PORT}/api/softwares" 2>/dev/null | grep -o '"version"' | wc -l | tr -d ' ')
  echo "      /api/softwares 版本条目数: ${COUNT}"
else
  echo "      ✗ 健康检查失败，日志：journalctl -u ${SERVICE} -n 50 --no-pager"
  systemctl --no-pager status "$SERVICE" | head -n 15 || true
  exit 1
fi

# --- 6) nginx 接管 80 -------------------------------------------------------
TAKE_80=1
if [ "$SKIP_NGINX" = "1" ] || [ "$KEEP_DEFAULT_SITE" = "1" ]; then TAKE_80=0; fi
if [ "$TAKE_80" = "1" ] && ! command -v nginx >/dev/null 2>&1; then
  echo "[6/7] 未安装 nginx，跳过（可用 http://IP:${PORT} 访问）"
  TAKE_80=0
fi

if [ "$TAKE_80" = "0" ]; then
  echo "[6/7] 跳过 nginx 接管"
else
  echo "[6/7] 接管 80 端口 ..."
  mkdir -p "$BACKUP_DIR/occupied"

  # 6.1 备份
  echo "      备份 /etc/nginx -> $BACKUP_DIR/etc-nginx"
  cp -a /etc/nginx "$BACKUP_DIR/etc-nginx"
  nginx -T > "$BACKUP_DIR/nginx-T.before.txt" 2>&1 || true

  # 6.2 只移走占用 80 default_server 的配置；域名站点 / 443 SSL 一律不动
  #     每个被移走的文件把「原始绝对路径」记进清单，回滚时按原路径放回
  MANIFEST="$BACKUP_DIR/occupied.manifest"
  : > "$MANIFEST"
  MOVED=0
  for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
    [ -e "$f" ] || continue
    if grep -Eq '^[[:space:]]*listen[[:space:]]+([^;]*:)?80[[:space:]]+[^;]*default_server' "$f" 2>/dev/null; then
      base="$(basename "$f")"
      mv "$f" "$BACKUP_DIR/occupied/${base}"
      echo "$f" >> "$MANIFEST"
      echo "      移出 80 default_server: $f"
      MOVED=$((MOVED+1))
    fi
  done
  echo "      共移出 ${MOVED} 个（其余配置保持原样）"

  # 6.3 安装新站点
  if [ -z "$NGINX_CONF_SRC" ]; then
    echo "      ! 部署包里没有 nginx-lanyangyang.conf，跳过站点安装"
  else
    cp -f "$NGINX_CONF_SRC" "/etc/nginx/sites-available/${SITE_NAME}"
    mkdir -p /etc/nginx/sites-enabled
    ln -sfn "/etc/nginx/sites-available/${SITE_NAME}" "/etc/nginx/sites-enabled/${SITE_NAME}"
    echo "      安装站点: /etc/nginx/sites-available/${SITE_NAME}"

    if nginx -t 2>"$BACKUP_DIR/nginx-t.err"; then
      systemctl reload nginx 2>/dev/null || systemctl restart nginx
      echo "      ✓ nginx 已 reload，80 端口 -> 127.0.0.1:${PORT}"
    else
      echo "      ✗ nginx -t 失败，自动还原 ..."
      sed 's/^/        /' "$BACKUP_DIR/nginx-t.err" || true
      rm -f "/etc/nginx/sites-enabled/${SITE_NAME}"
      # 按清单把移走的配置放回原路径
      while IFS= read -r orig; do
        [ -n "$orig" ] || continue
        b="$BACKUP_DIR/occupied/$(basename "$orig")"
        if [ -e "$b" ]; then
          mkdir -p "$(dirname "$orig")"
          cp -a "$b" "$orig"
          echo "        已放回: $orig"
        fi
      done < "$MANIFEST"
      if nginx -t 2>/dev/null; then
        systemctl reload nginx 2>/dev/null || true
        echo "      ✓ 已还原到部署前状态"
      else
        echo "      ! 还原后 nginx -t 仍失败，请用完整备份："
        echo "        rm -rf /etc/nginx && cp -a $BACKUP_DIR/etc-nginx /etc/nginx"
      fi
      exit 1
    fi
  fi

  # 6.4 回滚脚本
  cat > "$ROLLBACK" <<RBOF
#!/usr/bin/env bash
# =============================================================================
# Lanyangyang API 回滚脚本（自动生成于 ${STAMP}）
# 备份目录：${BACKUP_DIR}
# 用法：bash ${ROLLBACK}
# 作用：撤掉 80 上的 lanyangyang-api 站点，恢复部署前的 nginx 配置
#       （只动 nginx 配置，站点文件与数据库一律不删）
# =============================================================================
set -euo pipefail
BK="${BACKUP_DIR}"
[ "\$(id -u)" = "0" ] || { echo "请用 root 执行"; exit 1; }
[ -d "\$BK" ] || { echo "备份目录不存在: \$BK"; exit 1; }

echo "== 撤销 80 站点 =="
rm -f "/etc/nginx/sites-enabled/${SITE_NAME}"
rm -f "/etc/nginx/sites-available/${SITE_NAME}"

echo "== 恢复原有 default_server 配置 =="
MANIFEST="\$BK/occupied.manifest"
if [ -f "\$MANIFEST" ]; then
  while IFS= read -r orig; do
    [ -n "\$orig" ] || continue
    b="\$BK/occupied/\$(basename "\$orig")"
    if [ -e "\$b" ]; then
      mkdir -p "\$(dirname "\$orig")"
      cp -a "\$b" "\$orig"
      echo "  恢复: \$orig"
    else
      echo "  ! 备份缺失，跳过: \$orig"
    fi
  done < "\$MANIFEST"
else
  echo "  (无清单，跳过)"
fi

if nginx -t; then
  systemctl reload nginx
  echo "✓ nginx 已恢复到部署前状态"
else
  echo "✗ nginx -t 失败，用完整备份还原："
  echo "  rm -rf /etc/nginx && cp -a \$BK/etc-nginx /etc/nginx && nginx -t && systemctl reload nginx"
  exit 1
fi

echo
echo "如需连后端一起停："
echo "  systemctl stop ${SERVICE} && systemctl disable ${SERVICE}"
echo "（代码仍在 ${APP_DIR}，未删除任何数据）"
RBOF
  chmod +x "$ROLLBACK"
  echo "      回滚脚本: $ROLLBACK"
fi

# --- 7) 汇总 ----------------------------------------------------------------
echo "[7/7] 完成"
echo
echo "== 端口监听 =="
ss -lntp 2>/dev/null | grep -E ":(${PORT}|80|443)[[:space:]]" || true

echo
echo "== 站点页面自检 =="
if [ "$TAKE_80" = "1" ]; then
  curl -s -o /dev/null -w "  http://127.0.0.1/            -> %{http_code} (%{content_type})\n" -m 5 http://127.0.0.1/ || true
  curl -s -o /dev/null -w "  http://127.0.0.1/api/health  -> %{http_code}\n" -m 5 http://127.0.0.1/api/health || true
else
  curl -s -o /dev/null -w "  http://127.0.0.1:${PORT}/api/health -> %{http_code}\n" -m 5 "http://127.0.0.1:${PORT}/api/health" || true
fi

echo
echo "=============================================="
echo " 部署完成"
echo "----------------------------------------------"
if [ "$TAKE_80" = "1" ]; then
  echo " 页面: http://<服务器IP>/"
  echo " 接口: http://<服务器IP>/api/health"
  echo " 只放行 80 即可，${PORT} 不必对外"
else
  echo " 访问: http://<服务器IP>:${PORT}/api/health"
  echo " 需在安全组放行 TCP ${PORT}"
fi
echo
echo " 客户端指向："
echo "   打包时 : VITE_API_BASE=http://<服务器IP>"
echo "   已安装 : localStorage.setItem('lyy_api_base','http://<服务器IP>') 后刷新"
echo
echo " 日志: journalctl -u ${SERVICE} -f"
echo " 回滚: bash ${ROLLBACK}"
echo "=============================================="
