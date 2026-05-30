<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue";
import { confirm } from "@tauri-apps/plugin-dialog";
import Sidebar from "./components/Sidebar.vue";
import MainView from "./components/MainView.vue";
import ModsView from "./components/ModsView.vue";
import ExploreView from "./components/ExploreView.vue";
import RunsView from "./components/RunsView.vue";
import GameplayLogView from "./components/GameplayLogView.vue";
import SettingsView from "./components/SettingsView.vue";
import AboutView from "./components/AboutView.vue";
import CustomModView from "./components/CustomModView.vue";
import { useWads } from "./composables/useWads";
import { useGZDoom } from "./composables/useGZDoom";
import { useDownload } from "./composables/useDownload";
import { useCustomWads } from "./composables/useCustomWads";
import { useLibrary } from "./composables/useLibrary";
import { useSettings } from "./composables/useSettings";
import { useLevelNames } from "./composables/useLevelNames";
import { useStats } from "./composables/useStats";
import type { Iwad, WadEntry } from "./lib/schema";
import { IWAD_LABELS, IWAD_METADATA } from "./lib/constants";
import { getErrorMessage } from "./lib/errors";
import { shortenPath } from "./lib/platform";

function synthIwadEntry(iwad: Iwad): WadEntry {
  const meta = IWAD_METADATA[iwad];
  return {
    slug: `iwad-${iwad}`,
    title: IWAD_LABELS[iwad],
    authors: meta.authors.map(name => ({ name })),
    year: meta.year,
    description: meta.description,
    iwad,
    type: "iwad",
    sourcePort: "vanilla",
    requires: [],
    downloads: [],
    thumbnail: meta.thumbnail,
    screenshots: [],
    youtubeVideos: [],
    awards: [],
    tags: [],
    difficulty: "unknown",
    urls: [],
    notes: "",
    extraArgs: [],
    _schemaVersion: 1,
    _source: "manual",
  };
}

type ModType = WadEntry["type"];

declare const window: Window & typeof globalThis & { __TAURI_INTERNALS__?: unknown };

type View = "main" | "mods" | "explore" | "runs" | "logs" | "settings" | "about" | "addCustom";

const { wads, loading, error } = useWads();
const { detectIwads, availableIwads, launch, isRunning } = useGZDoom();
const lib = useLibrary();

const iwadEntries = computed<WadEntry[]>(() => availableIwads.value.map(synthIwadEntry));
const playableEntries = computed<WadEntry[]>(() =>
  [...iwadEntries.value, ...wads.value.filter(w => w.type !== "gameplay-mod" && w.type !== "resource-pack")]
);
const modEntries = computed<WadEntry[]>(() => wads.value.filter(w => w.type === "gameplay-mod"));
const exploreEntries = computed<WadEntry[]>(() => wads.value.filter(w => w.type !== "resource-pack"));
const { loadState: loadDownloadState, downloadWithDeps, downloadWad, deleteWad, isDownloaded, getDownloadInfo } = useDownload();
const { hasSlug: isCustomSlug, removeCustomWad, loadState: loadCustomWads } = useCustomWads();
const { settings, isFirstRun, migratedIwads, initSettings, toggleActiveMod, pruneActiveMods } = useSettings();
const { loadAllLevelNames } = useLevelNames();
const { captureStats, loadAllPlaySummaries, refreshPlaySummary } = useStats();

const activeView = ref<View>("main");
const errorMsg = ref("");
const exploreInitialQuery = ref("");

// Custom-mod importer: full-screen view, not a modal. We remember which view
// the user came from so Cancel / submit returns there.
const customDefaultType = ref<ModType>("megawad");
const customReturnView = ref<View>("main");
const editingCustomWad = ref<WadEntry | null>(null);
function openCustomImporter(defaultType: ModType) {
  editingCustomWad.value = null;
  customDefaultType.value = defaultType;
  customReturnView.value = defaultType === "gameplay-mod" ? "mods" : "main";
  activeView.value = "addCustom";
}
function openCustomEditor(wad: WadEntry) {
  editingCustomWad.value = wad;
  customDefaultType.value = wad.type;
  customReturnView.value = wad.type === "gameplay-mod" ? "mods" : "main";
  activeView.value = "addCustom";
}
function closeCustomImporter() {
  activeView.value = customReturnView.value;
  editingCustomWad.value = null;
}

