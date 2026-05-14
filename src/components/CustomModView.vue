<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
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
  editWad?: WadEntry | null;
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
  { value: "megawad",          label: "Megawad — full game replacement (15+ maps)" },
  { value: "episode",          label: "Episode — themed set, ~9 maps" },
  { value: "single-level",     label: "Single level — one map" },
  { value: "total-conversion", label: "Total conversion — standalone game (own weapons/art)" },
  { value: "gameplay-mod",     label: "Gameplay mod — weapons/monsters, stacks on a WAD" },
  { value: "deathmatch",       label: "Deathmatch — multiplayer arena maps" },
];

type ValueKind = "none" | "skill" | "map" | "file" | "int" | "cvar";

interface FlagDef {
  flag: string;
  description: string;
  valueKind: ValueKind;
}

const KNOWN_FLAGS: FlagDef[] = [
  { flag: "-skill",      description: "set difficulty (1=ITYTD … 5=Nightmare!)", valueKind: "skill" },
  { flag: "-warp",       description: "jump to a specific map",                  valueKind: "map" },
  { flag: "-fast",       description: "fast monsters",                           valueKind: "none" },
  { flag: "-respawn",    description: "monsters respawn",                        valueKind: "none" },
  { flag: "-nomonsters", description: "empty maps",                              valueKind: "none" },
  { flag: "-file",       description: "load extra WAD/PK3 (dependencies)",       valueKind: "file" },
  { flag: "-loadgame",   description: "auto-load save slot (0–9)",               valueKind: "int" },
  { flag: "-nomusic",    description: "disable music",                           valueKind: "none" },
  { flag: "-nosound",    description: "disable all audio",                       valueKind: "none" },
  { flag: "-deathmatch", description: "enable deathmatch",                       valueKind: "none" },
  { flag: "-altdeath",   description: "alt deathmatch (items respawn)",          valueKind: "none" },
  { flag: "-timer",      description: "round time limit (minutes)",              valueKind: "int" },
  { flag: "+set",        description: "set any CVAR (advanced)",                 valueKind: "cvar" },
];

const SKILL_OPTIONS = [
  { value: "1", label: "1 — I'm Too Young To Die" },
  { value: "2", label: "2 — Hey, Not Too Rough" },
  { value: "3", label: "3 — Hurt Me Plenty" },
  { value: "4", label: "4 — Ultra-Violence" },
  { value: "5", label: "5 — Nightmare!" },
];

function defaultValuesFor(kind: ValueKind): string[] {
  switch (kind) {
    case "none":  return [];
    case "skill": return ["4"];
    case "map":   return [""];
    case "file":  return [""];
    case "int":   return [""];
    case "cvar":  return ["", ""];
  }
}

function flagDefFor(flag: string): FlagDef | undefined {
  return KNOWN_FLAGS.find(f => f.flag === flag);
}

type ArgRow =
  | { kind: "known"; flag: string; values: string[] }
  | { kind: "custom"; raw: string };

const { base, wadFile } = useLibrary();
const { registerSyntheticDownload, getDownloadInfo } = useDownload();
const { customWads, addCustomWad, updateCustomWad } = useCustomWads();
const { settings } = useSettings();

const editing = computed(() => props.editWad != null);

function rowsFromTokens(tokens: string[]): ArgRow[] {
  const out: ArgRow[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    const def = flagDefFor(tok);
    if (def) {
      const need = def.valueKind === "none" ? 0 : def.valueKind === "cvar" ? 2 : 1;
      const values: string[] = [];
      for (let j = 0; j < need && i + 1 + j < tokens.length; j++) values.push(tokens[i + 1 + j]);
      if (def.valueKind === "cvar") while (values.length < 2) values.push("");
      else if (need === 1 && values.length === 0) values.push("");
      out.push({ kind: "known", flag: tok, values });
      i += 1 + values.length;
    } else {
      const start = i;
      i++;
      while (i < tokens.length && !flagDefFor(tokens[i])) i++;
      out.push({ kind: "custom", raw: tokens.slice(start, i).join(" ") });
    }
  }
  return out;
}

const sourcePath = ref<string>("");
const title = ref<string>("");
const entryType = ref<WadEntry["type"]>(props.defaultType);
const iwad = ref<Iwad>("doom2");
const rows = ref<ArgRow[]>([]);
const errorMsg = ref<string>("");
const submitting = ref(false);

const pickerOpen = ref(false);
const pickerRef = ref<HTMLElement | null>(null);

function handleDocClick(e: MouseEvent) {
  if (!pickerOpen.value) return;
  const t = e.target as Node | null;
  if (pickerRef.value && t && !pickerRef.value.contains(t)) {
    pickerOpen.value = false;
  }
}
function handleKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape" && pickerOpen.value) pickerOpen.value = false;
}

