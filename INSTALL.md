# Installing Card Tasks

Card Tasks is a single small Node.js server with no dependencies. It's meant to run on a machine on your **home network**, such as a home server, a Raspberry Pi or a small VM. **It has no login**: anyone who can reach it on the network can see and edit the tasks. Don't expose it to the internet.

- [Requirements](#requirements)
- [Install (Linux with systemd)](#install-linux-with-systemd)
- [Settings](#settings)
- [Upgrading](#upgrading)
- [Backups and restoring](#backups-and-restoring)
- [Uninstalling](#uninstalling)
- [Running it without the installer](#running-it-without-the-installer)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## Requirements

- Linux with **systemd** (Ubuntu, Debian, Raspberry Pi OS, Fedora, and most others).
- **Node.js 18 or newer**, installed system-wide. Check with `node --version`.
  - On Ubuntu/Debian, the [NodeSource packages](https://github.com/nodesource/distributions) give you a current version.
  - Node installed with `nvm` lives in your home folder, which the sandboxed service can't read. Install it system-wide instead.
- `git` to download it (or download the ZIP from GitHub).

## Install (Linux with systemd)

```sh
git clone https://github.com/pearljamfever/tasks.git
cd tasks
sudo ./install.sh
```

Then open the address it prints, e.g. `http://192.168.1.50:3100`.

To use a different port: `sudo ./install.sh --port 8080`.

The installer:

1. Creates a `card-tasks` system user to run the app (not root).
2. Copies the app to `/opt/card-tasks`.
3. Writes your settings to `/etc/card-tasks.env` (only the first time).
4. Installs and starts the `card-tasks` systemd service, which starts on boot and restarts itself if it stops.

Your tasks are stored in `/var/lib/card-tasks`.

Day to day:

```sh
systemctl status card-tasks         # is it running?
sudo systemctl restart card-tasks   # restart (e.g. after changing settings)
journalctl -u card-tasks -e         # logs, newest at the bottom
curl localhost:3100/healthz         # health check: {"ok":true,"tasks":N}
```

## Settings

Settings live in `/etc/card-tasks.env`. Restart after changing them: `sudo systemctl restart card-tasks`.

| Setting | Default | What it does |
|---|---|---|
| `PORT` | `3100` | The port to listen on. |
| `ALLOWED_HOSTS` | *(empty)* | Extra names the app may be opened as, comma-separated, e.g. `tasks.home,tasks.lan`. IP addresses, `localhost` and the machine's own hostname (and `hostname.local`) always work. See [Security](#security) for why. |
| `KEEP_BACKUPS` | `30` | How many daily backups to keep. |

## Upgrading

```sh
cd tasks
git pull
sudo ./install.sh
```

The installer replaces the app files and restarts the service. Your tasks, backups and settings are kept.

## Backups and restoring

- **Automatic daily backups.** Each day that something changes, a copy of the data is saved to `/var/lib/card-tasks/backups/data-YYYY-MM-DD.json`. The newest `KEEP_BACKUPS` days are kept.
- **Crash-safe saving.** A power cut mid-save leaves either the old or the new data, never a half-written file.
- **Self-repair.** If `data.json` can't be read at startup, the app moves it aside as `data.json.corrupt-<timestamp>`, loads the newest readable backup, and says so in the log.
- **Keep a copy elsewhere.** The automatic backups are on the same machine. Copy `/var/lib/card-tasks/backups/` to another machine now and then.

**To restore a backup:**

```sh
sudo systemctl stop card-tasks
sudo cp /var/lib/card-tasks/backups/data-2026-10-11.json /var/lib/card-tasks/data.json
sudo chown card-tasks:card-tasks /var/lib/card-tasks/data.json
sudo systemctl start card-tasks
```

This replaces the current data with the backup, so anything added since then is lost. Copy `data.json` somewhere first if you might want it back.

**To move to another machine:** install Card Tasks there, then copy `/var/lib/card-tasks/data.json` across the same way.

## Uninstalling

```sh
sudo ./uninstall.sh            # removes the app and service; keeps your data and settings
sudo ./uninstall.sh --purge    # also deletes all tasks, backups, settings and the service user
```

`--purge` asks you to type `DELETE` to confirm. Reinstalling after a plain uninstall picks your data back up.

## Running it without the installer

To try it out, or on a system without systemd:

```sh
git clone https://github.com/pearljamfever/tasks.git
cd tasks
npm start
```

It runs on port 3100 and keeps its data in `./data` inside the folder. The same settings work as environment variables, plus two more:

| Variable | Default | What it does |
|---|---|---|
| `DATA_DIR` | `./data` | Where tasks and backups are stored. |
| `HOST` | `0.0.0.0` | The address to listen on. Use `127.0.0.1` to allow this machine only. |

Example: `PORT=8080 DATA_DIR=/srv/tasks npm start`.

Without the installer you don't get the dedicated user, the sandboxing, or starting on boot.

## Security

Card Tasks is built for a trusted home network, and it has **no login**. With that in mind, it does the following:

- **Other websites can't change your tasks.** Changes are accepted only from the app's own page. A malicious site open in your browser can't add, edit or delete anything.
- **Only known addresses are answered.** Requests that use an unknown host name are refused, which blocks "DNS rebinding" attacks. If you open the app by a custom name, add it to `ALLOWED_HOSTS`.
- **Nothing is loaded from the internet.** The page, font and icons are all served by the app itself, and a strict Content Security Policy tells the browser to run only the app's own code.
- **The service is sandboxed.** It runs as its own user, can write only to `/var/lib/card-tasks`, can't see home folders, and can't gain privileges. `systemd-analyze security card-tasks` rates it about 1.5 ("OK").
- **Bad input can't crash it.** The server limits request sizes and rejects malformed requests.

If you want to reach it from outside your home, use a VPN such as WireGuard or Tailscale rather than opening a port on your router.

## Troubleshooting

**The page says `Unknown host "…"` (error 421).**
You opened the app under a name it doesn't know. Add the name to `ALLOWED_HOSTS` in `/etc/card-tasks.env` and restart.

**The installer says the service didn't start.** The installer prints the log. Common causes:
- **The port is in use.** You'll see `EADDRINUSE`. Pick another with `sudo ./install.sh --port 8080`.
- **Node.js is too old or missing.** The installer checks for this and tells you.

**I can't reach it from another device.**
Check the machine's firewall allows the port, e.g. `sudo ufw allow 3100/tcp`.

**"Can't reach the server. Nothing was saved."**
The browser lost its connection to the app. Check that the service is running (`systemctl status card-tasks`), then try again.

## Development

```sh
npm start     # run locally on port 3100, data in ./data
npm test      # run the test suite (uses a throwaway data folder, never ./data)
```

Project layout:

| Path | What it is |
|---|---|
| `server.js` | The server: API, storage, backups, security checks |
| `public/` | The web page: `index.html`, `app.css`, `app.js`, the Inter font and the icon |
| `test/` | Tests, run with Node's built-in test runner |
| `deploy/card-tasks.service` | The systemd service the installer sets up |
| `install.sh`, `uninstall.sh` | Installer and uninstaller |
| `docs/` | User guide and screenshots |

There are no dependencies and no build step: edit the files and reload the page (restart the server after changing `server.js`).

**Adding a note command.** Commands are listed in `KINDS` in `public/app.js` (name, label, icon and color). A new command also needs:
- what happens when a note is posted with it: `addNote` in `public/app.js`, and the comment `POST` handler in `server.js`, where it must also be added to the server's `KINDS` list;
- its tag in the task's notes: `noteTag` in `public/app.js`.
