<script setup lang="ts">
import { ref, watch, onMounted, computed } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { Check, X } from "lucide-vue-next";
import { useSettings } from "../composables/useSettings";
import { useGZDoom } from "../composables/useGZDoom";
import { useWads } from "../composables/useWads";
import type { Iwad } from "../lib/schema";

const currentPlatform = platform();

const { settings, isFirstRun, migratedIwads, setGZDoomPath, setLibraryPath, checkInnoextract, importFromGOG } = useSettings();
const { availableIwads, detectIwads } = useGZDoom();
const { wads } = useWads();

// IWADs required by games in the catalog
const requiredIwads = computed<Iwad[]>(() => {
  const iwadSet = new Set<Iwad>();
  for (const wad of wads.value) {
    iwadSet.add(wad.iwad);
  }
  // Sort by importance: doom2, doom, then others alphabetically
  const priority: Iwad[] = ["doom2", "doom", "plutonia", "tnt", "heretic", "hexen", "freedoom1", "freedoom2"];
  return priority.filter(iwad => iwadSet.has(iwad));
});

const hasAnyIwad = computed(() => requiredIwads.value.some(iwad => availableIwads.value.includes(iwad)));

// Group migrated IWADs by source path for display
const migratedIwadsBySource = computed(() => {
  const groups = new Map<string, string[]>();
  for (const iwad of migratedIwads.value) {
    const existing = groups.get(iwad.from) || [];
    existing.push(iwad.name);
    groups.set(iwad.from, existing);
  }
  return Array.from(groups.entries()).map(([from, names]) => ({
    from: shortenPath(from),
    names: names.join(", "),
  }));
});

const errorMsg = ref("");
const engineVersion = ref<string | null>(null);
const hasInnoextract = ref(false);
const gogImporting = ref(false);
const gogImportResult = ref<{ success: boolean; message: string } | null>(null);

async function fetchEngineVersion() {
  if (!settings.value.gzdoomPath) {
    engineVersion.value = null;
    return;
  }
  try {
    engineVersion.value = await invoke<string>("get_engine_version", { enginePath: settings.value.gzdoomPath });
  } catch {
    engineVersion.value = null;
  }
}

// Fetch version when component mounts and when path changes
onMounted(fetchEngineVersion);
watch(() => settings.value.gzdoomPath, fetchEngineVersion);

// Check innoextract availability
async function checkInnoextractAvailability() {
  hasInnoextract.value = await checkInnoextract();
}
onMounted(checkInnoextractAvailability);

// Handle GOG import button click
async function handleGOGButtonClick() {
  // If innoextract not found, re-check
  if (!hasInnoextract.value) {
    hasInnoextract.value = await checkInnoextract();
    if (!hasInnoextract.value) {
      const installInstructions = currentPlatform === "macos"
        ? "brew install innoextract"
        : currentPlatform === "windows"
        ? "scoop install innoextract (or download from https://constexpr.org/innoextract/)"
        : "sudo apt install innoextract (or your distro's package manager)";
      gogImportResult.value = {
        success: false,
        message: `innoextract not found. Install with: ${installInstructions}`,
      };
    }
    return;
  }

  // Proceed with import
  await browseAndImportGOG();
}

// Import from GOG installer
async function browseAndImportGOG() {
  gogImportResult.value = null;
  const selected = await open({
    title: "Select GOG Doom Installer",
    filters: [{ name: "Installer", extensions: ["exe"] }],
    directory: false,
    multiple: false,
  });
  if (!selected) return;

  const installerPath = typeof selected === "string" ? selected : selected[0];
  gogImporting.value = true;
  try {
    const result = await importFromGOG(installerPath);
    await detectIwads();
    if (result.extractedWads.length > 0) {
      gogImportResult.value = {
        success: true,
        message: `Extracted: ${result.extractedWads.join(", ")}`,
      };
    } else {
      gogImportResult.value = {
        success: false,
        message: "No WAD files were extracted",
      };
    }
  } catch (e) {
    gogImportResult.value = {
      success: false,
      message: e instanceof Error ? e.message : String(e),
    };
  } finally {
    gogImporting.value = false;
  }
}

async function browseGZDoom() {
  // Platform-specific file filters
  const filters = currentPlatform === "macos"
    ? [{ name: "Application", extensions: ["app"] }]
    : currentPlatform === "windows"
    ? [{ name: "Executable", extensions: ["exe"] }]
    : [{ name: "All Files", extensions: ["*"] }];

  const selected = await open({
    title: "Select Doom Engine (UZDoom or GZDoom)",
    filters,
    directory: false,
    multiple: false,
  });
  if (selected) {
    const path = typeof selected === "string" ? selected : selected[0];
    const fileName = path.split(/[/\\]/).pop()?.toLowerCase() ?? "";
    if (!fileName.includes("gzdoom") && !fileName.includes("uzdoom")) {
      const expectedFormat = currentPlatform === "macos" ? "UZDoom.app or GZDoom.app"
        : currentPlatform === "windows" ? "gzdoom.exe or uzdoom.exe"
        : "gzdoom or uzdoom";
      errorMsg.value = `"${fileName}" doesn't appear to be a Doom engine. Please select ${expectedFormat}`;
      return;
    }

    // macOS: Derive executable path from .app bundle
    // Windows/Linux: Use path directly (it's already the executable)
    let execPath = path;
    if (currentPlatform === "macos" && path.endsWith(".app")) {
      const execName = fileName.replace(".app", "").toLowerCase();
      execPath = `${path}/Contents/MacOS/${execName}`;
    }

    await setGZDoomPath(execPath);
    errorMsg.value = "";
  }
}

