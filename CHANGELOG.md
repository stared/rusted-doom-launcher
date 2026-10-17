# Changelog

## Unreleased

### Fixed

- Prevented an Explore-tab memory spike and WebKitGTK hang. `backdrop-filter`
  and `filter: drop-shadow()` on repeated catalog cards make WebKit allocate
  offscreen render surfaces for every card. The card badge now uses an opaque
  translucent background and titles use plain text rendering.
- Removed the fullscreen blur from the DoomLauncher import modal. A single
  full-window backdrop filter can also require a large offscreen surface;
  its dark overlay keeps the same modal contrast without the allocation.
- Limited Explore's initial render to 24 cards and added a **Show more**
  control. The catalogue stays responsive when it contains hundreds of WADs.
- Deferred card thumbnails until their card enters the viewport, capped native
  image fetches at three concurrent requests, and cached successful images on
  disk. Failed remote URLs are cached for seven days so DoomWiki 403 responses
  are not retried on every application start.
- Replaced `Array.prototype.toSorted()` with a copied array plus `sort()` in
  frontend paths. Some supported WebKitGTK builds do not implement the newer
  ES2023 method, which prevented Explore from rendering.
- Kept MCP bridge instrumentation opt-in because its WebKitGTK integration
  can retain WebView memory during normal development runs.

