<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, X, RotateCcw, Info } from "@lucide/vue";
import { useSteamImport } from "../composables/useSteamImport";
import { getWadFriendlyName } from "../lib/steamContent";
import { useGZDoom } from "../composables/useGZDoom";

const emit = defineEmits<{
  close: [];
  imported: [count: number];
}>();

const {
  steamStatus,
  importing,
  watching,
  logStatus,
  importResult,
  cleanedUpStaging,
  errorMessage,
  detectSteam,
  triggerDownload,
  startWatching,
  stopWatching,
  importWadsFromSource,
  reclaimStagingSpace,
} = useSteamImport();

const { detectIwads } = useGZDoom();

const copied = ref(false);
const customBrowseDir = ref<string | null>(null);
const cleaningStaging = ref(false);
const stagingCleanedMessage = ref<string | null>(null);

const activeSourceDir = computed(() => {
  if (customBrowseDir.value) return customBrowseDir.value;
  if (steamStatus.value?.stagingDir) return steamStatus.value.stagingDir;
  if (steamStatus.value?.candidateDirs && steamStatus.value.candidateDirs.length > 0) {
    return steamStatus.value.candidateDirs[0];
  }
  return null;
});

const hasFoundWads = computed(() => {
  return (steamStatus.value?.foundWads && steamStatus.value.foundWads.length > 0) || false;
});

onMounted(async () => {
  await detectSteam();
});

onUnmounted(() => {
  stopWatching();
});

async function handleStartDownload() {
  copied.value = false;
  const launched = await triggerDownload();
  if (launched) {
    copied.value = true;
    startWatching(async () => {
      await detectSteam();
    });
  }
}

async function handleCopyCommandOnly() {
  try {
    await navigator.clipboard.writeText("download_depot 2280 2281");
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 3000);
  } catch (e) {
    console.error("Clipboard error:", e);
  }
}

async function handleBrowseCustomFolder() {
  const selected = await openDialog({
    title: "Select Steam or Doom Game Folder",
    directory: true,
    multiple: false,
  });
  if (!selected) return;

  const dir = typeof selected === "string" ? selected : selected[0];
  customBrowseDir.value = dir;
  await detectSteam(dir);
}

async function handleImport() {
  if (!activeSourceDir.value) return;
  try {
    const res = await importWadsFromSource(activeSourceDir.value);
    await detectIwads();
    emit("imported", res.imported.length);
  } catch (e) {
    console.error("Import failed:", e);
  }
}

async function handleReclaimSpace() {
  cleaningStaging.value = true;
  stagingCleanedMessage.value = null;
  try {
    await reclaimStagingSpace();
    stagingCleanedMessage.value = "Staging cache cleaned up! ~1.2 GB reclaimed.";
  } catch (e) {
    console.error("Reclaim failed:", e);
  } finally {
    cleaningStaging.value = false;
  }
}

