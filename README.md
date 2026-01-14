# Rusted Doom Launcher

Classic Doom is timeless, but managing thousands of community-made WADs shouldn't be a chore. This launcher streamlines the chaos, letting you browse, preview, and launch mods instantly so you can focus on ripping and tearing.

![](./rusted_doom_launcher_screenshot.jpg)

## Requirements

- **[UZDoom](https://github.com/UZDoom/UZDoom/releases)** or **[GZDoom](https://github.com/ZDoom/gzdoom/releases)** - modern Doom source ports
- **DOOM.WAD or DOOM2.WAD** - game data from [GOG](https://www.gog.com/en/game/doom_doom_ii) or Steam

## Install

### macOS (Homebrew)

The easiest way:

```bash
brew install --cask gzdoom  # or uzdoom
brew install stared/doom/rusted-doom-launcher
```

Then run with `rusted-doom-launcher` or open the app from `/opt/homebrew/opt/rusted-doom-launcher/`.

### macOS (Manual Download)

Get the `.dmg` from [GitHub Releases](https://github.com/stared/rusted-doom-launcher/releases).

1. Download and open the `.dmg`, drag app to Applications
2. Install [UZDoom](https://github.com/UZDoom/UZDoom/releases) or [GZDoom](https://github.com/ZDoom/gzdoom/releases) separately
3. **First launch:** The app is not signed with an Apple certificate. Open Terminal and run:
   ```
   xattr -cr /Applications/Rusted\ Doom\ Launcher.app
   ```
4. Open the app

## Features

- **Visual Browsing:** Explore WADs with embedded YouTube previews
- **Instant Action:** One-click launch with UZDoom/GZDoom
- **Mod Manager:** Download new WADs directly within the app
- **Stat Tracking:** Track your play stats per level

## Development

To build from source, you need [pnpm](https://pnpm.io/) and [Rust](https://rustup.rs/).

Install dependencies and run:

```bash
pnpm install
pnpm tauri dev
```

Build for production:

```bash
pnpm tauri build
```

## Tech

- [Tauri 2](https://v2.tauri.app/) (its in Rust, hence the project name)
- [Vue 3](https://vuejs.org/) in TypeScript
- Python scripts for some processing
- Claude Code and Gemini for vibe coding

## Author

[Piotr Migdal](https://p.migdal.pl)

## License

MIT
