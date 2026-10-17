<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, useTemplateRef, watch } from "vue";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Tag, Plus, X, Copy, Check } from "@lucide/vue";
import { type WadEntry, type Iwad } from "../lib/schema";
import { IWAD_PICKER_OPTIONS } from "../lib/constants";
import { useDownload } from "../composables/useDownload";
import { useSettings } from "../composables/useSettings";
import { useCustomWads } from "../composables/useCustomWads";
import { useWadRatings } from "../composables/useWadRatings";
import { useLibrary } from "../composables/useLibrary";
import { useGZDoom } from "../composables/useGZDoom";
import { useCustomImport, discardPickedZip, type PickedZip } from "../composables/useCustomImport";
import { type FileInspection } from "../lib/wadInspect";
import { basenameOf } from "../lib/platform";
import {
  KNOWN_FLAGS,
  SKILL_OPTIONS,
  flagDefFor,
  defaultValuesFor,
  rowsFromTokens,
  rowsToTokens,
  type ArgRow,
} from "../lib/extraArgs";

const props = defineProps<{
  defaultType: WadEntry["type"];
  editWad?: WadEntry | null;
}>();

const emit = defineEmits<{
  cancel: [];
  added: [wad: WadEntry];
}>();

const TYPES: { value: WadEntry["type"]; label: string }[] = [
  { value: "megawad",          label: "Megawad — full game replacement (15+ maps)" },
  { value: "episode",          label: "Episode — themed set, ~9 maps" },
  { value: "single-level",     label: "Single level — one map" },
  { value: "total-conversion", label: "Total conversion — standalone game (own weapons/art)" },
  { value: "gameplay-mod",     label: "Gameplay mod — weapons/monsters, stacks on a WAD" },
  { value: "deathmatch",       label: "Deathmatch — multiplayer arena maps" },
];

const { getDownloadInfo } = useDownload();
const { settings } = useSettings();
const { wadFile, iwadFile } = useLibrary();
const { getIwadFilename } = useGZDoom();
const { customWads } = useCustomWads();
const { getRating, setRating } = useWadRatings();
const { inspectPick, importCustomWad, updateCustomEntry } = useCustomImport();

