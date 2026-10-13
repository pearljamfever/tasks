<!--
  PLACEHOLDER FRONT PAGE: replace this file with the real front page.
  Links worth keeping on the real one:
    - INSTALL.md               full install, settings, upgrade, backup and security guide
    - docs/USAGE.md            how to use the app (tasks, note commands, feed, categories)
    - docs/screenshots/        screenshots made with demo data (light and dark, desktop and phone)
    - LICENSE                  MIT
-->

# Tasks

A simple, self-hosted task manager for your home network. Tasks are cards, cards in the same category stack together, and progress notes keep track of where each task is.

![Tasks](docs/screenshots/board-light.png)

## Install

On a Linux machine with systemd and Node.js 18 or newer:

```sh
git clone https://github.com/pearljamfever/tasks.git
cd tasks
sudo ./install.sh
```

Then open the address it prints. See **[INSTALL.md](INSTALL.md)** for settings, upgrading, backups, security and troubleshooting.

## Documentation

- [Installing and running](INSTALL.md)
- [Using Tasks](docs/USAGE.md)

## License

[MIT](LICENSE). The bundled [Inter](https://rsms.me/inter/) font is licensed separately under the [SIL Open Font License](public/fonts/LICENSE-Inter.txt).
