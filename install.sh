#!/usr/bin/env bash
# Installs or upgrades Tasks as a systemd service.
#
#   sudo ./install.sh                 # install, or upgrade an existing install (data is kept)
#   sudo ./install.sh --port 8080     # choose the port (default 3100)
#   sudo ./install.sh --bundled-node  # always use the app's own Node.js from nodejs.org
#   sudo ./install.sh --system-node   # always use the system's Node.js (18 or newer)
#
# Code goes to /opt/tasks, data to /var/lib/tasks, settings to /etc/tasks.env.
# Without a system-wide Node.js 18+, the current Node.js LTS is downloaded into /opt/tasks/node.
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
NODE_MODE=auto
NODE_DIR="$APP_DIR/node"
NODE_STAGE=""

die() { echo "Error: $*" >&2; exit 1; }
say() { echo "==> $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    --bundled-node) NODE_MODE=bundled; shift ;;
    --system-node) NODE_MODE=system; shift ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

# ---------- Node.js ----------
# Prefer a system-wide Node.js 18+. Otherwise (or with --bundled-node) download the current
# Node.js LTS from nodejs.org into $NODE_DIR, used only by this app. Everything is downloaded
# and checked before anything on the system is changed.

# Prints the path of a system-wide node the sandboxed service can use, or fails.
usable_system_node() {
  local n
  n="$(command -v node || true)"; [ -n "$n" ] || return 1
  n="$(readlink -f "$n")"
  case "$n" in /root/*|/home/*|"$APP_DIR"/*) return 1 ;; esac  # the service can't read home folders
  "$n" -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' >/dev/null 2>&1 || return 1
  echo "$n"
}

pkg_install() {
  if command -v apt-get >/dev/null; then apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null
  elif command -v dnf >/dev/null; then dnf install -y -q "$@"
  elif command -v yum >/dev/null; then yum install -y -q "$@"
  elif command -v zypper >/dev/null; then zypper --non-interactive --quiet install "$@"
  elif command -v pacman >/dev/null; then pacman -Sy --noconfirm --needed "$@"
  else die "no supported package manager found to install: $*. Install it yourself and re-run."
  fi
}

# fetch URL [FILE]: download to FILE, or to stdout without one.
fetch() {
  if command -v curl >/dev/null; then
    if [ -n "${2:-}" ]; then curl -fsSL --retry 2 -o "$2" "$1"; else curl -fsSL --retry 2 "$1"; fi
  else
    wget -q -O "${2:--}" "$1"
  fi
}

case "$NODE_MODE" in
  system)
    NODE="$(usable_system_node)" || die "--system-node: no system-wide Node.js 18 or newer found (one under /root or /home can't be used)." ;;
  auto)
    # Keep using the app's own Node.js if an earlier install set it up.
    if [ ! -x "$NODE_DIR/bin/node" ] && NODE="$(usable_system_node)"; then :; else NODE_MODE=bundled; fi ;;
esac

if [ "$NODE_MODE" = bundled ]; then
  case "$(uname -m)" in
    x86_64) ARCH=x64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    armv7l) ARCH=armv7l ;;
    *) die "nodejs.org has no Node.js build for this CPU ($(uname -m)). Install Node.js 18 or newer yourself and re-run." ;;
  esac
  if ! command -v curl >/dev/null && ! command -v wget >/dev/null; then
    say "Installing curl (needed to download Node.js)"
    pkg_install curl ca-certificates
  fi
  for tool in tar gzip sha256sum; do command -v "$tool" >/dev/null || die "$tool is required to install Node.js"; done

  # The newest LTS release is the first "lts" entry in nodejs.org's release index.
  index="$(fetch https://nodejs.org/dist/index.json 2>/dev/null || true)"
  NODE_VER="$(grep -m1 '"lts":"' <<<"$index" | sed 's/.*"version":"\(v[0-9.]*\)".*/\1/' || true)"
  CUR_VER="$("$NODE_DIR/bin/node" --version 2>/dev/null || true)"
  if [[ ! "$NODE_VER" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    [ -n "$CUR_VER" ] || die "couldn't reach nodejs.org to download Node.js. Check the internet connection, or install Node.js 18 or newer yourself and re-run."
    say "Couldn't check nodejs.org for a newer Node.js; keeping $CUR_VER"
    NODE_VER="$CUR_VER"
  fi
  if [ "$CUR_VER" = "$NODE_VER" ]; then
    say "Using the app's own Node.js $NODE_VER"
  else
    say "Downloading Node.js $NODE_VER (LTS) from nodejs.org"
    NODE_STAGE="$(mktemp -d)"
    trap 'rm -rf "$NODE_STAGE"' EXIT
    tarball="node-$NODE_VER-linux-$ARCH.tar.gz"
    fetch "https://nodejs.org/dist/$NODE_VER/$tarball" "$NODE_STAGE/$tarball" || die "couldn't download $tarball"
    fetch "https://nodejs.org/dist/$NODE_VER/SHASUMS256.txt" "$NODE_STAGE/SHASUMS256.txt" || die "couldn't download the Node.js checksums"
    (cd "$NODE_STAGE" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c --quiet - >/dev/null 2>&1) \
      || die "the Node.js download didn't match its published checksum; not installing it."
    mkdir "$NODE_STAGE/node"
    tar -xzf "$NODE_STAGE/$tarball" -C "$NODE_STAGE/node" --strip-components=1 --no-same-owner
    "$NODE_STAGE/node/bin/node" --version >/dev/null 2>&1 || die "the downloaded Node.js doesn't run on this system. Install Node.js 18 or newer yourself and re-run."
  fi
  NODE="$NODE_DIR/bin/node"
fi

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
if [ "$NODE_MODE" = bundled ]; then
  if [ -n "$NODE_STAGE" ]; then mv "$NODE_STAGE/node" "$APP_DIR.new/node"; else cp -a "$NODE_DIR" "$APP_DIR.new/node"; fi
fi
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
# Healthy means the app answers on its port. Node does the check, so no other tools are needed.
healthy=no
for _ in $(seq 1 20); do
  if "$NODE" -e "require('http').get('http://127.0.0.1:$PORT_NOW/healthz', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" >/dev/null 2>&1; then
    healthy=yes; break
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
if [ "$NODE_MODE" = bundled ]; then
  echo "    Node.js:   $("$NODE" --version), the app's own copy in $NODE_DIR (re-run the installer to update it)"
else
  echo "    Node.js:   $("$NODE" --version) from $NODE"
fi