async function browseLibrary() {
  const selected = await open({
    title: "Select Data Folder",
    directory: true,
    multiple: false,
  });
  if (selected) {
    const path = typeof selected === "string" ? selected : selected[0];
    await setLibraryPath(path);
    await detectIwads();
  }
}

function shortenPath(path: string | null): string {
  if (!path) return "Not found";
  // macOS: /Users/username/... -> ~/...
  const macHome = path.match(/^\/Users\/[^/]+/)?.[0];
  if (macHome) return path.replace(macHome, "~");
  // Windows: C:\Users\username\... or C:/Users/username/... -> ~/...
  // (Tauri may return forward slashes even on Windows)
  const winHome = path.match(/^[A-Za-z]:[/\\]Users[/\\][^/\\]+/)?.[0];
  if (winHome) return path.replace(winHome, "~");
  // Linux: /home/username/... -> ~/...
  const linuxHome = path.match(/^\/home\/[^/]+/)?.[0];
  if (linuxHome) return path.replace(linuxHome, "~");
  return path;
}

function getEngineName(path: string | null): string {
  if (!path) return "";
  if (path.toLowerCase().includes("uzdoom")) return "UZDoom";
  if (path.toLowerCase().includes("gzdoom")) return "GZDoom";
  return "Doom engine";
}

</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-bold tracking-tight">Settings</h1>

    <div v-if="errorMsg" class="rounded bg-red-900/50 p-3 text-red-200 text-sm">{{ errorMsg }}</div>

    <div class="space-y-4">
      <!-- Doom Engine Path -->
      <div class="rounded-lg bg-zinc-800/50 p-4">
        <div class="flex items-center justify-between">
          <div>
            <label class="text-sm font-medium text-zinc-300">Doom Engine</label>
            <p class="text-sm text-zinc-500 mt-1">{{ shortenPath(settings.gzdoomPath) }}</p>
            <template v-if="settings.gzdoomPath">
              <p class="text-xs mt-1" :class="isFirstRun ? 'text-green-400' : 'text-zinc-400'">
                <span v-if="isFirstRun">Detected </span>{{ getEngineName(settings.gzdoomPath) }} <span v-if="engineVersion">{{ engineVersion }}</span>
              </p>
            </template>
            <template v-else>
              <p class="text-xs text-red-400 mt-1">No GZDoom or UZDoom found. Check if it is installed or browse to select it.</p>
            </template>
          </div>
          <button
            class="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-600"
            @click="browseGZDoom"
          >
            Browse
          </button>
        </div>
      </div>

      <!-- Data Folder -->
      <div class="rounded-lg bg-zinc-800/50 p-4">
        <div class="flex items-center justify-between">
          <div>
            <label class="text-sm font-medium text-zinc-300">Data Folder</label>
            <p class="text-sm text-zinc-500 mt-1">{{ shortenPath(settings.libraryPath) }}</p>
            <p class="text-xs text-zinc-500 mt-1">Place IWADs in the <code class="bg-zinc-700 px-1 rounded">iwads</code> subfolder. Saves and statistics will also be stored here.</p>
            <p v-for="group in migratedIwadsBySource" :key="group.from" class="text-xs text-green-400 mt-1">
              Copied {{ group.names }} from {{ group.from }}
            </p>
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
        <p class="text-sm text-zinc-400 mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <span v-for="iwad in requiredIwads" :key="iwad" class="whitespace-nowrap inline-flex items-center gap-1">
            <Check v-if="availableIwads.includes(iwad)" class="w-4 h-4 text-green-400" />
            <X v-else class="w-4 h-4 text-red-400" />
            {{ iwad }}.wad
          </span>
        </p>
        <p v-if="!hasAnyIwad" class="text-xs text-red-400 mt-2">
          No IWADs found. Place WAD files in {{ shortenPath(settings.libraryPath) }}/iwads/.
        </p>
      </div>

      <!-- Import from GOG -->
      <div class="rounded-lg bg-zinc-800/50 p-4">
        <div class="flex items-center justify-between">
          <div>
            <label class="text-sm font-medium text-zinc-300">Import IWADs from GOG</label>
            <p class="text-sm text-zinc-500 mt-1">Select installer, e.g. <code class="text-zinc-400">setup_doom_plus_doom_ii_...exe</code></p>
            <p v-if="gogImportResult" class="text-xs mt-1" :class="gogImportResult.success ? 'text-green-400' : 'text-red-400'">
              {{ gogImportResult.message }}
            </p>
          </div>
          <button
            class="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="gogImporting"
            @click="handleGOGButtonClick"
          >
            {{ gogImporting ? "Extracting..." : (hasInnoextract ? "Import" : "Check innoextract") }}
          </button>
        </div>
      </div>

    </div>
  </div>
</template>
