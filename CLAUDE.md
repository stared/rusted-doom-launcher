# Doom WAD Launcher

Tauri 2 + Vue 3 + TypeScript app for launching GZDoom with community WADs.

## Key Takeaways

### Tauri 2 Permissions
- `fs:scope` with `**` allows files inside dir, but NOT `readDir()` on the dir itself - add path without `/**` too
- `shell:allow-spawn` for `Command.spawn()`, `shell:allow-execute` for `Command.execute()`
- Capabilities require Rust rebuild, not just HMR

### Error Handling
- Never catch and swallow errors silently
- Always show actual error messages, never generic "Failed" fallbacks
- Use `console.error()` AND display to user

### Debugging Tauri
- Run with `RUST_BACKTRACE=1 pnpm tauri dev`
- WebView DevTools: Cmd+Option+I
- Rust errors appear in terminal, JS errors in DevTools console

### YouTube Embeds in WKWebView
WKWebView (macOS) blocks autoplay unless triggered by a valid user gesture.

**What doesn't work:**
- `mouseenter` events - not considered a user gesture
- Async `playVideo()` calls - gesture expires after any `await`
- `autoplay=1` in iframe URL - blocked by same policy

**What works:**
- Pre-load YouTube iframes on component mount (hidden behind overlay)
- Call `playVideo()` synchronously in click handler
- Player must be fully ready before user clicks

**Implementation:** See `src/components/WadCard.vue`
- Load YouTube API on mount
- Create players immediately (visible, with play button overlay)
- Click → synchronous `playVideo()` → works!

### MCP Debugging (AI-assisted)
The app has `tauri-plugin-mcp` integrated for AI debugging via Claude Code.

**Available MCP tools:**
- `mcp__tauri-mcp__take_screenshot` - capture app window
- `mcp__tauri-mcp__execute_js` - run JS in webview, get results
- `mcp__tauri-mcp__get_dom` - get full HTML
- `mcp__tauri-mcp__get_element_position` - find elements, optionally click

**Setup:**
1. App must be running (`pnpm tauri dev`)
2. Frontend initializes listeners in `src/main.ts` (dev mode only)
3. MCP server config in `.mcp.json`

**Troubleshooting:**
- If tools timeout: ensure `setupPluginListeners()` is called in frontend
- Socket errors: remove stale socket file from `$TMPDIR/tauri-mcp.sock`
- Screenshot fails: ensure app window is visible (not minimized)

### Scripts
Python exploration scripts live in `scripts/`. Run with `uv run scripts/<script>.py`.
