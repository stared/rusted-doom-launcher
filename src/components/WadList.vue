<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useWads } from "../composables/useWads";
import { useGZDoom } from "../composables/useGZDoom";
import { useDownload } from "../composables/useDownload";
import { useDownloadState } from "../composables/useDownloadState";
import { isTauri, logTauriStatus } from "../lib/tauri";
import type { WadEntry } from "../lib/schema";
import WadCard from "./WadCard.vue";
import WadDetail from "./WadDetail.vue";

const { wads, loading, error } = useWads();
const { detectIwads, availableIwads, launch, isRunning } = useGZDoom();
const {
  downloadWadWithDependencies,
  isTracked,
  getProgress,
  isDownloading,
  checkFileStatus,
  markExistingAsDownloaded,
  forceRedownload,
} = useDownload();
const { loadState, removeDownload } = useDownloadState();

const selectedWad = ref<WadEntry | null>(null);
const statusMessage = ref<string>("");
const statusType = ref<"info" | "error" | "success">("info");

// Dialog state for untracked files
const untrackedDialogWad = ref<WadEntry | null>(null);

// Check GZDoom and load download state on mount
onMounted(async () => {
  // Debug: Check Tauri context
  logTauriStatus();

  if (!isTauri()) {
    statusMessage.value = "Not running in Tauri context. Open in Tauri app, not browser.";
    statusType.value = "error";
    return;
  }

  try {
    // Load download state
    await loadState();
    console.log("Download state loaded");

    console.log("Attempting to detect IWADs...");
    await detectIwads();
    console.log("IWADs detected successfully:", availableIwads.value);
  } catch (e) {
    console.error("Startup error:", e);
    const errorMsg = e instanceof Error ? e.message : String(e);
    statusMessage.value = `Startup error: ${errorMsg}`;
    statusType.value = "error";
  }
});

function handleSelect(wad: WadEntry) {
  selectedWad.value = wad;
}

function handleCloseDetail() {
  selectedWad.value = null;
}

async function handleDownload(wad: WadEntry) {
  statusMessage.value = "";
  statusType.value = "info";

  try {
    // Check IWAD availability first
    await detectIwads();
    if (!availableIwads.value.includes(wad.iwad)) {
      statusMessage.value = `Missing IWAD: ${wad.iwad.toUpperCase()}.WAD - Add it to ~/Library/Application Support/gzdoom/`;
      statusType.value = "error";
      return;
    }

    // Check if download available
    if (wad.downloads.length === 0) {
      statusMessage.value = "No download available for this WAD";
      statusType.value = "error";
      return;
    }

    // Check file status - if exists but untracked, show dialog
    const status = await checkFileStatus(wad);
    if (status === "untracked-exists") {
      untrackedDialogWad.value = wad;
      return;
    }

    // Download WAD and dependencies
    await downloadWadWithDependencies(wad, wads.value);
    statusMessage.value = "";
  } catch (e) {
    console.error("handleDownload error:", e);
    statusMessage.value = e instanceof Error ? e.message : String(e);
    statusType.value = "error";
  }
}

async function handleAddExisting() {
  if (!untrackedDialogWad.value) return;
  const wad = untrackedDialogWad.value;
  untrackedDialogWad.value = null;

  try {
    await markExistingAsDownloaded(wad);
    statusMessage.value = `Added ${wad.title} to library`;
    statusType.value = "success";
    setTimeout(() => {
      if (statusMessage.value === `Added ${wad.title} to library`) {
        statusMessage.value = "";
      }
    }, 2000);
  } catch (e) {
    console.error("handleAddExisting error:", e);
    statusMessage.value = e instanceof Error ? e.message : String(e);
    statusType.value = "error";
  }
}

async function handleRedownload() {
  if (!untrackedDialogWad.value) return;
  const wad = untrackedDialogWad.value;
  untrackedDialogWad.value = null;

  try {
    await forceRedownload(wad);
    statusMessage.value = "";
  } catch (e) {
    console.error("handleRedownload error:", e);
    statusMessage.value = e instanceof Error ? e.message : String(e);
    statusType.value = "error";
  }
}

function cancelUntrackedDialog() {
  untrackedDialogWad.value = null;
}

