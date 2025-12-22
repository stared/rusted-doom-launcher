<script setup lang="ts">
import { ref } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettings } from "../composables/useSettings";
import { useGZDoom } from "../composables/useGZDoom";

const { setGZDoomPath, setLibraryPath, getLibraryPath, gzdoomDetectedPath, isGZDoomFound } = useSettings();
const { availableIwads, detectIwads } = useGZDoom();

const libraryPathDisplay = ref("");
const errorMsg = ref("");

// Load current library path
getLibraryPath().then(p => libraryPathDisplay.value = p);

async function browseGZDoom() {
  const selected = await open({
    title: "Select GZDoom Application",
    filters: [{ name: "Application", extensions: ["app"] }],
    directory: false,
    multiple: false,
  });
  if (selected) {
    const path = typeof selected === "string" ? selected : selected[0];
    const appName = path.split("/").pop()?.toLowerCase() ?? "";
    if (!appName.includes("gzdoom")) {
      errorMsg.value = `"${appName}" doesn't appear to be GZDoom. Please select GZDoom.app`;
      return;
    }
    const execPath = path.endsWith(".app") ? `${path}/Contents/MacOS/gzdoom` : path;
    await setGZDoomPath(execPath);
    errorMsg.value = "";
  }
}

async function browseLibrary() {
  const selected = await open({
    title: "Select WAD Library Folder",
    directory: true,
    multiple: false,
  });
  if (selected) {
    const path = typeof selected === "string" ? selected : selected[0];
    await setLibraryPath(path);
    libraryPathDisplay.value = path;
    await detectIwads();
  }
}

function shortenPath(path: string | null): string {
  if (!path) return "Not found";
  const home = path.match(/^\/Users\/[^/]+/)?.[0];
  if (home) return path.replace(home, "~");
  return path;
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-bold tracking-tight">Settings</h1>

    <div v-if="errorMsg" class="rounded bg-red-900/50 p-3 text-red-200 text-sm">{{ errorMsg }}</div>

    <div class="space-y-4">
      <!-- GZDoom Path -->
      <div class="rounded-lg bg-zinc-800/50 p-4">
        <div class="flex items-center justify-between">
          <div>
            <label class="text-sm font-medium text-zinc-300">GZDoom Path</label>
            <p class="text-sm text-zinc-500 mt-1">{{ shortenPath(gzdoomDetectedPath) }}</p>
            <p v-if="isGZDoomFound()" class="text-xs text-green-400 mt-1">GZDoom found</p>
            <p v-else class="text-xs text-red-400 mt-1">GZDoom not found</p>
          </div>
          <button
            class="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-600"
            @click="browseGZDoom"
          >
            Browse
          </button>
        </div>
      </div>

      <!-- Library Path -->
      <div class="rounded-lg bg-zinc-800/50 p-4">
        <div class="flex items-center justify-between">
          <div>
            <label class="text-sm font-medium text-zinc-300">WAD Library</label>
            <p class="text-sm text-zinc-500 mt-1">{{ shortenPath(libraryPathDisplay) }}</p>
          </div>
          <button
            class="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-600"
            @click="browseLibrary"
          >
            Browse
          </button>
        </div>
      </div>

      <!-- Available IWADs -->
      <div class="rounded-lg bg-zinc-800/50 p-4">
        <label class="text-sm font-medium text-zinc-300">Available IWADs</label>
        <p v-if="availableIwads.length > 0" class="text-sm text-zinc-400 mt-1">
          {{ availableIwads.map(i => i.toUpperCase()).join(', ') }}
        </p>
        <p v-else class="text-sm text-red-400 mt-1">None found</p>
      </div>
    </div>
  </div>
</template>
