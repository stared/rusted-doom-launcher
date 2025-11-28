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