function handleDone() {
  emit("close");
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
    <div
      class="relative w-full max-w-2xl rounded-xl bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      role="dialog"
      aria-modal="true"
    >
      <!-- Modal Header -->
      <div class="flex items-center justify-between border-b border-zinc-800 px-6 py-4 bg-zinc-900/60">
        <div class="flex items-center gap-3">
          <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 font-bold">
            <svg class="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 4.237 2.636 7.855 6.356 9.312l2.678-3.824a3.5 3.5 0 0 1-.034-3.488l-3.32-2.324a1.75 1.75 0 1 1 1.01-1.442l3.32 2.324a3.5 3.5 0 0 1 3.99 0l3.32-2.324a1.75 1.75 0 1 1 1.01 1.442l-3.32 2.324a3.5 3.5 0 0 1-.034 3.488l2.678 3.824C19.364 19.855 22 16.237 22 12c0-5.523-4.477-10-10-10z" />
            </svg>
          </div>
          <div>
            <h2 class="text-lg font-semibold text-zinc-100">Import IWADs from Steam</h2>
            <p class="text-xs text-zinc-400">DOOM + DOOM II, Master Levels, and expansions</p>
          </div>
        </div>
        <button
          class="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          @click="emit('close')"
          aria-label="Close"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <!-- Modal Body -->
      <div class="p-6 overflow-y-auto space-y-6 flex-1">
        <!-- Error Banner -->
        <div v-if="errorMessage" class="rounded-lg bg-red-950/60 border border-red-800/80 p-4 text-sm text-red-300">
          <p class="font-medium text-red-200">Notice</p>
          <p class="mt-1 text-xs opacity-90">{{ errorMessage }}</p>
        </div>

        <!-- Steam Account Detection Banner -->
        <div class="rounded-lg bg-zinc-800/40 border border-zinc-800 p-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-xs font-medium uppercase tracking-wider text-zinc-400">Steam Status</p>
              <div class="mt-1 flex items-center gap-2">
                <span
                  class="inline-block w-2.5 h-2.5 rounded-full"
                  :class="steamStatus?.installed ? 'bg-green-500' : 'bg-amber-500'"
                ></span>
                <span class="text-sm font-medium text-zinc-200">
                  <template v-if="steamStatus?.installed">
                    Installed &bull;
                    <span v-if="steamStatus.personaName" class="text-blue-400">
                      {{ steamStatus.personaName }}
                      <span v-if="steamStatus.accountName" class="text-zinc-400">({{ steamStatus.accountName }})</span>
                    </span>
                    <span v-else class="text-zinc-400">Ready</span>
                  </template>
                  <template v-else>
                    Steam not detected in default location
                  </template>
                </span>
              </div>
              <p v-if="steamStatus?.steamPath" class="text-xs text-zinc-500 mt-1 truncate max-w-md font-mono">
                {{ steamStatus.steamPath }}
              </p>
            </div>
            <button
              class="text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2.5 py-1.5 transition-colors"
              @click="handleBrowseCustomFolder"
            >
              Browse Folder...
            </button>
          </div>
        </div>

        <!-- STATE 1: Import Completed Successfully -->
        <div v-if="importResult" class="space-y-4">
          <div class="rounded-lg bg-green-950/40 border border-green-800/80 p-5">
            <div class="flex items-center gap-3">
              <div class="flex h-8 w-8 items-center justify-center rounded-full bg-green-600/20 text-green-400 border border-green-500/30">
                <Check class="w-5 h-5" />
              </div>
              <div>
                <h3 class="text-sm font-semibold text-green-200">Import Complete!</h3>
                <p class="text-xs text-green-300/80 mt-0.5">
                  Successfully imported {{ importResult.imported.length }} WADs into your library.
                </p>
              </div>
            </div>

            <!-- List of imported files -->
            <div class="mt-4 space-y-1.5 border-t border-green-900/60 pt-3">
              <div
                v-for="item in importResult.imported"
                :key="item.name"
                class="flex items-center justify-between text-xs py-1"
              >
                <span class="font-medium text-zinc-200">{{ getWadFriendlyName(item.name) }}</span>
                <span class="font-mono text-zinc-400">{{ (item.size / (1024 * 1024)).toFixed(1) }} MB</span>
              </div>
              <div
                v-for="(skipMsg, i) in importResult.skipped"
                :key="i"
                class="text-xs text-zinc-400 italic py-0.5"
              >
                &bull; {{ skipMsg }}
              </div>
            </div>
          </div>

          <!-- Staging Cleanup Box -->
          <div v-if="steamStatus?.stagingDir && !cleanedUpStaging" class="rounded-lg bg-zinc-800/50 border border-zinc-800 p-4">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-zinc-200">Reclaim Disk Space</p>
                <p class="text-xs text-zinc-400 mt-0.5">
                  Temporary Steam download files (~1.2 GB) can now be safely removed.
                </p>
                <p v-if="stagingCleanedMessage" class="text-xs text-green-400 mt-1 font-medium">
                  {{ stagingCleanedMessage }}
                </p>
              </div>
              <button
                class="rounded bg-zinc-700 hover:bg-zinc-600 text-xs font-medium text-zinc-200 px-3 py-2 transition-colors disabled:opacity-50"
                :disabled="cleaningStaging"
                @click="handleReclaimSpace"
              >
                {{ cleaningStaging ? "Cleaning..." : "Clean Up Staging Cache" }}
              </button>
            </div>
          </div>

          <!-- Steam Console Tab Info Note -->
          <div class="rounded-lg bg-zinc-800/30 border border-zinc-800 p-3 text-xs text-zinc-400">
            <span class="font-medium text-zinc-300">Steam Console Note:</span>
            The Console tab in your Steam client was opened for this session only. When you quit and restart Steam, the tab will automatically disappear.
          </div>
        </div>

        <!-- STATE 2: WADs Already Available to Import -->
        <div v-else-if="hasFoundWads" class="space-y-4">
          <div class="rounded-lg bg-blue-950/30 border border-blue-900/50 p-4">
            <h3 class="text-sm font-semibold text-blue-200 flex items-center gap-2">
              <Check class="w-4 h-4 text-blue-400" />
              Found {{ steamStatus?.foundWads.length }} Game Files in Steam
            </h3>
            <p class="text-xs text-zinc-400 mt-1">
              The following files were detected in your Steam library or downloaded cache and are ready to be imported into your library:
            </p>

            <div class="mt-3 flex flex-wrap gap-2">
              <span
                v-for="wad in steamStatus?.foundWads"
                :key="wad"
                class="inline-flex items-center rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 border border-zinc-700/60"
              >
                {{ getWadFriendlyName(wad) }}
              </span>
            </div>
          </div>

          <div class="flex justify-end gap-3 pt-2">
            <button
              class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium px-5 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              :disabled="importing"
              @click="handleImport"
            >
              <RotateCcw v-if="importing" class="w-4 h-4 animate-spin" />
              {{ importing ? "Importing WADs..." : "Import All WADs" }}
            </button>
          </div>
        </div>

        <!-- STATE 3: Missing Files / Need to Download (macOS Steam Guided Flow) -->
        <div v-else class="space-y-5">
          <div class="rounded-lg bg-zinc-800/40 border border-zinc-800 p-4 text-sm text-zinc-300 space-y-2">
            <div class="flex items-start gap-2.5">
              <Info class="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
              <div class="space-y-1">
                <p class="font-medium text-zinc-200">macOS Steam Platform Restriction</p>
                <p class="text-xs text-zinc-400 leading-relaxed">
                  Steam on macOS disables the "Install" button for <em>DOOM + DOOM II</em> because it looks for Mac application binaries.
                  However, the complete game package (~1.2 GB) containing all classic IWADs, <em>Legacy of Rust</em>, and expansions can be downloaded directly through Steam's internal console.
                </p>
              </div>
            </div>
          </div>

          <div class="rounded-lg bg-zinc-950/60 border border-zinc-800 p-5 space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold uppercase tracking-wider text-zinc-400">Step 1: Download in Steam</span>
              <button
                class="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                @click="handleCopyCommandOnly"
              >
                {{ copied ? "Copied to Clipboard!" : "Copy Command" }}
              </button>
            </div>

            <div class="flex items-center gap-3">
              <code class="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-zinc-200 select-all">
                download_depot 2280 2281
              </code>
              <button
                class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium px-4 py-2 text-xs transition-colors shrink-0 shadow-sm"
                @click="handleStartDownload"
              >
                Open Steam Console
              </button>
            </div>

            <p class="text-xs text-zinc-400 leading-relaxed">
              Clicking <strong>Open Steam Console</strong> copies the command to your clipboard and opens the Console tab in your Steam desktop app (no terminal tools or SteamCMD needed). Simply press <kbd class="bg-zinc-800 border border-zinc-700 px-1 rounded text-zinc-300">Cmd+V</kbd> and <kbd class="bg-zinc-800 border border-zinc-700 px-1 rounded text-zinc-300">Enter</kbd> into the console prompt at the bottom of Steam.
            </p>
          </div>

          <!-- Watcher Progress State -->
          <div v-if="watching" class="rounded-lg bg-blue-950/20 border border-blue-900/40 p-4">
            <div class="flex items-center gap-3">
              <div class="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin shrink-0"></div>
              <div>
                <p class="text-xs font-semibold text-blue-200">
                  {{ logStatus?.state === "downloading" ? "Steam Download In Progress (~1.2 GB)..." : "Waiting for Steam Download (~1.2 GB)..." }}
                </p>
                <p class="text-xs text-zinc-400 mt-0.5">
                  {{ logStatus?.message || "Rusted Doom Launcher is monitoring your Steam directory. Once download completes, import will start automatically." }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal Footer -->
      <div class="border-t border-zinc-800 px-6 py-4 bg-zinc-900/60 flex items-center justify-between">
        <p class="text-xs text-zinc-500">
          Non-destructive: existing files in your library will never be overwritten.
        </p>
        <button
          class="rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium px-4 py-2 text-sm transition-colors"
          @click="handleDone"
        >
          {{ importResult ? "Done" : "Close" }}
        </button>
      </div>
    </div>
  </div>
</template>
