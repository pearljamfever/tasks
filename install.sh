#!/usr/bin/env bash
# Installs or upgrades Card Tasks as a systemd service.
#
#   sudo ./install.sh                 # install, or upgrade an existing install (data is kept)
#   sudo ./install.sh --port 8080     # choose the port (default 3100)
#
# Code goes to /opt/card-tasks, data to /var/lib/card-tasks, settings to /etc/card-tasks.env.
set -euo pipefail

APP_DIR=/opt/card-tasks
ENV_FILE=/etc/card-tasks.env
UNIT_FILE=/etc/systemd/system/card-tasks.service
SERVICE_USER=card-tasks
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=""

die() { echo "Error: $*" >&2; exit 1; }
say() { echo "==> $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done
if [ -n "$PORT" ]; then
  [[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "--port must be a number from 1 to 65535"
fi

# ---------- checks ----------
[ "$(id -u)" -eq 0 ] || die "run this as root, e.g. sudo ./install.sh"
command -v systemctl >/dev/null || die "systemd is required (systemctl not found)"
[ -f "$SRC_DIR/server.js" ] && [ -d "$SRC_DIR/public" ] || die "run this from inside the downloaded tasks folder"

NODE="$(command -v node || true)"
[ -n "$NODE" ] || die "Node.js 18 or newer is required. Install it from https://nodejs.org or your package manager, then re-run."
NODE="$(readlink -f "$NODE")"
"$NODE" -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' \
  || die "Node.js 18 or newer is required (found $("$NODE" --version))"
case "$NODE" in
  /root/*|/home/*) die "node is installed under a home folder ($NODE), which the sandboxed service can't read. Install Node.js system-wide (e.g. from your package manager or NodeSource) and re-run." ;;
esac

# ---------- user ----------
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  say "Creating system user $SERVICE_USER"
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# ---------- code ----------
UPGRADE=no
[ -d "$APP_DIR" ] && UPGRADE=yes
say "$( [ $UPGRADE = yes ] && echo Upgrading || echo Installing ) app files in $APP_DIR"
rm -rf "$APP_DIR.new"
mkdir -p "$APP_DIR.new"
cp -r "$SRC_DIR/server.js" "$SRC_DIR/package.json" "$SRC_DIR/public" "$APP_DIR.new/"
for f in README.md INSTALL.md LICENSE; do [ -f "$SRC_DIR/$f" ] && cp "$SRC_DIR/$f" "$APP_DIR.new/"; done
chown -R root:root "$APP_DIR.new"
chmod -R u=rwX,go=rX "$APP_DIR.new"
rm -rf "$APP_DIR.old"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$APP_DIR.old"
mv "$APP_DIR.new" "$APP_DIR"
rm -rf "$APP_DIR.old"

# ---------- settings ----------
if [ ! -f "$ENV_FILE" ]; then
  say "Writing settings to $ENV_FILE"
  cat > "$ENV_FILE" <<EOF
# Card Tasks settings. Restart after changing: sudo systemctl restart card-tasks
PORT=${PORT:-3100}

# Extra names the app may be opened as, comma-separated (IP addresses, localhost
# and this machine's hostname always work). Example: ALLOWED_HOSTS=tasks.home
ALLOWED_HOSTS=

# How many daily backups to keep in /var/lib/card-tasks/backups
KEEP_BACKUPS=30
EOF
  chmod 644 "$ENV_FILE"
elif [ -n "$PORT" ]; then
  say "Setting PORT=$PORT in $ENV_FILE"
  if grep -q '^PORT=' "$ENV_FILE"; then sed -i "s/^PORT=.*/PORT=$PORT/" "$ENV_FILE"; else echo "PORT=$PORT" >> "$ENV_FILE"; fi
fi

# ---------- service ----------
say "Installing systemd service"
sed "s#@NODE@#$NODE#" "$SRC_DIR/deploy/card-tasks.service" > "$UNIT_FILE"
systemctl daemon-reload
systemctl enable card-tasks >/dev/null 2>&1
systemctl restart card-tasks

# ---------- check ----------
PORT_NOW="$(sed -n 's/^PORT=\([0-9]*\).*/\1/p' "$ENV_FILE" | tail -1)"
PORT_NOW="${PORT_NOW:-3100}"
# Healthy means the app answers on its port (or, without curl, the service is still up after a few seconds).
healthy=no
for _ in $(seq 1 20); do
  if command -v curl >/dev/null; then
    curl -fsS "http://127.0.0.1:$PORT_NOW/healthz" >/dev/null 2>&1 && { healthy=yes; break; }
  else
    sleep 4; systemctl is-active --quiet card-tasks && healthy=yes; break
  fi
  sleep 0.5
done
if [ "$healthy" != yes ]; then
  log="$(journalctl -u card-tasks -n 30 --no-pager 2>/dev/null || true)"
  if grep -q -e EADDRINUSE -e "already in use" <<<"$log"; then
    systemctl stop card-tasks || true
    die "port $PORT_NOW is already in use by another program. Pick another: sudo ./install.sh --port 8080"
  fi
  echo "$log" >&2
  die "the service didn't start; see the log above"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
say "Card Tasks is running."
echo "    Open:      http://${IP:-localhost}:$PORT_NOW"
echo "    Settings:  $ENV_FILE"
echo "    Data:      /var/lib/card-tasks  (daily backups in backups/)"
echo "    Logs:      journalctl -u card-tasks -e"
