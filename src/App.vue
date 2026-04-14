<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { confirm } from "@tauri-apps/plugin-dialog";
import Sidebar from "./components/Sidebar.vue";
import MainView from "./components/MainView.vue";
import ExploreView from "./components/ExploreView.vue";
import RunsView from "./components/RunsView.vue";
import GameplayLogView from "./components/GameplayLogView.vue";
import SettingsView from "./components/SettingsView.vue";
import AboutView from "./components/AboutView.vue";
import { useWads } from "./composables/useWads";
import { useGZDoom } from "./composables/useGZDoom";
import { useDownload } from "./composables/useDownload";
import { useSettings } from "./composables/useSettings";
import { useSaves } from "./composables/useSaves";
import { useLevelNames } from "./composables/useLevelNames";
import { useStats } from "./composables/useStats";
import type { WadEntry } from "./lib/schema";
import { getErrorMessage } from "./lib/errors";
import { shortenPath } from "./lib/platform";

declare const window: Window & typeof globalThis & { __TAURI_INTERNALS__?: unknown };

type View = "main" | "explore" | "runs" | "logs" | "settings" | "about";

const { wads, loading, error } = useWads();
const { detectIwads, availableIwads, launch, isRunning } = useGZDoom();
const { loadState: loadDownloadState, downloadWithDeps, deleteWad } = useDownload();
const { settings, isFirstRun, migratedIwads, initSettings } = useSettings();
const { loadAllSaveInfo, refreshSaveInfo } = useSaves();
const { loadAllLevelNames } = useLevelNames();
const { captureStats } = useStats();

const activeView = ref<View>("main");
const errorMsg = ref("");
const exploreInitialQuery = ref("");

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
      await loadAllSaveInfo(slugs);
      await loadAllLevelNames(slugs);
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
    await loadAllSaveInfo(slugs);
    await loadAllLevelNames(slugs);
  }
});

// Refresh save info and capture stats when game closes
watch(isRunning, async (running, wasRunning) => {
  if (wasRunning && !running && lastPlayedSlug.value) {
    await refreshSaveInfo(lastPlayedSlug.value);
    await captureStats(lastPlayedSlug.value);
  }
});

async function handlePlay(wad: WadEntry, extraArgs?: string[]) {
  errorMsg.value = "";
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
    const { wadPath, depPaths } = await downloadWithDeps(wad, wads.value);
    lastPlayedSlug.value = wad.slug;
    await launch(wadPath, wad.iwad, depPaths, wad.slug, "HMP", extraArgs ?? []);
  } catch (e) {
    console.error(`[Play] Error launching ${wad.slug}:`, e);
    errorMsg.value = getErrorMessage(e);
  }
}

async function handleDelete(wad: WadEntry) {
  try {
    const ok = await confirm(
      `Delete downloaded files for "${wad.title}"?`,
      { title: "Delete WAD", kind: "warning" }
    );
    if (!ok) return;
    await deleteWad(wad.slug);
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
        :wads="wads"
        :loading="loading"
        :error="error"
        @play="(wad: WadEntry, args?: string[]) => handlePlay(wad, args)"
        @delete="handleDelete"
        @navigate="(view, query) => { activeView = view; exploreInitialQuery = query ?? ''; }"
      />
      <ExploreView
        v-else-if="activeView === 'explore'"
        :wads="wads"
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
