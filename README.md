# Rusted Doom Launcher

Classic Doom is timeless, but managing thousands of community-made WADs shouldn't be a chore. This launcher streamlines the chaos, letting you browse, preview, and launch mods instantly so you can focus on ripping and tearing.

![](./rusted_doom_launcher_screenshot.jpg)

## Features

- **Visual Browsing:** Explore WADs with embedded YouTube previews
- **Instant Action:** One-click launch with GZDoom
- **Mod Manager:** Download new WADs directly within the app
- **Stat Tracking:** Track your play stats per level

## Prerequisites

To run this application, you need:

- **[GZDoom](https://zdoom.org/downloads)** - Modern Doom source port
- **Original Doom WADs** - `DOOM.WAD` or `DOOM2.WAD` from [GOG.com](https://www.gog.com/en/game/doom_doom_ii) or [Steam](https://store.steampowered.com/app/2280/DOOM__DOOM_II/)
- **[pnpm](https://pnpm.io/)** - Node.js package manager
- **[Rust](https://rustup.rs/)** - Required for Tauri

## Development

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
