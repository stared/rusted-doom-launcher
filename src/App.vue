<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import Sidebar from "./components/Sidebar.vue";
import MainView from "./components/MainView.vue";
import LibraryView from "./components/LibraryView.vue";
import ExploreView from "./components/ExploreView.vue";
import SettingsView from "./components/SettingsView.vue";
import AboutView from "./components/AboutView.vue";
import { useWads } from "./composables/useWads";
import { useGZDoom } from "./composables/useGZDoom";
import { useDownload } from "./composables/useDownload";
import { useSettings } from "./composables/useSettings";
import { useSaves } from "./composables/useSaves";
import { useStats } from "./composables/useStats";
import type { WadEntry } from "./lib/schema";

declare const window: Window & typeof globalThis & { __TAURI_INTERNALS__?: unknown };

type View = "main" | "library" | "explore" | "settings" | "about";

const { wads, loading, error } = useWads();
const { detectIwads, availableIwads, launch, isRunning, isGZDoomFound } = useGZDoom();
const { loadState: loadDownloadState, isDownloaded, isDownloading, getDownloadProgress, downloadWithDeps, deleteWad } = useDownload();
const { loadSettings } = useSettings();
const { loadAllSaveInfo, getCachedSaveInfo, refreshSaveInfo } = useSaves();
const { captureStats } = useStats();

const activeView = ref<View>("main");
const errorMsg = ref("");

// Track last played WAD to refresh its save info when game closes
const lastPlayedSlug = ref<string | null>(null);

onMounted(async () => {
  if (!window.__TAURI_INTERNALS__) {
    errorMsg.value = "Open in Tauri app, not browser";
    return;
  }
  try {
    await loadSettings();
    await loadDownloadState();
    await detectIwads();
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "Startup failed";
  }
});

// Load save info once WADs are available
watch(wads, async (newWads) => {
  if (newWads.length > 0) {
    await loadAllSaveInfo(newWads.map(w => w.slug));
  }
}, { immediate: true });

// Refresh save info and capture stats when game closes
watch(isRunning, async (running, wasRunning) => {
  if (wasRunning && !running && lastPlayedSlug.value) {
    await refreshSaveInfo(lastPlayedSlug.value);
    await captureStats(lastPlayedSlug.value);
  }
});

async function handlePlay(wad: WadEntry) {
  errorMsg.value = "";
  if (!isGZDoomFound()) {
    errorMsg.value = "GZDoom not found. Configure path in Settings.";
    activeView.value = "settings";
    return;
  }
  if (!availableIwads.value.includes(wad.iwad)) {
    errorMsg.value = `Missing IWAD: ${wad.iwad.toUpperCase()}.WAD`;
    return;
  }
  try {
    const { wadPath, depPaths } = await downloadWithDeps(wad, wads.value);
    lastPlayedSlug.value = wad.slug;
    await launch(wadPath, wad.iwad, depPaths, wad.slug);
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "Failed to launch";
  }
}

async function handleDelete(wad: WadEntry) {
  try {
    await deleteWad(wad.slug);
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "Delete failed";
  }
}
</script>

<template>
  <div class="flex h-screen bg-zinc-950 text-zinc-100">
    <!-- Sidebar -->
    <Sidebar :active-view="activeView" @navigate="activeView = $event" />

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
        :get-download-progress="getDownloadProgress"
        :get-save-info="getCachedSaveInfo"
        @play="handlePlay"
        @delete="handleDelete"
      />
      <LibraryView
        v-else-if="activeView === 'library'"
        :wads="wads"
        :is-downloaded="isDownloaded"
        :is-downloading="isDownloading"
        :get-download-progress="getDownloadProgress"
        :get-save-info="getCachedSaveInfo"
        @play="handlePlay"
        @delete="handleDelete"
      />
      <ExploreView
        v-else-if="activeView === 'explore'"
        :wads="wads"
        :is-downloaded="isDownloaded"
        :is-downloading="isDownloading"
        :get-download-progress="getDownloadProgress"
        :get-save-info="getCachedSaveInfo"
        @play="handlePlay"
        @delete="handleDelete"
      />
      <SettingsView v-else-if="activeView === 'settings'" />
      <AboutView v-else-if="activeView === 'about'" />
    </main>

    <!-- GZDoom Running Indicator -->
    <div
      v-if="isRunning"
      class="fixed bottom-4 right-4 rounded-lg bg-rose-600 px-4 py-2 text-white shadow-lg flex items-center gap-2"
    >
      <span class="h-2 w-2 rounded-full bg-white animate-pulse" />
      GZDoom running...
    </div>
  </div>
</template>
