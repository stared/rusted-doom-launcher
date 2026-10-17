<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  X,
  Database,
  FolderOpen,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  FileCheck,
  Tag,
  Save,
  BarChart2,
  Loader2,
  Search,
} from "@lucide/vue";
import { useDoomLauncherImport } from "../composables/useDoomLauncherImport";
import { useSettings } from "../composables/useSettings";
import { useCustomWads } from "../composables/useCustomWads";
import { catalogWads } from "../composables/useWads";
import { findCatalogMatch } from "../lib/catalogMatch";
import { kebab } from "../lib/slug";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  imported: [];
}>();

const {
  inspecting,
  verifying,
  importing,
  error,
  inspection,
  verification,
  importSummary,
  inspectDatabase,
  verifyFiles,
  executeImport,
  reset,
} = useDoomLauncherImport();
const { settings, rememberDoomLauncherImport } = useSettings();
const { customWads } = useCustomWads();

const step = ref<1 | 2 | 3 | 4>(1);

// Step 1: Database Path
const dbPath = ref("");

// Step 2: Remapping
const sourceRoot = ref("");
const targetRoot = ref("");

// Step 3: Options
const importMetadata = ref(true);
const importTags = ref(true);
const importSaves = ref(true);
const importStats = ref(true);
const copyToLibrary = ref(false);
const overwriteExisting = ref(false);

const selectedGameIds = ref<Set<number>>(new Set());
const gameSearch = ref("");

// Reset on modal open
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      step.value = 1;
      reset();
      const lastMapping = settings.value.doomLauncherImports[0];
      dbPath.value = lastMapping?.dbPath ?? "";
      sourceRoot.value = lastMapping?.sourceRoot ?? "";
      targetRoot.value = lastMapping?.targetRoot ?? "";
      selectedGameIds.value = new Set();
    }
  }
);

async function browseDatabase() {
  const selected = await openDialog({
    title: "Select DoomLauncher.sqlite Database",
    filters: [{ name: "SQLite Database", extensions: ["sqlite", "db", "sqlite3"] }],
    directory: false,
    multiple: false,
  });
  if (!selected) return;

  const path = typeof selected === "string" ? selected : selected[0];
  dbPath.value = path;
  const res = await inspectDatabase(path);
  if (res) {
    const savedMapping = settings.value.doomLauncherImports.find(entry => entry.dbPath === path);
    sourceRoot.value = savedMapping?.sourceRoot || res.detected_root;
    targetRoot.value = savedMapping?.targetRoot ?? "";
    // Pre-select all games
    selectUnimportedGames();
  }
}

async function browseTargetFolder() {
  const selected = await openDialog({
    title: "Select Local Folder containing Game Files",
    directory: true,
    multiple: false,
  });
  if (!selected) return;

  targetRoot.value = typeof selected === "string" ? selected : selected[0];
}

async function handleNextFromStep1() {
  if (!inspection.value) {
    const res = await inspectDatabase(dbPath.value);
    if (!res) return;
    if (!sourceRoot.value) sourceRoot.value = res.detected_root;
    selectUnimportedGames();
  }
  step.value = 2;
}

async function handleNextFromStep2() {
  await rememberDoomLauncherImport({
    dbPath: dbPath.value,
    sourceRoot: sourceRoot.value,
    targetRoot: targetRoot.value,
  });
  step.value = 3;
}

async function handleNextFromStep3() {
  // Trigger verification before moving to step 4
  const res = await verifyFiles(dbPath.value, sourceRoot.value, targetRoot.value);
  if (res) {
    step.value = 4;
  }
}

const filteredGames = computed(() => {
  if (!inspection.value) return [];
  const q = gameSearch.value.toLowerCase().trim();
  if (!q) return inspection.value.games_preview;
  return inspection.value.games_preview.filter(
    (g) =>
      g.title.toLowerCase().includes(q) ||
      g.filename.toLowerCase().includes(q) ||
      g.author.toLowerCase().includes(q) ||
      g.tags.some((t) => t.toLowerCase().includes(q))
  );
});

