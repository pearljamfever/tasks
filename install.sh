#!/usr/bin/env bash
# Installs or upgrades Tasks as a systemd service.
#
#   sudo ./install.sh                 # install, or upgrade an existing install (data is kept)
#   sudo ./install.sh --port 8080     # choose the port (default 3100)
#
# Code goes to /opt/tasks, data to /var/lib/tasks, settings to /etc/tasks.env.
set -euo pipefail

APP_DIR=/opt/tasks
ENV_FILE=/etc/tasks.env
UNIT_FILE=/etc/systemd/system/tasks.service
SERVICE_USER=tasks
DATA_DIR=/var/lib/tasks
# "tasks" is a common name, so everything this script creates is marked, and it refuses to
# take over a user, folder, settings file or service of that name that something else made.
USER_COMMENT="Tasks app service user"
APP_MARK=.installed-by-tasks-app
FILE_MARK="Tasks app"
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

# ---------- don't take over anything that isn't ours ----------
if id "$SERVICE_USER" >/dev/null 2>&1; then
  [ "$(getent passwd "$SERVICE_USER" | cut -d: -f5)" = "$USER_COMMENT" ] \
    || die "a user named '$SERVICE_USER' already exists and wasn't created by this installer. Not touching it."
elif [ -e "$DATA_DIR" ]; then
  die "$DATA_DIR already exists but wasn't created by this installer. Not touching it."
fi
[ ! -e "$APP_DIR" ] || [ -f "$APP_DIR/$APP_MARK" ] \
  || die "$APP_DIR already exists but wasn't created by this installer. Not touching it."
[ ! -e "$UNIT_FILE" ] || grep -q "$FILE_MARK" "$UNIT_FILE" \
  || die "$UNIT_FILE already exists but wasn't created by this installer. Not touching it."
[ ! -e "$ENV_FILE" ] || grep -q "$FILE_MARK" "$ENV_FILE" \
  || die "$ENV_FILE already exists but wasn't created by this installer. Not touching it."

# ---------- user ----------
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  say "Creating system user $SERVICE_USER"
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --comment "$USER_COMMENT" "$SERVICE_USER"
fi

# ---------- code ----------
UPGRADE=no
[ -d "$APP_DIR" ] && UPGRADE=yes
say "$( [ $UPGRADE = yes ] && echo Upgrading || echo Installing ) app files in $APP_DIR"
rm -rf "$APP_DIR.new"
mkdir -p "$APP_DIR.new"
cp -r "$SRC_DIR/server.js" "$SRC_DIR/package.json" "$SRC_DIR/public" "$APP_DIR.new/"
for f in README.md INSTALL.md LICENSE; do [ -f "$SRC_DIR/$f" ] && cp "$SRC_DIR/$f" "$APP_DIR.new/"; done
echo "Installed by the Tasks app installer (https://github.com/pearljamfever/tasks)" > "$APP_DIR.new/$APP_MARK"
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
# Tasks app settings. Restart after changing: sudo systemctl restart tasks
PORT=${PORT:-3100}

# Extra names the app may be opened as, comma-separated (IP addresses, localhost
# and this machine's hostname always work). Example: ALLOWED_HOSTS=tasks.home
ALLOWED_HOSTS=

# How many daily backups to keep in /var/lib/tasks/backups
KEEP_BACKUPS=30
EOF
  chmod 644 "$ENV_FILE"
elif [ -n "$PORT" ]; then
  say "Setting PORT=$PORT in $ENV_FILE"
  if grep -q '^PORT=' "$ENV_FILE"; then sed -i "s/^PORT=.*/PORT=$PORT/" "$ENV_FILE"; else echo "PORT=$PORT" >> "$ENV_FILE"; fi
fi

# ---------- service ----------
say "Installing systemd service"
sed "s#@NODE@#$NODE#" "$SRC_DIR/deploy/tasks.service" > "$UNIT_FILE"
systemctl daemon-reload
systemctl enable tasks >/dev/null 2>&1
systemctl restart tasks

# ---------- check ----------
PORT_NOW="$(sed -n 's/^PORT=\([0-9]*\).*/\1/p' "$ENV_FILE" | tail -1)"
PORT_NOW="${PORT_NOW:-3100}"
# Healthy means the app answers on its port (or, without curl, the service is still up after a few seconds).
healthy=no
for _ in $(seq 1 20); do
  if command -v curl >/dev/null; then
    curl -fsS "http://127.0.0.1:$PORT_NOW/healthz" >/dev/null 2>&1 && { healthy=yes; break; }
  else
    sleep 4; systemctl is-active --quiet tasks && healthy=yes; break
  fi
  sleep 0.5
done
if [ "$healthy" != yes ]; then
  log="$(journalctl -u tasks -n 30 --no-pager 2>/dev/null || true)"
  if grep -q -e EADDRINUSE -e "already in use" <<<"$log"; then
    systemctl stop tasks || true
    die "port $PORT_NOW is already in use by another program. Pick another: sudo ./install.sh --port 8080"
  fi
  echo "$log" >&2
  die "the service didn't start; see the log above"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
say "Tasks is running."
echo "    Open:      http://${IP:-localhost}:$PORT_NOW"
echo "    Settings:  $ENV_FILE"
echo "    Data:      $DATA_DIR  (daily backups in backups/)"
echo "    Logs:      journalctl -u tasks -e"
