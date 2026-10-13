# Changelog

What changed in each version of Tasks. Versions follow [semantic versioning](https://semver.org): bug fixes bump the last number, new features the middle one, and changes that break existing installs the first.

To update an install, run `tasks update`. Your tasks are kept. (Installs from before 1.3.0 don't have that command yet: in the downloaded folder, run `git pull` and then `sudo ./install.sh` once.)

## [1.4.0] - 2026-10-13

### Added
- **Pull to refresh** in the home-screen app on iPhone: pull down at the top of the board and let go to reload. (In a normal browser tab, the browser's own pull-to-refresh is used.)

### Fixed
- Phones and iPads no longer zoom in when you tap a text box, such as when adding a category. Text boxes are now 16px on touch screens.

## [1.3.0] - 2026-10-13

### Added
- **`tasks update`** updates to the newest version from any folder. It shows the installed and newest versions and what's new, then installs it. `--check` only shows the versions. `./update` in the downloaded folder does the same.
- **A `tasks` command** for day-to-day use: `tasks version`, `tasks status`, `tasks logs`, `tasks restart` and `tasks uninstall`.

### Changed
- **Simpler install:** `./install` replaces `sudo ./install.sh`, and asks for your password itself. Likewise `./uninstall` replaces `sudo ./uninstall.sh`.
- The installer shows which version it installed.

## [1.2.0] - 2026-10-13

### Added
- **Home screen icon.** Adding Tasks to a phone's home screen now uses the app's logo. On iPhone (Safari's "Add to Home Screen") it also opens full-screen like an app, without the browser's address bar. On Android, Chrome's "Add to Home screen" uses the logo too.

## [1.1.0] - 2026-10-13

### Added
- **The installer sets up Node.js for you.** If the machine has no Node.js 18 or newer, `install.sh` downloads the current Node.js LTS from nodejs.org, checks it against the published checksum, and keeps it in `/opt/tasks/node` for this app only. Re-running the installer updates it to the newest LTS.
- If there's no `curl` or `wget` to download with, the installer installs `curl` with the system package manager.
- New installer options: `--bundled-node` always uses the app's own Node.js, and `--system-node` always uses the system's.

### Changed
- The installer's final health check uses Node.js instead of `curl`.
- New README front page, with a features list, light and dark screenshots, and a quick install.

### Fixed
- GitHub now recognizes the license as MIT.

## [1.0] - 2026-10-13

First release.

[1.4.0]: https://github.com/pearljamfever/tasks/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/pearljamfever/tasks/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/pearljamfever/tasks/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/pearljamfever/tasks/compare/v1.0...v1.1.0
[1.0]: https://github.com/pearljamfever/tasks/releases/tag/v1.0