// Keep this slug allocation in sync with the Rust verifier so an already
// imported game can be recognized before the user reaches verification.
const importSlugs = computed(() => {
  const slugs = new Map<number, string>();
  const used = new Set<string>();
  for (const game of inspection.value?.games_preview ?? []) {
    const catalog = findCatalogMatch(catalogWads, game.title, game.filename);
    if (catalog) {
      slugs.set(game.id, catalog.slug);
      continue;
    }
    const filename = game.filename.replace(/\\/g, "/").split("/").pop() ?? "";
    const base = kebab(game.title) || kebab(filename) || `dl-game-${game.id}`;
    let slug = `custom-${base}`;
    let counter = 2;
    while (used.has(slug)) slug = `custom-${base}-${counter++}`;
    used.add(slug);
    slugs.set(game.id, slug);
  }
  return slugs;
});

const catalogMatches = computed(() => Object.fromEntries(
  (inspection.value?.games_preview ?? []).flatMap(game => {
    const match = findCatalogMatch(catalogWads, game.title, game.filename);
    return match ? [[game.id, match.slug]] : [];
  }),
));

function alreadyImported(game: { id: number; title: string }): boolean {
  const slug = importSlugs.value.get(game.id);
  if (slug && customWads.value.some(wad => wad.slug === slug)) return true;
  // Imports created by older app versions used a custom slug even when the
  // title is now recognized by the catalog. Keep them disabled by default;
  // enabling overwrite performs the safe catalog adoption in the backend.
  return !!catalogMatches.value[game.id] && customWads.value.some(wad =>
    wad._source === "custom" && wad.title.trim().toLocaleLowerCase() === game.title.trim().toLocaleLowerCase(),
  );
}

function selectableGameIds(): number[] {
  return (inspection.value?.games_preview ?? [])
    .filter(game => overwriteExisting.value || !alreadyImported(game))
    .map(game => game.id);
}

function canImport(game: { id: number; title: string }): boolean {
  return overwriteExisting.value || !alreadyImported(game);
}

function selectUnimportedGames() {
  selectedGameIds.value = new Set(selectableGameIds());
}

function toggleAllGames(select: boolean) {
  if (!inspection.value) return;
  if (select) {
    selectUnimportedGames();
  } else {
    selectedGameIds.value = new Set();
  }
}

