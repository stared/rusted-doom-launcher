# Changelog

## Unreleased — 2026-10-17 — `feature/doomlauncher-import-and-tags`

### `0e1c10d` — 2026-08-30 — DoomLauncher database import, tags, and Play tabs

- Added a native SQLite reader for DoomLauncher libraries, including cross-platform path remapping and file verification before import.
- Added the DoomLauncher import wizard, with controls for importing WADs, metadata, tags, saves, and play statistics.
- Added Play category tabs, tag filtering, tag chips on cards, and tag editing in the custom-WAD editor.
- Added remote image resolution and caching, plus the underlying play-session data used by the library views.
- Expanded the Play grid up to six columns on very wide displays.

### `96dc558` — 2026-08-30 — Startup and UI polish

- Added a consistent dark application surface, persisted window state, and smoother startup/loading behavior.
- Increased card space and adjusted responsive grid styling for larger libraries and high-resolution displays.
- Improved level-name and play-stat loading behavior during startup.

### `8b93103` — 2026-09-08 — Ratings and import refinements

- Added persistent zero-to-five star ratings for catalog and imported WADs.
- Added rating controls to Play, Explore, and Mods cards.
- Extended DoomLauncher import data handling and related application settings so imported library information remains usable after migration.
- Refined custom-WAD editing and launch-related UX.

### `59f7a43` — 2026-09-11 — Preserve the Play view and merge duplicate imports

- Kept the Play view alive while navigating to other views, preserving its filters and avoiding an unnecessary rebuild on return.
- Standardized view conditionals in the application shell.
- Added `scripts/merge_duplicate_imports.py` for consolidating duplicate DoomLauncher imports while preserving user data.

### `9097b50` — 2026-09-28 — Archive inspection and safer game-file handling

- Added an archive viewer for reading text files bundled in mod archives.
- Added ZIP inspection and extraction for primary WAD/PK3 files and required companion resources.
- Prevented direct ZIP launching; game files are extracted first so GZDoom and UZDoom receive supported paths.
- Improved custom-mod import validation and added manual engine-path entry and validation in Settings.

### `5313f9f` — 2026-09-28 — Load history only where it is needed

- Added shared completed and in-flight session caches so Play, Runs, and Logs do not reread the same history files.
- Restricted history hydration and Runs/Logs filesystem work to downloaded or custom WADs instead of probing the entire catalog.
- Simplified play-stat and gameplay-log aggregation.

### `89196e8` — 2026-10-01 — Catalog-aware imports and trusted links

- Added exact catalog matching by title and filename during DoomLauncher import, allowing imported WADs to adopt curated catalog metadata.
- Added migration support for older custom imports while preserving user data.
- Preserved trusted README URLs from custom imports and exposed curated DoomWiki, Doomworld, Cacoward, idgames, archive, GitHub, ModDB, and DSDA links through the shared WAD-links component.
- Added `scripts/adopt_catalog_imports.py` to migrate existing entries into their matching catalog records.

### `9f3977f` — 2026-10-01 — Import form cleanup

- Improved checkbox markup in the import wizard and simplified palette lookup code used while inspecting WAD files.

### `f88d640` — 2026-10-01 — Links in Mods

- Added the shared WAD-links row to Mods cards so mod reference and source pages are available alongside ratings and download controls.

### `606e470` — 2026-10-17 — WebKitGTK-safe catalog rendering

- Fixed Explore on WebKitGTK builds without `Array.prototype.toSorted()` by sorting a copied array with the widely supported `sort()` API.
- Paginated Explore with a **Show more** control so large catalogs do not construct every card at once.
- Deferred thumbnails until their cards enter the viewport and limited native image requests to three concurrent fetches.
- Cached successful remote images on disk and cached failed URLs for seven days, preventing repeated DoomWiki 403 requests on every application start.
- Removed repeated card `backdrop-filter` and `drop-shadow` effects, and the import modal's fullscreen blur. WebKitGTK allocates offscreen surfaces for these filters; repeated card surfaces caused the Explore tab to consume GBs of memory and become unresponsive.
- Made MCP bridge WebView instrumentation opt-in because it can retain memory on WebKitGTK during normal development runs.
