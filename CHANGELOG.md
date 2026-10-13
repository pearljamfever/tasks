# Changelog

What changed in each version of Tasks. Versions follow [semantic versioning](https://semver.org): bug fixes bump the last number, new features the middle one, and changes that break existing installs the first.

To update an install, run `git pull` then `sudo ./install.sh` in the downloaded folder. Your tasks are kept.

## [1.2.0] - 2026-10-13

### Added
- **Home screen icon.** Adding Tasks to a phone's home screen (Safari's "Add to Home Screen" on iPhone, or "Install app" on Android) now uses the app's logo, and it opens full-screen like an app, without the browser's address bar.

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

[1.2.0]: https://github.com/pearljamfever/tasks/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/pearljamfever/tasks/compare/v1.0...v1.1.0
[1.0]: https://github.com/pearljamfever/tasks/releases/tag/v1.0