const suggestedTags = computed(() => {
  const set = new Set<string>();
  for (const w of customWads.value) {
    if (w.tags) {
      for (const t of w.tags) {
        if (!tags.value.includes(t)) {
          set.add(t);
        }
      }
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
});

const editing = computed(() => props.editWad != null);

const sourcePath = ref<string>("");
// When false, the picked file is referenced in place — we skip the copy
// into the library and record the absolute path on the synthetic download
// record. Default true (the safer "you own a clean library" mode).
const copyToLibrary = ref<boolean>(true);
const title = ref<string>("");
const author = ref<string>("");
const year = ref<number>(new Date().getFullYear());
const entryType = ref<WadEntry["type"]>(props.defaultType);
const iwad = ref<Iwad>("doom2");
const tags = ref<string[]>([]);
const rating = ref<number>(0);
const tagInput = ref<string>("");
const rows = ref<ArgRow[]>([]);
const errorMsg = ref<string>("");
const submitting = ref(false);
const inspection = ref<FileInspection | null>(null);
const inspecting = ref(false);
// When a ZIP is picked its primary game file is stream-extracted to a temp
// file for inspection. The complete bundle is extracted to the library on
// import; innerName identifies its primary launch file.
const pickedZip = ref<PickedZip | null>(null);

const pickerOpen = ref(false);
const pickerRef = useTemplateRef("pickerRef");

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

function addTag(tagText?: string) {
  const t = (tagText ?? tagInput.value).trim();
  if (t && !tags.value.includes(t)) {
    tags.value.push(t);
  }
  tagInput.value = "";
}

function removeTag(tagToRemove: string) {
  tags.value = tags.value.filter(t => t !== tagToRemove);
}

onMounted(() => {
  if (props.editWad) {
    const w = props.editWad;
    const info = getDownloadInfo(w.slug);
    // For external-reference imports, the absolute path lives on the
    // download record. Show it so the command preview reflects reality
    // instead of an inferred library-relative basename.
    if (info?.externalPath) {
      sourcePath.value = info.externalPath;
      copyToLibrary.value = false;
    } else {
      sourcePath.value = info?.filename ?? "";
      copyToLibrary.value = true;
    }
    title.value = w.title;
    author.value = w.authors.map(a => a.name).join(", ");
    year.value = w.year;
    entryType.value = w.type;
    iwad.value = w.iwad;
    tags.value = [...(w.tags ?? [])];
    rating.value = getRating(w.slug, w.rating);
    rows.value = rowsFromTokens(w.extraArgs);
  } else {
    sourcePath.value = "";
    title.value = "";
    author.value = "";
    year.value = new Date().getFullYear();
    entryType.value = props.defaultType;
    iwad.value = "doom2";
    tags.value = [];
    rating.value = 0;
    rows.value = [];
    copyToLibrary.value = true;
  }
  errorMsg.value = "";
  submitting.value = false;
  pickerOpen.value = false;
  pickedZip.value = null;
  document.addEventListener("mousedown", handleDocClick);
  document.addEventListener("keydown", handleKeyDown);
});
onUnmounted(() => {
  document.removeEventListener("mousedown", handleDocClick);
  document.removeEventListener("keydown", handleKeyDown);
  // Cancel path: a pick-time temp extraction may still be around. (After a
  // successful import this is a harmless no-op — cleanup is idempotent.)
  void discardPickedZip(pickedZip.value);
  if (copiedCommandTimer) clearTimeout(copiedCommandTimer);
});

const engineName = computed(() => {
  const raw = settings.value.gzdoomPath;
  if (!raw) return "gzdoom";
  const baseName = raw.split(/[\\/]/).pop() ?? "gzdoom";
  const dot = baseName.lastIndexOf(".");
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  return stem.toLowerCase().includes("uzdoom") ? "uzdoom" : "gzdoom";
});

const heading = computed(() => editing.value ? "Edit custom WAD or mod" : "Add custom WAD or mod");

const cleanedArgs = computed<string[]>(() => rowsToTokens(rows.value));

const commandFilePath = computed(() => {
  if (!sourcePath.value) return "<file>";
  if (!copyToLibrary.value) return sourcePath.value;
  return wadFile(pickedZip.value?.innerName ?? basenameOf(sourcePath.value));
});

function quoteCommandToken(value: string): string {
  return /[\s"]/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

const commandPreviewGroups = computed(() => {
  const enginePath = settings.value.gzdoomPath || engineName.value;
  // Preserve the detected filename's case. Linux treats DOOM2.WAD and
  // doom2.wad as separate paths, and both IWAD and custom WAD need absolute
  // paths to make the copied command work from any shell directory.
  const detectedIwad = getIwadFilename(iwad.value) ?? `${iwad.value}.wad`;
  const extraGroups = rows.value
    .map(row => rowsToTokens([row]))
    .filter(tokens => tokens.length > 0);
  return [[enginePath], ["-iwad", iwadFile(detectedIwad)], ["-file", commandFilePath.value], ...extraGroups];
});

const commandPreviewParts = computed(() => commandPreviewGroups.value.flat().map(quoteCommandToken));

// The copy action must remain a single argv-compatible line. The preview is
// only formatted for reading, using shell continuations between argument rows.
const commandPreview = computed(() => commandPreviewParts.value.join(" "));
const commandPreviewDisplay = computed(() => {
  const lines = commandPreviewGroups.value
    .map((group, index) => `${index > 0 ? "  " : ""}${group.map(quoteCommandToken).join(" ")}`);
  return lines.map((line, index) => index < lines.length - 1 ? `${line} \\` : line).join("\n");
});

const copiedCommand = ref(false);
let copiedCommandTimer: ReturnType<typeof setTimeout> | null = null;

async function copyCommand() {
  try {
    await navigator.clipboard.writeText(commandPreview.value);
    copiedCommand.value = true;
    if (copiedCommandTimer) clearTimeout(copiedCommandTimer);
    copiedCommandTimer = setTimeout(() => { copiedCommand.value = false; }, 1800);
  } catch (error) {
    console.error("[CustomModView] Failed to copy command:", error);
    errorMsg.value = "Couldn't copy the command. Select and copy it manually.";
  }
}

const canSubmit = computed(() =>
  sourcePath.value.length > 0 && title.value.trim().length > 0 && !submitting.value
);

async function pickFile() {
  errorMsg.value = "";
  const picked = await openDialog({
    multiple: false,
    directory: false,
    // idgames bundles (.zip) carry the .txt sidecar + .wad together, so we
    // can pre-fill title/author/year reliably. List zip first as the
    // preferred input; .wad/.pk3 stays as the bare-file path.
    filters: [
      { name: "Doom zip bundle (recommended)", extensions: ["zip"] },
      { name: "Doom WAD or PK3", extensions: ["wad", "pk3"] },
    ],
  });
  if (typeof picked !== "string") return;
  // A previous pick may have left a temp extraction behind — discard it.
  await discardPickedZip(pickedZip.value);
  sourcePath.value = picked;
  inspection.value = null;
  pickedZip.value = null;
  inspecting.value = true;
  try {
    const result = await inspectPick(picked);
    pickedZip.value = result.pickedZip;
    inspection.value = result.inspection;

    // Pre-fill fields. Only overwrite a field if the user hasn't typed one yet.
    if (title.value.trim().length === 0) {
      title.value = result.title;
    }
    if (author.value.trim().length === 0 && result.author) {
      author.value = result.author;
    }
    if (result.year > 0) {
      year.value = result.year;
    }
    entryType.value = result.inspection.suggestedType;
    iwad.value = result.inspection.suggestedIwad;
  } catch (e) {
    console.error("[CustomModView] Inspection failed:", e);
    errorMsg.value = e instanceof Error ? e.message : String(e);
    sourcePath.value = "";
    pickedZip.value = null;
  } finally {
    inspecting.value = false;
  }
}

const inspectionSummary = computed<string>(() => {
  const info = inspection.value;
  if (!info) return "";
  const parts: string[] = [];
  parts.push(info.format.toUpperCase());
  if (info.mapCount > 0) parts.push(`${info.mapCount} map${info.mapCount === 1 ? "" : "s"}`);
  if (info.hasGameplayCode) parts.push("gameplay code");
  if (info.titlepic) parts.push(`title screen ${info.titlepic.width}×${info.titlepic.height}`);
  return parts.join(" · ");
});

// Build a Blob-URL preview for the decoded titlepic so the form can show
// what the card thumbnail will look like before submit. Revoked when the
// inspection changes.
const titlepicPreviewUrl = ref<string>("");
watch(inspection, (info) => {
  if (titlepicPreviewUrl.value) {
    URL.revokeObjectURL(titlepicPreviewUrl.value);
    titlepicPreviewUrl.value = "";
  }
  if (info?.titlepic) {
    const blob = new Blob([new Uint8Array(info.titlepic.png)], { type: "image/png" });
    titlepicPreviewUrl.value = URL.createObjectURL(blob);
  }
});
onUnmounted(() => {
  if (titlepicPreviewUrl.value) URL.revokeObjectURL(titlepicPreviewUrl.value);
});

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
    const fields = {
      title: title.value,
      author: author.value,
      year: year.value,
      iwad: iwad.value,
      type: entryType.value,
      extraArgs: cleanedArgs.value,
      tags: tags.value,
      rating: rating.value,
    };
    if (editing.value && props.editWad) {
      const updated = await updateCustomEntry(props.editWad, fields);
      await setRating(updated.slug, rating.value);
      emit("added", updated);
      return;
    }
    const entry = await importCustomWad({
      sourcePath: sourcePath.value,
      pickedZip: pickedZip.value,
      copyToLibrary: copyToLibrary.value,
      fields,
      titlepic: inspection.value?.titlepic ?? null,
      urls: inspection.value?.urls ?? [],
    });
    emit("added", entry);
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
            placeholder="Pick a .zip (preferred) or .wad / .pk3"
          />
          <button
            v-if="!editing"
            type="button"
            class="rounded bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-600"
            @click="pickFile"
          >Browse…</button>
        </div>
        <p v-if="editing" class="text-xs text-zinc-500">File can't be changed. Delete and re-add to swap files.</p>
        <p v-else-if="inspecting" class="text-xs text-zinc-500">Inspecting file…</p>
        <p v-else-if="inspectionSummary" class="text-xs text-zinc-400">Detected: {{ inspectionSummary }}</p>

        <label v-if="!editing && sourcePath && !pickedZip" class="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            v-model="copyToLibrary"
            class="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-red-600 focus:ring-red-600"
          />
          <span class="text-sm text-zinc-300">Copy file to library</span>
        </label>
        <p v-else-if="!editing && pickedZip" class="pt-1 text-xs text-zinc-500">
          ZIP archive will be extracted to the library so the contained WAD/PK3 can be launched.
        </p>

        <img v-if="titlepicPreviewUrl" :src="titlepicPreviewUrl" alt="Title screen" class="mt-2 max-h-40 rounded border border-zinc-800" />
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

      <!-- Author + Year (side by side) -->
      <div class="flex gap-3">
        <div class="flex-1 space-y-1.5">
          <label class="text-sm font-medium text-zinc-300">Author</label>
          <input
            v-model="author"
            type="text"
            class="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-red-600 focus:outline-none"
            placeholder="e.g. skillsaw"
          />
        </div>
        <div class="w-32 space-y-1.5">
          <label class="text-sm font-medium text-zinc-300">Year</label>
          <input
            v-model.number="year"
            type="number"
            min="1993"
            class="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-red-600 focus:outline-none"
          />
        </div>
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
            <option v-for="i in IWAD_PICKER_OPTIONS" :key="i.value" :value="i.value">{{ i.label }}</option>
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

      <!-- Tags / Categories -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium text-zinc-300">Rating</label>
        <div class="flex items-center gap-1" role="radiogroup" aria-label="Rating">
          <button
            v-for="star in 5"
            :key="star"
            type="button"
            class="text-2xl leading-none transition-colors"
            :class="star <= rating ? 'text-amber-400' : 'text-zinc-600 hover:text-amber-300'"
            :aria-label="`${star} of 5 stars`"
            :aria-checked="star === rating"
            role="radio"
            @click="rating = rating === star ? 0 : star"
          >★</button>
          <button
            v-if="rating"
            type="button"
            class="ml-2 text-xs text-zinc-500 hover:text-zinc-300"
            @click="rating = 0"
          >Clear</button>
        </div>
      </div>

      <div class="space-y-1.5">
        <label class="text-sm font-medium text-zinc-300 flex items-center gap-1.5">
          <Tag :size="14" class="text-zinc-400" />
          <span>Tags & Categories</span>
        </label>
        <div class="space-y-2">
          <div v-if="tags.length > 0" class="flex flex-wrap gap-1.5">
            <span
              v-for="t in tags"
              :key="t"
              class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-800 text-zinc-200 border border-zinc-700"
            >
              {{ t }}
              <button
                type="button"
                class="text-zinc-400 hover:text-zinc-100 ml-0.5"
                @click="removeTag(t)"
              >
                <X :size="12" />
              </button>
            </span>
          </div>
          <div class="flex gap-2">
            <input
              v-model="tagInput"
              type="text"
              class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-red-600 focus:outline-none"
              placeholder="Add tag (e.g. Slaughter, Cacoward, Favorites)..."
              @keydown.enter.prevent="addTag()"
            />
            <button
              type="button"
              class="rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition-colors flex items-center gap-1"
              @click="addTag()"
            >
              <Plus :size="14" />
              Add
            </button>
          </div>

          <!-- Existing Tag Suggestions -->
          <div v-if="suggestedTags.length > 0" class="flex flex-wrap items-center gap-1.5 pt-1">
            <span class="text-[11px] text-zinc-500">Suggestions:</span>
            <button
              v-for="sug in suggestedTags"
              :key="sug"
              type="button"
              class="px-2 py-0.5 rounded text-[11px] bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 border border-zinc-700/60 transition-colors cursor-pointer"
              @click="addTag(sug)"
            >
              + {{ sug }}
            </button>
          </div>
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
                <template v-if="inspection && inspection.mapNames.length > 0">
                  <div class="relative flex-1">
                    <select
                      :value="row.values[0] ?? ''"
                      class="w-full appearance-none rounded border border-zinc-700 bg-zinc-900 pl-3 pr-9 py-2 font-mono text-sm text-zinc-100 focus:border-red-600 focus:outline-none"
                      @change="setKnownValue(idx, 0, ($event.target as HTMLSelectElement).value)"
                    >
                      <option value="">Pick a map…</option>
                      <option v-for="m in inspection.mapNames" :key="m" :value="m">{{ m }}</option>
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
                <template v-else>
                  <input
                    :value="row.values[0] ?? ''"
                    type="text"
                    class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-red-600 focus:outline-none"
                    placeholder="MAP01"
                    @input="setKnownValue(idx, 0, ($event.target as HTMLInputElement).value)"
                  />
                </template>
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
        <div class="flex items-center justify-between gap-3">
          <label class="text-sm font-medium text-zinc-300">Command preview</label>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
            :title="copiedCommand ? 'Copied' : 'Copy command with full paths'"
            @click="copyCommand"
          >
            <Check v-if="copiedCommand" :size="14" class="text-emerald-400" />
            <Copy v-else :size="14" />
            {{ copiedCommand ? "Copied" : "Copy" }}
          </button>
        </div>
        <pre class="overflow-x-auto rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-300">{{ commandPreviewDisplay }}</pre>
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

<style scoped>
/* Drop the up/down spinner on number inputs. The arrows fight with the
   monospace font alignment and aren't useful for year / save slot / timer
   values the user mostly types directly. */
input[type="number"]::-webkit-inner-spin-button,
input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type="number"] {
  -moz-appearance: textfield;
  appearance: textfield;
}
</style>