// Track last played WAD to refresh its save info when game closes
const lastPlayedSlug = ref<string | null>(null);

onMounted(async () => {
  if (!window.__TAURI_INTERNALS__) {
    errorMsg.value = "Open in Tauri app, not browser";
    return;
  }
  try {
    await initSettings();
    await loadDownloadState();
    await loadCustomWads();
    await pruneActiveMods(s => wads.value.some(w => w.slug === s) && isDownloaded(s));
    await detectIwads();

    // If IWADs were migrated but not detected, retry after short delay
    if (migratedIwads.value.length > 0 && availableIwads.value.length === 0) {
      console.log("[App] IWADs migrated but not detected, retrying...");
      await new Promise(r => setTimeout(r, 100));
      await detectIwads();
    }

    // Load save info and level names now that settings are initialized
    // (the watch fires before initSettings completes, so we retry here)
    if (wads.value.length > 0) {
      const slugs = wads.value.map(w => w.slug);
      await loadAllLevelNames(slugs);
      await loadAllPlaySummaries(slugs);
    }

    // On first run, open Settings so user can verify configuration
    if (isFirstRun.value) {
      activeView.value = "settings";
    }
  } catch (e) {
    console.error("[App] Startup error:", e);
    errorMsg.value = getErrorMessage(e);
  }
});

// Load save info and level names when WADs change (initial load handled in onMounted after initSettings)
watch(wads, async (newWads) => {
  if (newWads.length > 0 && settings.value.libraryPath) {
    const slugs = newWads.map(w => w.slug);
    await loadAllLevelNames(slugs);
    await loadAllPlaySummaries(slugs);
  }
});

// Refresh save info and capture stats when game closes
watch(isRunning, async (running, wasRunning) => {
  if (wasRunning && !running && lastPlayedSlug.value) {
    await refreshPlaySummary(lastPlayedSlug.value);
    await captureStats(lastPlayedSlug.value);
  }
});

function activeModPaths(launchedSlug: string): string[] {
  // Require a known WadEntry: a stale download record alone isn't enough,
  // otherwise an orphaned activeMods slug (no catalog/custom entry, but a
  // leftover file in the downloads registry) silently injects -file into
  // every launch with no way to toggle it off from the UI.
  const knownSlugs = new Set(wads.value.map(w => w.slug));
  return settings.value.activeMods
    .filter(s => s !== launchedSlug && knownSlugs.has(s) && isDownloaded(s))
    .map(s => {
      const info = getDownloadInfo(s);
      return info ? lib.wadFile(info.wadFilename ?? info.filename) : null;
    })
    .filter((p): p is string => !!p);
}

async function handlePlay(wad: WadEntry, extraArgs?: string[]) {
  errorMsg.value = "";
  // Resource packs are pure dependencies (managed via requires + downloadWithDeps).
  // They're filtered out of every user-facing grid, so this is a defensive no-op.
  if (wad.type === "resource-pack") {
    console.warn(`[Play] Unexpected resource-pack launch: ${wad.slug}`);
    return;
  }
  // Gameplay mods are managed in the Mods tab, not played standalone.
  // Ensure the mod is downloaded (so the toggle becomes available) then route.
  if (wad.type === "gameplay-mod") {
    try {
      if (!isDownloaded(wad.slug)) await downloadWad(wad);
    } catch (e) {
      console.error(`[Mods] Download failed for ${wad.slug}:`, e);
      errorMsg.value = getErrorMessage(e);
      return;
    }
    activeView.value = "mods";
    return;
  }
  if (!settings.value.gzdoomPath) {
    errorMsg.value = "Doom engine not found. Configure path in Settings.";
    activeView.value = "settings";
    return;
  }
  if (!availableIwads.value.includes(wad.iwad)) {
    const shortPath = shortenPath(settings.value.libraryPath);
    errorMsg.value = `${wad.iwad.toUpperCase()}.WAD not found in ${shortPath}. This IWAD is required to run the mod.`;
    return;
  }
  try {
    lastPlayedSlug.value = wad.slug;
    const modPaths = activeModPaths(wad.slug);
    // The launched wad's own extraArgs come first; caller-supplied args
    // (e.g. "+map MAP05" from WadCard's level picker) come after so they
    // take precedence on console-style commands.
    const wadExtra = wad.extraArgs ?? [];
    const callExtra = extraArgs ?? [];
    const combinedExtra = [...wadExtra, ...callExtra];
    if (wad.type === "iwad") {
      await launch("", wad.iwad, modPaths, wad.slug, "HMP", combinedExtra);
      return;
    }
    const { wadPath, depPaths } = await downloadWithDeps(wad, wads.value);
    await launch(wadPath, wad.iwad, [...depPaths, ...modPaths], wad.slug, "HMP", combinedExtra);
  } catch (e) {
    console.error(`[Play] Error launching ${wad.slug}:`, e);
    errorMsg.value = getErrorMessage(e);
  }
}

