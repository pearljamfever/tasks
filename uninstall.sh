#!/usr/bin/env bash
# Removes the Card Tasks service and app files.
#
#   sudo ./uninstall.sh           # remove the app; keep your data and settings
#   sudo ./uninstall.sh --purge   # also delete all tasks, backups, settings and the service user
set -euo pipefail

PURGE=no
case "${1:-}" in
  "") ;;
  --purge) PURGE=yes ;;
  -h|--help) sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "Error: unknown option: $1 (try --help)" >&2; exit 1 ;;
esac
[ "$(id -u)" -eq 0 ] || { echo "Error: run this as root, e.g. sudo ./uninstall.sh" >&2; exit 1; }

if [ "$PURGE" = yes ]; then
  read -r -p "This permanently deletes all tasks, notes and backups in /var/lib/card-tasks. Type DELETE to confirm: " answer
  [ "$answer" = DELETE ] || { echo "Cancelled; nothing was removed."; exit 1; }
fi

echo "==> Stopping and removing the service"
systemctl disable --now card-tasks >/dev/null 2>&1 || true
rm -f /etc/systemd/system/card-tasks.service
systemctl daemon-reload
systemctl reset-failed card-tasks >/dev/null 2>&1 || true

echo "==> Removing /opt/card-tasks"
rm -rf /opt/card-tasks

if [ "$PURGE" = yes ]; then
  echo "==> Deleting data, settings and the service user"
  rm -rf /var/lib/card-tasks /var/lib/private/card-tasks /etc/card-tasks.env
  userdel card-tasks >/dev/null 2>&1 || true
  echo "Card Tasks has been removed completely."
else
  echo
  echo "Card Tasks has been removed. Your data was kept:"
  echo "    Tasks and backups:  /var/lib/card-tasks"
  echo "    Settings:           /etc/card-tasks.env"
  echo "Reinstalling picks them up again. To delete them too, run: sudo ./uninstall.sh --purge"
fi
