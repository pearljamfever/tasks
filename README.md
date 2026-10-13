<h1>
  <img src="public/favicon.svg" width="36" height="36" alt="" align="top">
  Tasks
</h1>

A simple, self-hosted task manager for your home network. Tasks are cards, cards in the same category stack together, and short progress notes keep track of where each task stands.

[![Tests](https://github.com/pearljamfever/tasks/actions/workflows/test.yml/badge.svg)](https://github.com/pearljamfever/tasks/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/pearljamfever/tasks)](https://github.com/pearljamfever/tasks/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/board-dark.png">
  <img src="docs/screenshots/board-light.png" alt="The Tasks board: stacks of task cards by category, with a feed of updates on the right">
</picture>

## Features

- **Cards and stacks.** Each task is a card. Cards in the same category stack up, and clicking a stack spreads it out.
- **Progress notes.** Open a task to keep a running timeline of notes on how it's going.
- **Note commands.** Type `/` in a note:
  - `/task` posts the note to the **Feed** on the main page.
  - `/remind tue …` brings the note back to the top of the Feed on the day you pick.
  - `/waiting Sam: …` marks the task as waiting on someone, right on the card.
- **Categories.** Colors, renaming, and a list of completed tasks you can reopen.
- **Works everywhere.** Light and dark mode follow your device, and it works on phones.
- **Simple to run.** One small Node.js server with no dependencies and no database. Your data is one JSON file, backed up daily.
- **Private.** No accounts, no tracking, and nothing loaded from the internet.

## Screenshots

| | |
|:---:|:---:|
| <img src="docs/screenshots/task-light.png" alt="A task with its progress notes" width="420"><br>A task and its notes | <img src="docs/screenshots/commands-light.png" alt="The note command menu" width="420"><br>Note commands |
| <img src="docs/screenshots/spread-dark.png" alt="A stack spread out in dark mode" width="420"><br>A stack spread out (dark mode) | <img src="docs/screenshots/mobile-board-light.png" alt="The board on a phone" width="200"><br>On a phone |

## Install

You need a Linux machine with **systemd** (Ubuntu, Debian, Raspberry Pi OS, …). If it doesn't have Node.js 18 or newer, the installer downloads the current Node.js LTS for the app automatically, without changing the rest of your system.

```sh
git clone https://github.com/pearljamfever/tasks.git
cd tasks
./install
```

Then open the address it prints, e.g. `http://192.168.1.50:3100`. To use a different port: `./install --port 8080`.

The installer runs Tasks as its own locked-down service that starts on boot and keeps daily backups.

**To update later**, run `tasks update` from any folder. It shows the version you have and the newest one, lists what's new, then installs it. Your tasks are kept.

Just want to try it? If you have Node.js, `npm start` runs it on port 3100 from the downloaded folder, with no install.

> [!IMPORTANT]
> Tasks has **no login**: anyone who can reach it can see and edit everything. Run it on your home network only, and use a VPN (e.g. WireGuard or Tailscale) to reach it from outside, rather than opening it to the internet.

## Documentation

- **[Installing and running](INSTALL.md):** settings, upgrading, backups and restoring, uninstalling, security, troubleshooting
- **[Using Tasks](docs/USAGE.md):** tasks, note commands, the Feed, categories
- **[Changelog](CHANGELOG.md):** what changed in each version

## License

[MIT](LICENSE). The bundled [Inter](https://rsms.me/inter/) font is licensed separately under the [SIL Open Font License](public/fonts/LICENSE-Inter.txt).
