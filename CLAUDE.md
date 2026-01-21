# Doom WAD Launcher

Tauri 2 + Vue 3 + TypeScript app for launching Doom source ports (UZDoom/GZDoom) with community WADs.

## Key Takeaways

### Tauri 2 Permissions
- `fs:scope` with `**` allows files inside dir, but NOT `readDir()` on the dir itself - add path without `/**` too
- `shell:allow-spawn` for `Command.spawn()`, `shell:allow-execute` for `Command.execute()`
- Capabilities require Rust rebuild, not just HMR

### Error Handling
- Never catch and swallow errors silently
- Always show actual error messages, never generic "Failed" fallbacks
- Use `console.error()` AND display to user

### File Safety
- **NEVER use `rm -rf`** - always use `mv` to move files to a backup location instead of deleting
- When testing or debugging, preserve original data by moving, not deleting

### Debugging Tauri
- Run with `RUST_BACKTRACE=1 pnpm tauri dev`
- WebView DevTools: Cmd+Option+I
- Rust errors appear in terminal, JS errors in DevTools console

### MCP Debugging (AI-assisted)

Uses [hypothesi/mcp-server-tauri](https://github.com/hypothesi/mcp-server-tauri) for AI debugging via Claude Code.

**Setup:**
1. App must be running (`pnpm tauri dev`)
2. Wait for log: `[MCP][WS_SERVER][INFO] WebSocket server listening on: 0.0.0.0:9223`
3. In Claude Code, run `/mcp` to verify `tauri-mcp` shows "connected"

**Key MCP Tools:**
```
mcp__tauri-mcp__driver_session      - start/stop/status of connection
mcp__tauri-mcp__webview_screenshot  - capture app window
mcp__tauri-mcp__webview_dom_snapshot - get accessibility tree (use type="accessibility")
mcp__tauri-mcp__webview_execute_js  - run JS in webview
mcp__tauri-mcp__webview_interact    - click, scroll, focus elements
mcp__tauri-mcp__webview_keyboard    - type text, send keys
mcp__tauri-mcp__read_logs           - get console logs (source="console")
```

**Workflow:**
1. `driver_session` with `action: "start"` to connect
2. `webview_screenshot` to see current state
3. `webview_dom_snapshot` with `type: "accessibility"` to get element refs
4. `webview_execute_js` to click/interact (CSS selectors don't always work)

**Troubleshooting:**
- "Connection refused": App not running or plugin not initialized
- Tools not available: Restart Claude Code session after `.mcp.json` changes
- Permission errors: Ensure `mcp-bridge:default` in `capabilities/default.json`

### Releasing

To create a release, push a version tag:
```bash
git tag v0.1.6
git push origin v0.1.6
```

This triggers `.github/workflows/release.yml` which:
1. Builds the macOS app (aarch64)
2. Creates a **draft** GitHub release with the DMG
3. Go to GitHub Releases to publish the draft

### Scripts
Python exploration scripts live in `scripts/`. Run with `uv run scripts/<script>.py`.

### Gemini API
**NEVER use Gemini 2.0 Flash or Gemini 2.5 Flash.** These are outdated models.

Always use **Gemini 3 Flash** (`gemini-3-flash-preview`) or newer. Model config is in `scripts/config.json`.