function toggleGame(id: number) {
  const game = inspection.value?.games_preview.find(candidate => candidate.id === id);
  if (game && !canImport(game)) return;
  const next = new Set(selectedGameIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedGameIds.value = next;
}

function useSavedMapping(databasePath: string) {
  const mapping = settings.value.doomLauncherImports.find(entry => entry.dbPath === databasePath);
  if (!mapping) return;
  dbPath.value = mapping.dbPath;
  sourceRoot.value = mapping.sourceRoot;
  targetRoot.value = mapping.targetRoot;
  inspection.value = null;
}

async function runImport() {
  const options = {
    db_path: dbPath.value,
    source_root: sourceRoot.value,
    target_root: targetRoot.value,
    selected_game_ids: Array.from(selectedGameIds.value),
    import_metadata: importMetadata.value,
    import_tags: importTags.value,
    import_saves: importSaves.value,
    import_stats: importStats.value,
    copy_to_library: copyToLibrary.value,
    overwrite_existing: overwriteExisting.value,
    catalog_matches: catalogMatches.value,
  };

  const res = await executeImport(options);
  if (res) {
    emit("imported");
  }
}

function handleDone() {
  emit("close");
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 animate-in fade-in duration-200"
  >
    <div
      class="flex flex-col w-full max-w-3xl max-h-[90vh] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/50">
        <div class="flex items-center gap-3">
          <div class="p-2 rounded-lg bg-red-600/10 border border-red-600/20 text-red-500">
            <Database :size="20" />
          </div>
          <div>
            <h2 class="text-lg font-semibold text-zinc-100">DoomLauncher Import Wizard</h2>
            <p class="text-xs text-zinc-400">Migrate WADs, tags, saves, and stats into Rusted Doom Launcher</p>
          </div>
        </div>
        <button
          class="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
          @click="emit('close')"
        >
          <X :size="18" />
        </button>
      </div>

      <!-- Step Indicator -->
      <div class="flex items-center justify-between px-6 py-2.5 bg-zinc-950/30 border-b border-zinc-800/60 text-xs">
        <div
          class="flex items-center gap-2"
          :class="step === 1 ? 'text-red-400 font-medium' : step > 1 ? 'text-emerald-400' : 'text-zinc-500'"
        >
          <span
            class="flex items-center justify-center w-5 h-5 rounded-full text-[10px]"
            :class="step === 1 ? 'bg-red-500/20 text-red-300' : step > 1 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-800 text-zinc-400'"
          >1</span>
          Database
        </div>
        <div class="h-px w-6 bg-zinc-800" />
        <div
          class="flex items-center gap-2"
          :class="step === 2 ? 'text-red-400 font-medium' : step > 2 ? 'text-emerald-400' : 'text-zinc-500'"
        >
          <span
            class="flex items-center justify-center w-5 h-5 rounded-full text-[10px]"
            :class="step === 2 ? 'bg-red-500/20 text-red-300' : step > 2 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-800 text-zinc-400'"
          >2</span>
          Path Mapping
        </div>
        <div class="h-px w-6 bg-zinc-800" />
        <div
          class="flex items-center gap-2"
          :class="step === 3 ? 'text-red-400 font-medium' : step > 3 ? 'text-emerald-400' : 'text-zinc-500'"
        >
          <span
            class="flex items-center justify-center w-5 h-5 rounded-full text-[10px]"
            :class="step === 3 ? 'bg-red-500/20 text-red-300' : step > 3 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-800 text-zinc-400'"
          >3</span>
          Items & Selection
        </div>
        <div class="h-px w-6 bg-zinc-800" />
        <div
          class="flex items-center gap-2"
          :class="step === 4 ? 'text-red-400 font-medium' : 'text-zinc-500'"
        >
          <span
            class="flex items-center justify-center w-5 h-5 rounded-full text-[10px]"
            :class="step === 4 ? 'bg-red-500/20 text-red-300' : 'bg-zinc-800 text-zinc-400'"
          >4</span>
          Verify & Import
        </div>
      </div>

      <!-- Error alert -->
      <div
        v-if="error"
        class="mx-6 mt-4 p-3 bg-red-950/40 border border-red-800/60 rounded-lg flex items-center gap-3 text-red-300 text-sm"
      >
        <AlertTriangle :size="18" class="shrink-0 text-red-400" />
        <span>{{ error }}</span>
      </div>

      <!-- Body Content -->
      <div class="flex-1 overflow-y-auto p-6 min-h-[320px]">
        <!-- STEP 1: Select Database -->
        <div v-if="step === 1" class="space-y-5">
          <div>
            <label class="block text-sm font-medium text-zinc-300 mb-1.5">
              Select DoomLauncher.sqlite file
            </label>
            <div class="flex gap-2">
              <input
                v-model="dbPath"
                type="text"
                placeholder="/path/to/DoomLauncher.sqlite"
                class="flex-1 px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-red-500"
              />
              <button
                class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                @click="browseDatabase"
              >
                <FolderOpen :size="16" />
                Browse
              </button>
            </div>
            <div v-if="settings.doomLauncherImports.length > 1" class="mt-2 flex flex-wrap items-center gap-1.5">
              <span class="text-[11px] text-zinc-500">Recent mappings:</span>
              <button
                v-for="mapping in settings.doomLauncherImports.slice(1)"
                :key="mapping.dbPath"
                type="button"
                class="max-w-64 truncate rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                :title="mapping.dbPath"
                @click="useSavedMapping(mapping.dbPath)"
              >{{ mapping.dbPath }}</button>
            </div>
          </div>

          <div v-if="inspecting" class="flex items-center justify-center py-8 gap-3 text-zinc-400">
            <Loader2 :size="20" class="animate-spin text-red-500" />
            <span>Inspecting SQLite schema and tables...</span>
          </div>

          <div
            v-else-if="inspection"
            class="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-4 space-y-3"
          >
            <div class="flex items-center gap-2 text-emerald-400 text-sm font-medium">
              <CheckCircle2 :size="16" />
              <span>Database inspected successfully</span>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div class="bg-zinc-900/80 p-3 rounded-lg border border-zinc-800">
                <span class="text-xs text-zinc-500 block">Total Games</span>
                <span class="text-lg font-bold text-zinc-100">{{ inspection.total_games }}</span>
              </div>
              <div class="bg-zinc-900/80 p-3 rounded-lg border border-zinc-800">
                <span class="text-xs text-zinc-500 block">Unique Tags</span>
                <span class="text-lg font-bold text-zinc-100">{{ inspection.total_tags }}</span>
              </div>
              <div class="bg-zinc-900/80 p-3 rounded-lg border border-zinc-800 col-span-2">
                <span class="text-xs text-zinc-500 block">Detected Root Prefix</span>
                <span class="text-xs font-mono text-zinc-300 truncate block mt-0.5">
                  {{ inspection.detected_root || '(None / relative GameFiles)' }}
                </span>
              </div>
            </div>

            <div v-if="inspection.tags.length > 0" class="pt-2">
              <span class="text-xs text-zinc-400 font-medium block mb-1.5">Tags Found:</span>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="t in inspection.tags"
                  :key="t"
                  class="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 text-xs border border-zinc-700/60"
                >
                  {{ t }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- STEP 2: Path Remapping -->
        <div v-if="step === 2" class="space-y-5">
          <p class="text-sm text-zinc-400">
            DoomLauncher stores game file paths as they were on the original system (often Windows paths like <code class="text-zinc-300">H:\Games\DoomMods\...</code>).
            Files inside DoomLauncher's own <code class="text-zinc-300">GameFiles/</code> folder (next to the database) are auto-detected. Specify where external custom files are located.
          </p>

          <div class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-zinc-400 mb-1">
                Original Path Prefix (detected from database)
              </label>
              <input
                v-model="sourceRoot"
                type="text"
                placeholder="e.g. H:\Games\Doom\DoomMods\Games"
                class="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-red-500"
              />
            </div>

            <div>
              <label class="block text-xs font-medium text-zinc-400 mb-1">
                New Local Directory (where external game files or DoomMods folder are located)
              </label>
              <div class="flex gap-2">
                <input
                  v-model="targetRoot"
                  type="text"
                  placeholder="e.g. ~/Games/DoomMods or /home/user/Games/DoomMods"
                  class="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-red-500"
                />
                <button
                  class="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors"
                  @click="browseTargetFolder"
                >
                  <FolderOpen :size="15" />
                  Select Folder
                </button>
              </div>
              <p class="text-[11px] text-zinc-500 mt-1">
                The importer searches direct matches, subfolders (<code class="text-zinc-400">Games</code>, <code class="text-zinc-400">Enhancement</code>, <code class="text-zinc-400">UI</code>, <code class="text-zinc-400">SaveGames</code>), and the database's own <code class="text-zinc-400">GameFiles/</code> directory. Supports <code class="text-zinc-400">~/</code> paths.
              </p>
            </div>
          </div>
        </div>

        <!-- STEP 3: Items & Data Selection -->
        <div v-if="step === 3" class="space-y-5">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="flex items-center gap-2.5 p-3 rounded-lg bg-zinc-950 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition-colors">
              <input v-model="importMetadata" type="checkbox" class="rounded accent-red-600 w-4 h-4" />
              <span class="flex items-center gap-2 text-sm text-zinc-200">
                <FileCheck :size="16" class="text-blue-400" />
                <span>WAD Metadata</span>
              </span>
            </label>

            <label class="flex items-center gap-2.5 p-3 rounded-lg bg-zinc-950 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition-colors">
              <input v-model="importTags" type="checkbox" class="rounded accent-red-600 w-4 h-4" />
              <span class="flex items-center gap-2 text-sm text-zinc-200">
                <Tag :size="16" class="text-yellow-400" />
                <span>Categories & Tags</span>
              </span>
            </label>

            <label class="flex items-center gap-2.5 p-3 rounded-lg bg-zinc-950 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition-colors">
              <input v-model="importSaves" type="checkbox" class="rounded accent-red-600 w-4 h-4" />
              <span class="flex items-center gap-2 text-sm text-zinc-200">
                <Save :size="16" class="text-purple-400" />
                <span>Save Files (.zds)</span>
              </span>
            </label>

            <label class="flex items-center gap-2.5 p-3 rounded-lg bg-zinc-950 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition-colors">
              <input v-model="importStats" type="checkbox" class="rounded accent-red-600 w-4 h-4" />
              <span class="flex items-center gap-2 text-sm text-zinc-200">
                <BarChart2 :size="16" class="text-emerald-400" />
                <span>Play Statistics</span>
              </span>
            </label>
          </div>

          <div class="p-3 bg-zinc-950/60 border border-zinc-800 rounded-lg">
            <label class="flex items-center gap-2.5 cursor-pointer">
              <input v-model="copyToLibrary" type="checkbox" class="rounded accent-red-600 w-4 h-4" />
              <span class="block">
                <span class="text-sm font-medium text-zinc-200">Copy files into RDL library directory</span>
                <span class="block text-xs text-zinc-400 mt-0.5">
                  When unchecked, WADs are launched directly from their original location (<code class="text-zinc-300">externalPath</code>).
                </span>
              </span>
            </label>
          </div>

          <label class="flex items-start gap-2.5 p-3 rounded-lg bg-zinc-950/60 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition-colors">
            <input v-model="overwriteExisting" type="checkbox" class="mt-0.5 rounded accent-red-600 w-4 h-4" />
            <span class="block">
              <span class="text-sm font-medium text-zinc-200">Overwrite existing imports</span>
              <span class="block text-xs text-zinc-400 mt-0.5">Off by default. Lets you restore a prior import; recognized catalog WADs are also adopted from Custom into the catalog.</span>
            </span>
          </label>

          <div class="rounded-lg border border-amber-800/50 bg-amber-950/20 p-3 text-xs text-zinc-300">
            <p class="font-medium text-amber-300">Running this import again</p>
            <p class="mt-1 leading-relaxed text-zinc-400">
              WADs that were imported before are automatically unselected and cannot be imported again. Enable overwrite above only when you want to restore one. If overwrite stays off, existing metadata, rating, saves, and stats remain unchanged.
            </p>
          </div>

          <!-- Games List Table -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-zinc-400">
                Select WADs to import ({{ selectedGameIds.size }} of {{ selectableGameIds().length }} available):
              </span>
              <div class="flex gap-2">
                <button
                  class="text-xs text-red-400 hover:text-red-300"
                  @click="toggleAllGames(true)"
                >
                  Select All
                </button>
                <span class="text-zinc-600 text-xs">|</span>
                <button
                  class="text-xs text-zinc-400 hover:text-zinc-300"
                  @click="toggleAllGames(false)"
                >
                  Deselect All
                </button>
              </div>
            </div>

            <div class="relative">
              <Search :size="14" class="absolute left-3 top-2.5 text-zinc-500" />
              <input
                v-model="gameSearch"
                type="text"
                placeholder="Search games by title, author, tag, or filename..."
                class="w-full pl-8 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-red-500"
              />
            </div>

            <div class="max-h-52 overflow-y-auto border border-zinc-800 rounded-lg bg-zinc-950/40 divide-y divide-zinc-800/60">
              <div
                v-for="g in filteredGames"
                :key="g.id"
                class="flex items-center justify-between px-3 py-2"
                :class="!canImport(g) ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-zinc-800/40'"
                @click="toggleGame(g.id)"
              >
                <div class="flex items-center gap-2.5 overflow-hidden">
                  <input
                    type="checkbox"
                    :checked="selectedGameIds.has(g.id)"
                    :disabled="!canImport(g)"
                    class="rounded accent-red-600 w-3.5 h-3.5"
                    @click.stop="toggleGame(g.id)"
                  />
                  <div class="truncate">
                    <span class="text-xs font-medium text-zinc-200">{{ g.title }}</span>
                    <span class="text-[11px] text-zinc-500 block truncate">{{ g.filename }}</span>
                    <span v-if="alreadyImported(g)" class="text-[10px] text-amber-400">Already imported</span>
                  </div>
                </div>

                <div class="flex items-center gap-1.5 shrink-0 pl-2">
                  <span
                    v-for="t in g.tags.slice(0, 2)"
                    :key="t"
                    class="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400"
                  >
                    {{ t }}
                  </span>
                  <span
                    v-if="g.saves_count > 0"
                    class="px-1.5 py-0.5 rounded text-[10px] bg-purple-950 text-purple-300 border border-purple-800/50"
                  >
                    {{ g.saves_count }} saves
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- STEP 4: Verification Checklist & Import -->
        <div v-if="step === 4" class="space-y-5">
          <div v-if="verifying" class="flex items-center justify-center py-12 gap-3 text-zinc-400">
            <Loader2 :size="20" class="animate-spin text-red-500" />
            <span>Verifying files on disk and resolving paths...</span>
          </div>

          <div v-else-if="importSummary" class="text-center py-8 space-y-4">
            <div class="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 :size="28" />
            </div>
            <div>
              <h3 class="text-base font-semibold text-zinc-100">DoomLauncher Import Complete!</h3>
              <p class="text-xs text-zinc-400 mt-1">Your library, tags, saves, and stats have been updated.</p>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-md mx-auto pt-2">
              <div class="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                <span class="text-xs text-zinc-500 block">Games</span>
                <span class="text-base font-bold text-zinc-200">{{ importSummary.imported_games }}</span>
              </div>
              <div class="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                <span class="text-xs text-zinc-500 block">Tags</span>
                <span class="text-base font-bold text-zinc-200">{{ importSummary.imported_tags }}</span>
              </div>
              <div class="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                <span class="text-xs text-zinc-500 block">Saves</span>
                <span class="text-base font-bold text-zinc-200">{{ importSummary.imported_saves }}</span>
              </div>
              <div class="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                <span class="text-xs text-zinc-500 block">Stats</span>
                <span class="text-base font-bold text-zinc-200">{{ importSummary.imported_stats }}</span>
              </div>
            </div>
          </div>

          <div v-else-if="verification" class="space-y-4">
            <!-- Verification report box -->
            <div
              class="p-4 rounded-xl border"
              :class="verification.matched > 0 ? 'bg-zinc-950/80 border-zinc-800' : 'bg-yellow-950/20 border-yellow-800/40'"
            >
              <div class="flex items-center justify-between">
                <div>
                  <h4 class="text-sm font-semibold text-zinc-200">File Verification Report</h4>
                  <p class="text-xs text-zinc-400 mt-0.5">
                    Found <strong class="text-emerald-400">{{ verification.matched }}</strong> of
                    <strong>{{ verification.total }}</strong> game files on disk.
                  </p>
                </div>
                <div class="flex items-center gap-2 text-xs">
                  <span
                    class="px-2.5 py-1 rounded-full font-medium"
                    :class="verification.matched === verification.total ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'"
                  >
                    {{ Math.round((verification.matched / (verification.total || 1)) * 100) }}% Ready
                  </span>
                </div>
              </div>

              <!-- Missing files warning -->
              <div v-if="verification.missing.length > 0" class="mt-4 pt-3 border-t border-zinc-800/60">
                <div class="flex items-center gap-2 text-amber-400 text-xs font-medium mb-2">
                  <AlertTriangle :size="14" />
                  <span>{{ verification.missing.length }} file(s) not found in mapped folder:</span>
                </div>
                <div class="max-h-24 overflow-y-auto bg-zinc-900/60 rounded p-2 text-[11px] font-mono text-zinc-400 space-y-0.5">
                  <div v-for="m in verification.missing" :key="m">
                    • {{ m }}
                  </div>
                </div>
                <p class="text-[11px] text-zinc-500 mt-1.5">
                  Entries with missing files will be safely skipped during import.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer navigation -->
      <div class="flex items-center justify-between px-6 py-4 border-t border-zinc-800 bg-zinc-950/60">
        <button
          v-if="step > 1 && !importSummary"
          class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
          :disabled="importing || verifying"
          @click="step = (step - 1) as any"
        >
          <ArrowLeft :size="14" />
          Back
        </button>
        <div v-else />

        <div class="flex items-center gap-2">
          <button
            v-if="!importSummary"
            class="px-4 py-2 text-zinc-400 hover:text-zinc-200 text-xs font-medium"
            @click="emit('close')"
          >
            Cancel
          </button>

          <!-- Step 1 Next -->
          <button
            v-if="step === 1"
            class="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
            :disabled="!dbPath || inspecting"
            @click="handleNextFromStep1"
          >
            <span>Next: Path Mapping</span>
            <ArrowRight :size="14" />
          </button>

          <!-- Step 2 Next -->
          <button
            v-if="step === 2"
            class="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
            @click="handleNextFromStep2"
          >
            <span>Next: Select Items</span>
            <ArrowRight :size="14" />
          </button>

          <!-- Step 3 Next -->
          <button
            v-if="step === 3"
            class="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
            :disabled="selectedGameIds.size === 0"
            @click="handleNextFromStep3"
          >
            <span>Verify & Review</span>
            <ArrowRight :size="14" />
          </button>

          <!-- Step 4 Import Action -->
          <button
            v-if="step === 4 && !importSummary"
            class="px-5 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
            :disabled="importing || verifying || (verification ? verification.matched === 0 : true)"
            @click="runImport"
          >
            <Loader2 v-if="importing" :size="14" class="animate-spin" />
            <span>{{ importing ? 'Importing Library...' : `Import ${verification?.matched || 0} Game(s)` }}</span>
          </button>

          <!-- Done Button -->
          <button
            v-if="importSummary"
            class="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors"
            @click="handleDone"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
