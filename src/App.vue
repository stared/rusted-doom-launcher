<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
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
import { useStats } from "./composables/useStats";
import type { WadEntry } from "./lib/schema";
import { getErrorMessage } from "./lib/errors";

declare const window: Window & typeof globalThis & { __TAURI_INTERNALS__?: unknown };

type View = "main" | "explore" | "runs" | "logs" | "settings" | "about";

const { wads, loading, error } = useWads();
const { detectIwads, availableIwads, launch, isRunning } = useGZDoom();
const { loadState: loadDownloadState, isDownloaded, isDownloading, downloadProgress, downloadWithDeps, deleteWad } = useDownload();
const { settings, isFirstRun, migratedIwads, initSettings } = useSettings();
const { loadAllSaveInfo, getCachedSaveInfo, refreshSaveInfo } = useSaves();
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

    // Load save info now that settings are initialized
    // (the watch fires before initSettings completes, so we retry here)
    if (wads.value.length > 0) {
      await loadAllSaveInfo(wads.value.map(w => w.slug));
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

// Load save info when WADs change (initial load handled in onMounted after initSettings)
watch(wads, async (newWads) => {
  if (newWads.length > 0 && settings.value.libraryPath) {
    await loadAllSaveInfo(newWads.map(w => w.slug));
  }
});

// Refresh save info and capture stats when game closes
watch(isRunning, async (running, wasRunning) => {
  if (wasRunning && !running && lastPlayedSlug.value) {
    await refreshSaveInfo(lastPlayedSlug.value);
    await captureStats(lastPlayedSlug.value);
  }
});

async function handlePlay(wad: WadEntry) {
  errorMsg.value = "";
  if (!settings.value.gzdoomPath) {
    errorMsg.value = "Doom engine not found. Configure path in Settings.";
    activeView.value = "settings";
    return;
  }
  if (!availableIwads.value.includes(wad.iwad)) {
    const shortPath = settings.value.libraryPath.replace(/^\/Users\/[^/]+/, "~");
    errorMsg.value = `${wad.iwad.toUpperCase()}.WAD not found in ${shortPath}. This IWAD is required to run the mod.`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  try {
    const { wadPath, depPaths } = await downloadWithDeps(wad, wads.value);
    lastPlayedSlug.value = wad.slug;
    await launch(wadPath, wad.iwad, depPaths, wad.slug);
  } catch (e) {
    console.error(`[Play] Error launching ${wad.slug}:`, e);
    errorMsg.value = getErrorMessage(e);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

async function handleDelete(wad: WadEntry) {
  try {
    await deleteWad(wad.slug);
  } catch (e) {
    errorMsg.value = getErrorMessage(e);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
        :is-downloaded="isDownloaded"
        :is-downloading="isDownloading"
        :download-progress="downloadProgress"
        :get-save-info="getCachedSaveInfo"
        @play="handlePlay"
        @delete="handleDelete"
        @navigate="(view, query) => { activeView = view; exploreInitialQuery = query ?? ''; }"
      />
      <ExploreView
        v-else-if="activeView === 'explore'"
        :wads="wads"
        :is-downloaded="isDownloaded"
        :is-downloading="isDownloading"
        :download-progress="downloadProgress"
        :get-save-info="getCachedSaveInfo"
        :initial-query="exploreInitialQuery"
        @play="handlePlay"
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