onMounted(() => {
  if (props.editWad) {
    const w = props.editWad;
    const info = getDownloadInfo(w.slug);
    sourcePath.value = info?.filename ?? "";
    title.value = w.title;
    entryType.value = w.type;
    iwad.value = w.iwad;
    rows.value = rowsFromTokens(w.extraArgs);
  } else {
    sourcePath.value = "";
    title.value = "";
    entryType.value = props.defaultType;
    iwad.value = "doom2";
    rows.value = [];
  }
  errorMsg.value = "";
  submitting.value = false;
  pickerOpen.value = false;
  document.addEventListener("mousedown", handleDocClick);
  document.addEventListener("keydown", handleKeyDown);
});
onUnmounted(() => {
  document.removeEventListener("mousedown", handleDocClick);
  document.removeEventListener("keydown", handleKeyDown);
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

const engineName = computed(() => {
  const raw = settings.value.gzdoomPath;
  if (!raw) return "gzdoom";
  const baseName = raw.split(/[\\/]/).pop() ?? "gzdoom";
  const dot = baseName.lastIndexOf(".");
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  return stem.toLowerCase().includes("uzdoom") ? "uzdoom" : "gzdoom";
});

const heading = computed(() => editing.value ? "Edit custom WAD or mod" : "Add custom WAD or mod");

const cleanedArgs = computed<string[]>(() => {
  const out: string[] = [];
  for (const row of rows.value) {
    if (row.kind === "known") {
      out.push(row.flag);
      for (const v of row.values.map(x => x.trim()).filter(x => x.length > 0)) {
        out.push(v);
      }
    } else {
      for (const tok of row.raw.split(/\s+/).filter(t => t.length > 0)) {
        out.push(tok);
      }
    }
  }
  return out;
});

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

function addKnownRow(flag: string) {
  const def = flagDefFor(flag);
  if (!def) return;
  rows.value = [...rows.value, { kind: "known", flag, values: defaultValuesFor(def.valueKind) }];
  pickerOpen.value = false;
}

function addCustomRow() {
  rows.value = [...rows.value, { kind: "custom", raw: "" }];
  pickerOpen.value = false;
}

function removeRow(idx: number) {
  const next = [...rows.value];
  next.splice(idx, 1);
  rows.value = next;
}

function setKnownValue(idx: number, n: number, value: string) {
  const next = [...rows.value];
  const row = next[idx];
  if (row.kind !== "known") return;
  const values = [...row.values];
  while (values.length <= n) values.push("");
  values[n] = value;
  next[idx] = { ...row, values };
  rows.value = next;
}

function setCustomValue(idx: number, value: string) {
  const next = [...rows.value];
  const row = next[idx];
  if (row.kind !== "custom") return;
  next[idx] = { ...row, raw: value };
  rows.value = next;
}

async function pickArgFile(idx: number) {
  const picked = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "Doom files", extensions: ["wad", "pk3"] }],
  });
  if (typeof picked !== "string") return;
  setKnownValue(idx, 0, picked);
}

