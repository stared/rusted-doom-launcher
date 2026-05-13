<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { stat, exists } from "@tauri-apps/plugin-fs";
import { WadEntrySchema, type WadEntry, type Iwad } from "../lib/schema";
import { useLibrary } from "../composables/useLibrary";
import { useDownload } from "../composables/useDownload";
import { useCustomWads } from "../composables/useCustomWads";
import { useSettings } from "../composables/useSettings";

const props = defineProps<{
  defaultType: WadEntry["type"];
}>();

const emit = defineEmits<{
  cancel: [];
  added: [wad: WadEntry];
}>();

const IWADS: { value: Iwad; label: string }[] = [
  { value: "doom2", label: "Doom II" },
  { value: "doom", label: "Doom" },
  { value: "plutonia", label: "Plutonia" },
  { value: "tnt", label: "TNT: Evilution" },
  { value: "heretic", label: "Heretic" },
  { value: "hexen", label: "Hexen" },
  { value: "freedoom2", label: "Freedoom Phase 2" },
  { value: "freedoom1", label: "Freedoom Phase 1" },
];

const TYPES: { value: WadEntry["type"]; label: string }[] = [
  { value: "megawad", label: "Megawad" },
  { value: "episode", label: "Episode" },
  { value: "single-level", label: "Single level" },
  { value: "total-conversion", label: "Total conversion" },
  { value: "gameplay-mod", label: "Gameplay mod" },
  { value: "deathmatch", label: "Deathmatch" },
];

const { base, wadFile } = useLibrary();
const { registerSyntheticDownload } = useDownload();
const { customWads, addCustomWad } = useCustomWads();
const { settings } = useSettings();

const sourcePath = ref<string>("");
const title = ref<string>("");
const entryType = ref<WadEntry["type"]>(props.defaultType);
const iwad = ref<Iwad>("doom2");
const extraArgs = ref<string[]>([""]);
const errorMsg = ref<string>("");
const submitting = ref(false);

onMounted(() => {
  sourcePath.value = "";
  title.value = "";
  entryType.value = props.defaultType;
  iwad.value = "doom2";
  extraArgs.value = [""];
  errorMsg.value = "";
  submitting.value = false;
});

function basenameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function kebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function makeUniqueSlug(baseSlug: string): string {
  const existing = new Set(customWads.value.map(w => w.slug));
  let slug = `custom-${baseSlug}`;
  if (!existing.has(slug)) return slug;
  for (let i = 2; i < 100; i++) {
    const candidate = `custom-${baseSlug}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error(`Could not allocate slug for "${baseSlug}" — too many duplicates.`);
}

// Strip path + extension off the configured engine binary so the preview
// shows "gzdoom" / "uzdoom" instead of "/Applications/.../gzdoom".
const engineName = computed(() => {
  const raw = settings.value.gzdoomPath;
  if (!raw) return "gzdoom";
  const baseName = raw.split(/[\\/]/).pop() ?? "gzdoom";
  const dot = baseName.lastIndexOf(".");
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  return stem.toLowerCase().includes("uzdoom") ? "uzdoom" : "gzdoom";
});

const heading = "Add custom WAD or mod";

const cleanedArgs = computed(() =>
  extraArgs.value.map(a => a.trim()).filter(a => a.length > 0)
);

const commandPreview = computed(() => {
  const iwadFile = `${iwad.value}.wad`;
  const fileToken = sourcePath.value ? basenameOf(sourcePath.value) : "<file>";
  const parts = [engineName.value, "-iwad", iwadFile, "-file", fileToken, ...cleanedArgs.value];
  return parts.join(" ");
});

const canSubmit = computed(() =>
  sourcePath.value.length > 0 && title.value.trim().length > 0 && !submitting.value
);

async function pickFile() {
  errorMsg.value = "";
  const picked = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "Doom files", extensions: ["wad", "pk3"] }],
  });
  if (typeof picked !== "string") return;
  sourcePath.value = picked;
  if (title.value.trim().length === 0) {
    title.value = stripExtension(basenameOf(picked));
  }
}

function addArgRow() {
  extraArgs.value = [...extraArgs.value, ""];
}

function removeArgRow(idx: number) {
  const next = [...extraArgs.value];
  next.splice(idx, 1);
  // Always keep at least one empty row visible so the user has a place to type.
  extraArgs.value = next.length === 0 ? [""] : next;
}

function updateArg(idx: number, value: string) {
  const next = [...extraArgs.value];
  next[idx] = value;
  extraArgs.value = next;
}

async function onSubmit() {
  errorMsg.value = "";
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    const libraryRoot = base();
    if (!libraryRoot) {
      throw new Error("Library path is not set. Configure it in Settings first.");
    }

    const sourceFilename = basenameOf(sourcePath.value);
    const targetPath = wadFile(sourceFilename);
    const sourceIsTarget = sourcePath.value === targetPath;

    if (!sourceIsTarget && await exists(targetPath)) {
      throw new Error(`A file named "${sourceFilename}" already exists in the library. Rename it or remove it before importing.`);
    }

    let actualSize: number;
    if (sourceIsTarget) {
      const st = await stat(targetPath);
      actualSize = st.size;
    } else {
      actualSize = await invoke<number>("import_custom_wad", {
        sourcePath: sourcePath.value,
        targetPath,
      });
    }

    const baseSlug = kebab(title.value.trim());
    if (baseSlug.length === 0) throw new Error("Title must contain at least one letter or number.");
    const slug = makeUniqueSlug(baseSlug);

    const entry: WadEntry = {
      slug,
      title: title.value.trim(),
      authors: [{ name: "User import" }],
      year: new Date().getFullYear(),
      description: "User-imported mod.",
      iwad: iwad.value,
      type: entryType.value,
      sourcePort: "gzdoom",
      requires: [],
      downloads: [],
      thumbnail: "",
      screenshots: [],
      youtubeVideos: [],
      awards: [],
      tags: [],
      difficulty: "unknown",
      urls: [],
      notes: "",
      extraArgs: cleanedArgs.value,
      _schemaVersion: 1,
      _source: "custom",
    };

    const parsed = WadEntrySchema.safeParse(entry);
    if (!parsed.success) {
      console.error("[CustomModView] Built entry failed schema:", parsed.error.format());
      throw new Error("Internal error: imported entry doesn't match schema. See console.");
    }

    await registerSyntheticDownload(slug, { filename: sourceFilename, wadFilename: sourceFilename, size: actualSize });
    await addCustomWad(parsed.data);

    emit("added", parsed.data);
  } catch (e) {
    console.error("[CustomModView] Import failed:", e);
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="space-y-6 max-w-2xl">
    <h1 class="text-2xl font-bold tracking-tight">{{ heading }}</h1>

    <div v-if="errorMsg" class="rounded bg-red-900/50 p-3 text-sm text-red-200">{{ errorMsg }}</div>

    <div class="space-y-5">
      <!-- File -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium text-zinc-300">File</label>
        <div class="flex gap-2">
          <input
            :value="sourcePath || ''"
            class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
            readonly
            placeholder="Click Browse to pick a .wad or .pk3 file"
          />
          <button
            type="button"
            class="rounded bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-600"
            @click="pickFile"
          >Browse…</button>
        </div>
      </div>

      <!-- Title -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium text-zinc-300">Title</label>
        <input
          v-model="title"
          type="text"
          class="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-red-600 focus:outline-none"
          placeholder="e.g. Ashes Blackwater"
        />
      </div>

      <!-- Type -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium text-zinc-300">Type</label>
        <div class="relative">
          <select
            v-model="entryType"
            class="w-full appearance-none rounded border border-zinc-700 bg-zinc-900 pl-3 pr-9 py-2 text-sm text-zinc-100 focus:border-red-600 focus:outline-none"
          >
            <option v-for="t in TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
          <svg
            class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500"
            width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"
            aria-hidden="true"
          >
            <path d="M3 4.5L6 7.5L9 4.5"/>
          </svg>
        </div>
      </div>

      <!-- IWAD -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium text-zinc-300">Base game (IWAD)</label>
        <div class="relative">
          <select
            v-model="iwad"
            class="w-full appearance-none rounded border border-zinc-700 bg-zinc-900 pl-3 pr-9 py-2 text-sm text-zinc-100 focus:border-red-600 focus:outline-none"
          >
            <option v-for="i in IWADS" :key="i.value" :value="i.value">{{ i.label }}</option>
          </select>
          <svg
            class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500"
            width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"
            aria-hidden="true"
          >
            <path d="M3 4.5L6 7.5L9 4.5"/>
          </svg>
        </div>
      </div>

      <!-- Extra args -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium text-zinc-300">Extra args</label>
        <div class="space-y-2">
          <div
            v-for="(arg, idx) in extraArgs"
            :key="idx"
            class="flex gap-2"
          >
            <input
              :value="arg"
              type="text"
              class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-red-600 focus:outline-none"
              placeholder="e.g. -warp"
              @input="updateArg(idx, ($event.target as HTMLInputElement).value)"
            />
            <button
              type="button"
              class="flex h-9 w-9 items-center justify-center rounded bg-zinc-800 text-lg leading-none text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
              :aria-label="`Remove row ${idx + 1}`"
              title="Remove arg"
              @click="removeArgRow(idx)"
            >&minus;</button>
          </div>
          <button
            type="button"
            class="flex h-9 w-9 items-center justify-center rounded bg-zinc-800 text-lg leading-none text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
            aria-label="Add arg"
            title="Add arg"
            @click="addArgRow"
          >+</button>
        </div>
      </div>

      <!-- Command preview -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium text-zinc-300">Command preview</label>
        <pre class="overflow-x-auto rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-300">{{ commandPreview }}</pre>
      </div>
    </div>

    <div class="flex justify-end gap-2 pt-4 border-t border-zinc-800">
      <button
        type="button"
        class="rounded bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-600"
        @click="emit('cancel')"
      >Cancel</button>
      <button
        type="button"
        class="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed"
        :disabled="!canSubmit"
        @click="onSubmit"
      >
        {{ submitting ? "Adding…" : "Add to library" }}
      </button>
    </div>
  </div>
</template>