async function handlePlay(wad: WadEntry) {
  statusMessage.value = "";
  statusType.value = "info";

  try {
    // Check IWAD availability
    await detectIwads();
    if (!availableIwads.value.includes(wad.iwad)) {
      statusMessage.value = `Missing IWAD: ${wad.iwad.toUpperCase()}.WAD - Add it to ~/Library/Application Support/gzdoom/`;
      statusType.value = "error";
      return;
    }

    // Check if download available
    if (wad.downloads.length === 0) {
      statusMessage.value = "No download available for this WAD";
      statusType.value = "error";
      return;
    }

    // Download WAD and dependencies (will skip if already downloaded)
    const { wadPath, dependencyPaths } = await downloadWadWithDependencies(wad, wads.value);

    // Launch GZDoom
    statusMessage.value = `Launching ${wad.title}...`;
    statusType.value = "info";

    await launch(wadPath, wad.iwad, dependencyPaths);

    statusMessage.value = "";
  } catch (e) {
    console.error("handlePlay error:", e);
    statusMessage.value = e instanceof Error ? e.message : String(e);
    statusType.value = "error";
  }
}

async function handleDelete(wad: WadEntry) {
  try {
    await removeDownload(wad.slug);
    statusMessage.value = `Deleted ${wad.title}`;
    statusType.value = "info";
    // Clear message after 2 seconds
    setTimeout(() => {
      if (statusMessage.value === `Deleted ${wad.title}`) {
        statusMessage.value = "";
      }
    }, 2000);
  } catch (e) {
    console.error("handleDelete error:", e);
    statusMessage.value = e instanceof Error ? e.message : String(e);
    statusType.value = "error";
  }
}
</script>

<template>
  <div>
    <!-- Status message -->
    <div
      v-if="statusMessage"
      :class="[
        'mb-4 rounded p-3',
        statusType === 'error' ? 'bg-red-900/50 text-red-200' : '',
        statusType === 'info' ? 'bg-blue-900/50 text-blue-200' : '',
        statusType === 'success' ? 'bg-green-900/50 text-green-200' : '',
      ]"
    >
      {{ statusMessage }}
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="text-center text-zinc-400">
      <p>Loading WADs...</p>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="rounded bg-red-900/50 p-4 text-red-200">
      <p>Error loading WADs: {{ error }}</p>
    </div>

    <!-- Empty state -->
    <div v-else-if="wads.length === 0" class="text-center text-zinc-400">
      <p>No WADs found.</p>
    </div>

    <!-- WAD grid -->
    <div v-else>
      <p class="mb-4 text-zinc-400">
        {{ wads.length }} WADs available
        <span v-if="availableIwads.length > 0" class="ml-2 text-green-400">
          • IWADs: {{ availableIwads.map((i) => i.toUpperCase()).join(", ") }}
        </span>
      </p>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <WadCard
          v-for="wad in wads"
          :key="wad.slug"
          :wad="wad"
          :is-downloaded="isTracked(wad.slug)"
          :is-downloading="isDownloading(wad.slug)"
          :progress="getProgress(wad.slug)"
          @select="handleSelect"
          @play="handlePlay"
          @download="handleDownload"
          @delete="handleDelete"
        />
      </div>
    </div>

    <!-- Detail modal -->
    <WadDetail
      v-if="selectedWad"
      :wad="selectedWad"
      @close="handleCloseDetail"
      @play="handlePlay"
    />

    <!-- Running indicator -->
    <div
      v-if="isRunning"
      class="fixed bottom-4 right-4 rounded bg-green-600 px-4 py-2 text-white shadow-lg"
    >
      GZDoom is running...
    </div>

    <!-- Untracked file dialog -->
    <div
      v-if="untrackedDialogWad"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      @click.self="cancelUntrackedDialog"
    >
      <div class="max-w-md rounded-lg bg-zinc-800 p-6 shadow-xl">
        <h3 class="mb-2 text-lg font-semibold text-zinc-100">File Already Exists</h3>
        <p class="mb-4 text-zinc-400">
          <span class="font-medium text-zinc-200">{{ untrackedDialogWad.title }}</span>
          already exists in your GZDoom folder but wasn't downloaded by this launcher.
        </p>
        <div class="flex flex-col gap-2">
          <button
            class="rounded bg-green-600 px-4 py-2 font-medium text-white transition-colors hover:bg-green-500"
            @click="handleAddExisting"
          >
            Add to Library
          </button>
          <button
            class="rounded bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-500"
            @click="handleRedownload"
          >
            Delete &amp; Re-download
          </button>
          <button
            class="rounded bg-zinc-700 px-4 py-2 text-zinc-300 transition-colors hover:bg-zinc-600"
            @click="cancelUntrackedDialog"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