async function onSubmit() {
  errorMsg.value = "";
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    if (editing.value && props.editWad) {
      // Edit path: keep slug + file + _source; refresh user-editable fields.
      const updated: WadEntry = {
        ...props.editWad,
        title: title.value.trim(),
        iwad: iwad.value,
        type: entryType.value,
        extraArgs: cleanedArgs.value,
      };
      const parsed = WadEntrySchema.safeParse(updated);
      if (!parsed.success) {
        console.error("[CustomModView] Edited entry failed schema:", parsed.error.format());
        throw new Error("Internal error: edited entry doesn't match schema. See console.");
      }
      await updateCustomWad(parsed.data);
      emit("added", parsed.data);
      return;
    }

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
            v-if="!editing"
            type="button"
            class="rounded bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-600"
            @click="pickFile"
          >Browse…</button>
        </div>
        <p v-if="editing" class="text-xs text-zinc-500">File can't be changed. Delete and re-add to swap files.</p>
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
            v-for="(row, idx) in rows"
            :key="idx"
            class="flex items-center gap-2"
          >
            <template v-if="row.kind === 'known'">
              <span class="inline-flex items-center rounded bg-zinc-800 px-2.5 py-1.5 font-mono text-sm font-medium text-zinc-100 whitespace-nowrap">
                {{ row.flag }}
              </span>

              <template v-if="flagDefFor(row.flag)?.valueKind === 'none'">
                <span class="flex-1 text-sm text-zinc-500">{{ flagDefFor(row.flag)?.description }}</span>
              </template>

              <template v-else-if="flagDefFor(row.flag)?.valueKind === 'skill'">
                <div class="relative flex-1">
                  <select
                    :value="row.values[0] ?? ''"
                    class="w-full appearance-none rounded border border-zinc-700 bg-zinc-900 pl-3 pr-9 py-2 text-sm text-zinc-100 focus:border-red-600 focus:outline-none"
                    @change="setKnownValue(idx, 0, ($event.target as HTMLSelectElement).value)"
                  >
                    <option v-for="s in SKILL_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
                  </select>
                  <svg
                    class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500"
                    width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"
                    aria-hidden="true"
                  >
                    <path d="M3 4.5L6 7.5L9 4.5"/>
                  </svg>
                </div>
              </template>

              <template v-else-if="flagDefFor(row.flag)?.valueKind === 'map'">
                <input
                  :value="row.values[0] ?? ''"
                  type="text"
                  class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-red-600 focus:outline-none"
                  placeholder="MAP01"
                  @input="setKnownValue(idx, 0, ($event.target as HTMLInputElement).value)"
                />
              </template>

              <template v-else-if="flagDefFor(row.flag)?.valueKind === 'file'">
                <input
                  :value="row.values[0] ?? ''"
                  type="text"
                  class="flex-1 min-w-0 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-red-600 focus:outline-none"
                  placeholder="path to .wad / .pk3"
                  @input="setKnownValue(idx, 0, ($event.target as HTMLInputElement).value)"
                />
                <button
                  type="button"
                  class="rounded bg-zinc-700 px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-600"
                  @click="pickArgFile(idx)"
                >Browse…</button>
              </template>

              <template v-else-if="flagDefFor(row.flag)?.valueKind === 'int'">
                <input
                  :value="row.values[0] ?? ''"
                  type="number"
                  class="w-32 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-red-600 focus:outline-none"
                  @input="setKnownValue(idx, 0, ($event.target as HTMLInputElement).value)"
                />
                <span class="flex-1 text-xs text-zinc-500">{{ flagDefFor(row.flag)?.description }}</span>
              </template>

              <template v-else-if="flagDefFor(row.flag)?.valueKind === 'cvar'">
                <input
                  :value="row.values[0] ?? ''"
                  type="text"
                  class="flex-1 min-w-0 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-red-600 focus:outline-none"
                  placeholder="cvar name (e.g. sv_cheats)"
                  @input="setKnownValue(idx, 0, ($event.target as HTMLInputElement).value)"
                />
                <input
                  :value="row.values[1] ?? ''"
                  type="text"
                  class="w-28 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-red-600 focus:outline-none"
                  placeholder="value"
                  @input="setKnownValue(idx, 1, ($event.target as HTMLInputElement).value)"
                />
              </template>
            </template>

            <template v-else>
              <input
                :value="row.raw"
                type="text"
                class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-red-600 focus:outline-none"
                placeholder="e.g. +sv_friction 0.5"
                @input="setCustomValue(idx, ($event.target as HTMLInputElement).value)"
              />
            </template>

            <button
              type="button"
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-zinc-800 text-lg leading-none text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
              :aria-label="`Remove row ${idx + 1}`"
              title="Remove arg"
              @click="removeRow(idx)"
            >&minus;</button>
          </div>

          <!-- Add-arg button + picker popover. Lives inside the rows container so
               it sits as the line directly below the last row. -->
          <div ref="pickerRef" class="relative">
            <button
              type="button"
              class="flex w-full items-center justify-center rounded border border-dashed border-zinc-700 bg-zinc-900/40 px-3 py-2 text-sm font-medium text-zinc-400 hover:border-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-100"
              @click="pickerOpen = !pickerOpen"
            >+ Add arg</button>

            <div
              v-if="pickerOpen"
              class="absolute bottom-full left-0 z-20 mb-1 max-h-96 w-[28rem] max-w-[90vw] overflow-y-auto rounded border border-zinc-700 bg-zinc-900 shadow-xl"
              role="menu"
            >
              <button
                v-for="f in KNOWN_FLAGS"
                :key="f.flag"
                type="button"
                class="flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-800"
                role="menuitem"
                @click="addKnownRow(f.flag)"
              >
                <span class="w-28 shrink-0 font-mono font-medium text-zinc-100">{{ f.flag }}</span>
                <span class="text-zinc-400">{{ f.description }}</span>
              </button>
              <div class="border-t border-zinc-800"></div>
              <button
                type="button"
                class="flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-800"
                role="menuitem"
                @click="addCustomRow"
              >
                <span class="w-28 shrink-0 font-mono font-medium text-zinc-100">Custom…</span>
                <span class="text-zinc-400">type any flag or args manually</span>
              </button>
            </div>
          </div>
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
        {{ submitting ? (editing ? "Saving…" : "Adding…") : (editing ? "Save changes" : "Add to library") }}
      </button>
    </div>
  </div>
</template>