async function handleToggleActive(slug: string) {
  await toggleActiveMod(slug);
}

async function handleDelete(wad: WadEntry) {
  try {
    const isCustom = isCustomSlug(wad.slug);
    const info = getDownloadInfo(wad.slug);
    const external = isCustom && !!info?.externalPath;
    const message = !isCustom
      ? `Delete downloaded files for "${wad.title}"?`
      : external
        ? `Remove "${wad.title}" from your library? The original file at ${info?.externalPath} stays untouched.`
        : `Remove "${wad.title}" from your library? The imported copy in the library folder will be deleted.`;
    const ok = await confirm(message, {
      title: isCustom ? "Remove custom mod" : "Delete WAD",
      kind: "warning",
    });
    if (!ok) return;
    await deleteWad(wad.slug);
    if (isCustom) await removeCustomWad(wad.slug);
    await pruneActiveMods(s => wads.value.some(w => w.slug === s) && isDownloaded(s));
  } catch (e) {
    errorMsg.value = getErrorMessage(e);
  }
}

</script>

<template>
  <div class="flex h-screen bg-zinc-950 text-zinc-100">
    <!-- Sidebar -->
    <Sidebar :active-view="activeView" @navigate="(view) => { activeView = view; exploreInitialQuery = ''; }" />

    <!-- Main Content -->
    <main class="flex-1 overflow-y-auto p-8">
      <!-- Error Message -->
      <div v-if="errorMsg" class="mb-6 rounded-lg bg-red-900/50 p-4 text-red-200">
        {{ errorMsg }}
        <button class="ml-4 text-red-400 hover:text-red-300" @click="errorMsg = ''">Dismiss</button>
      </div>

      <!-- Views -->
      <MainView
        v-if="activeView === 'main'"
        :wads="playableEntries"
        :loading="loading"
        :error="error"
        @play="(wad: WadEntry, args?: string[]) => handlePlay(wad, args)"
        @delete="handleDelete"
        @navigate="(view, query) => { activeView = view; exploreInitialQuery = query ?? ''; }"
        @add-custom="openCustomImporter"
        @edit="openCustomEditor"
      />
      <ModsView
        v-else-if="activeView === 'mods'"
        :wads="modEntries"
        :loading="loading"
        :error="error"
        @play="(wad: WadEntry, args?: string[]) => handlePlay(wad, args)"
        @delete="handleDelete"
        @toggle-active="handleToggleActive"
        @add-custom="openCustomImporter"
        @edit="openCustomEditor"
      />
      <CustomModView
        v-else-if="activeView === 'addCustom'"
        :default-type="customDefaultType"
        :edit-wad="editingCustomWad"
        @cancel="closeCustomImporter"
        @added="closeCustomImporter"
      />
      <ExploreView
        v-else-if="activeView === 'explore'"
        :wads="exploreEntries"
        :initial-query="exploreInitialQuery"
        @play="(wad: WadEntry, args?: string[]) => handlePlay(wad, args)"
        @delete="handleDelete"
      />
      <RunsView
        v-else-if="activeView === 'runs'"
        :wads="wads"
      />
      <GameplayLogView
        v-else-if="activeView === 'logs'"
        :wads="wads"
      />
      <SettingsView v-else-if="activeView === 'settings'" />
      <AboutView v-else-if="activeView === 'about'" />
    </main>

    <!-- Game Running Indicator -->
    <div
      v-if="isRunning"
      class="fixed bottom-4 right-4 rounded-lg bg-rose-600 px-4 py-2 text-white shadow-lg flex items-center gap-2"
    >
      <span class="h-2 w-2 rounded-full bg-white animate-pulse" />
      Game running...
    </div>

  </div>
</template>
