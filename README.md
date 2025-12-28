# Rusted Doom Launcher

Classic Doom is timeless, but managing thousands of community-made WADs shouldn't be a chore. This launcher streamlines the chaos, letting you browse, preview, and launch mods instantly so you can focus on ripping and tearing.

![](./rusted_doom_launcher_screenshot.jpg)

## Download

Get the latest release from [GitHub Releases](https://github.com/stared/rusted-doom-launcher/releases).

### macOS

1. Download the `.dmg` file
2. Open the `.dmg` and drag the app to Applications
3. **First launch (required):** macOS Sequoia blocks unsigned apps. Open Terminal and run:
   ```
   xattr -cr /Applications/Rusted\ Doom\ Launcher.app
   ```
4. Now open the app normally

### Windows

Download and run the `.exe` installer.

### Linux

Download `.AppImage`, make it executable (`chmod +x`), and run. Or install the `.deb` package.

## Requirements

- **[GZDoom](https://zdoom.org/downloads)** - Install separately
- **DOOM.WAD or DOOM2.WAD** - From [GOG](https://www.gog.com/en/game/doom_doom_ii) or [Steam](https://store.steampowered.com/app/2280/DOOM__DOOM_II/)

## Features

- **Visual Browsing:** Explore WADs with embedded YouTube previews
- **Instant Action:** One-click launch with GZDoom
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
