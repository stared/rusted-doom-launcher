<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { stat, exists, writeFile } from "@tauri-apps/plugin-fs";
import { WadEntrySchema, type WadEntry, type Iwad } from "../lib/schema";
import { useLibrary } from "../composables/useLibrary";
import { useDownload } from "../composables/useDownload";
import { useCustomWads } from "../composables/useCustomWads";
import { useSettings } from "../composables/useSettings";
import { inspectFile, parseInfoText, type FileInspection } from "../lib/wadInspect";
import { findGameFilesInZip, selectPrimaryGameFile } from "../lib/zipExtract";
import { strFromU8 } from "fflate";

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
// When false, the picked file is referenced in place — we skip the copy
// into the library and record the absolute path on the synthetic download
// record. Default true (the safer "you own a clean library" mode).
const copyToLibrary = ref<boolean>(true);
const title = ref<string>("");
const author = ref<string>("");
const year = ref<number>(new Date().getFullYear());
const entryType = ref<WadEntry["type"]>(props.defaultType);
const iwad = ref<Iwad>("doom2");
const rows = ref<ArgRow[]>([]);
const errorMsg = ref<string>("");
const submitting = ref(false);
const inspection = ref<FileInspection | null>(null);
const inspecting = ref(false);
// When user picks a .zip bundle, we hold the extracted inner .wad/.pk3 bytes
// here so onSubmit can write them to the library (vs. file-to-file copy used
// for bare .wad/.pk3). innerName is the basename we'll save as.
const pickedZip = ref<{ innerName: string; innerBytes: Uint8Array } | null>(null);

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
    rows.value = rowsFromTokens(w.extraArgs);
  } else {
    sourcePath.value = "";
    title.value = "";
    author.value = "";
    year.value = new Date().getFullYear();
    entryType.value = props.defaultType;
    iwad.value = "doom2";
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

const effectiveFilename = computed<string>(() => {
  // When the user opts out of copying, the launch will use the path they
  // picked verbatim — show that in the command preview so it matches
  // reality (including the .zip extension if they picked one).
  if (!copyToLibrary.value && sourcePath.value) return sourcePath.value;
  if (pickedZip.value) return pickedZip.value.innerName;
  return sourcePath.value ? basenameOf(sourcePath.value) : "";
});

const commandPreview = computed(() => {
  const iwadFile = `${iwad.value}.wad`;
  const fileToken = effectiveFilename.value || "<file>";
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
    // idgames bundles (.zip) carry the .txt sidecar + .wad together, so we
    // can pre-fill title/author/year reliably. List zip first as the
    // preferred input; .wad/.pk3 stays as the bare-file path.
    filters: [
      { name: "Doom zip bundle (recommended)", extensions: ["zip"] },
      { name: "Doom WAD or PK3", extensions: ["wad", "pk3"] },
    ],
  });
  if (typeof picked !== "string") return;
  sourcePath.value = picked;
  inspection.value = null;
  pickedZip.value = null;
  inspecting.value = true;
  try {
    const sourceBytes = await invoke<number[]>("read_file_for_inspection", { sourcePath: picked });
    const sourceBasename = basenameOf(picked);
    const sourceExt = sourceBasename.toLowerCase().split(".").pop() ?? "";

    // What we inspect (and ultimately copy into the library) depends on whether
    // the picked file is a raw .wad/.pk3 or a .zip bundle that contains one.
    let innerName = sourceBasename;
    let innerBytes = new Uint8Array(sourceBytes);
    let zipSidecarText = "";

    if (sourceExt === "zip") {
      const zipBytes = new Uint8Array(sourceBytes);
      const gameFiles = findGameFilesInZip(zipBytes);  // throws if none
      const { primary } = selectPrimaryGameFile(gameFiles);
      innerName = primary.name;
      innerBytes = primary.data;
      // Read any .txt at the zip root (the idgames upload-template sidecar).
      // We scan all entries since "Beautiful Doom" style PK3s nest the .txt
      // inside a single folder.
      const { unzipSync } = await import("fflate");
      const entries = unzipSync(zipBytes);
      for (const [path, data] of Object.entries(entries)) {
        if (!path.toLowerCase().endsWith(".txt")) continue;
        const text = strFromU8(data);
        if (/^\s*Title\s*:/im.test(text) || /^\s*Authors?\s*:/im.test(text)) {
          zipSidecarText = text;
          break;
        }
      }
      pickedZip.value = { innerName, innerBytes };
    }

    const info = await inspectFile(innerName, innerBytes);
    if (info.isIwad) {
      throw new Error("This file is an IWAD (base game). Base games are managed in Settings, not added as custom mods.");
    }
    inspection.value = info;

    // Idgames-format metadata sources, in priority order:
    //   1. .txt at the root of the picked .zip (richest, 100% on idgames bundles)
    //   2. sibling .txt next to a bare .wad/.pk3 (when user kept the .txt after extracting)
    //   3. .txt at root of a .pk3 (Beautiful Doom etc.)
    //   The inspector already covers (3) inside info.author/info.year.
    let sidecarTitle = "";
    let sidecarAuthor = info.author;
    let sidecarYear = info.year;

    if (zipSidecarText) {
      const parsed = parseInfoText(zipSidecarText);
      if (parsed.author) sidecarAuthor = parsed.author;
      if (parsed.year) sidecarYear = parsed.year;
      if (parsed.title) sidecarTitle = parsed.title;
    } else if (sourceExt !== "zip") {
      try {
        const sibling = await invoke<string>("read_sibling_text", { sourcePath: picked });
        if (sibling) {
          const parsed = parseInfoText(sibling);
          if (!sidecarAuthor && parsed.author) sidecarAuthor = parsed.author;
          if (!sidecarYear && parsed.year) sidecarYear = parsed.year;
          if (parsed.title) sidecarTitle = parsed.title;
        }
      } catch (e) {
        console.warn("[CustomModView] sibling .txt scan failed:", e);
      }
    }

    // Pre-fill fields. Only overwrite a field if the user hasn't typed one yet.
    if (title.value.trim().length === 0) {
      title.value = sidecarTitle || info.firstMapTitle || stripExtension(innerName);
    }
    if (author.value.trim().length === 0 && sidecarAuthor) {
      author.value = sidecarAuthor;
    }
    if (sidecarYear > 0) {
      year.value = sidecarYear;
    }
    entryType.value = info.suggestedType;
    iwad.value = info.suggestedIwad;
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
watch(inspection, (info, prev) => {
  if (titlepicPreviewUrl.value) {
    URL.revokeObjectURL(titlepicPreviewUrl.value);
    titlepicPreviewUrl.value = "";
  }
  if (info?.titlepic) {
    const blob = new Blob([new Uint8Array(info.titlepic.png)], { type: "image/png" });
    titlepicPreviewUrl.value = URL.createObjectURL(blob);
  }
  // prev unused, just here to keep the watcher signature happy.
  void prev;
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
    if (editing.value && props.editWad) {
      // Edit path: keep slug + file + _source; refresh user-editable fields.
      const updated: WadEntry = {
        ...props.editWad,
        title: title.value.trim(),
        authors: [{ name: author.value.trim() || "User import" }],
        year: year.value,
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

    // Three modes, branching on copyToLibrary + zip-pick:
    //   A) copy=on,  bare .wad/.pk3 → fs::copy via import_custom_wad
    //   B) copy=on,  .zip          → write inner bytes via plugin-fs writeFile
    //   C) copy=off, bare or zip   → reference the picked path in place;
    //                                 nothing lands in the library folder.
    //
    // When copy=off the launcher uses externalPath on the synthetic download
    // record and never deletes the file on Remove. The picked .zip is fine
    // to pass to GZDoom as -file (GZDoom can load archives directly).
    const sourceFilename = pickedZip.value ? pickedZip.value.innerName : basenameOf(sourcePath.value);
    const targetPath = wadFile(sourceFilename);
    const sourceIsTarget = !pickedZip.value && sourcePath.value === targetPath;

    let actualSize: number;
    let externalPath = "";
    let externalFilename = "";

    if (!copyToLibrary.value) {
      // External reference: pick the path GZDoom will actually launch with.
      // For a .zip pick we point at the zip itself (no inner extraction);
      // for a bare .wad/.pk3 we point at it directly.
      externalPath = sourcePath.value;
      externalFilename = basenameOf(sourcePath.value);
      try {
        const st = await stat(sourcePath.value);
        actualSize = st.size;
      } catch {
        actualSize = pickedZip.value?.innerBytes.length ?? 0;
      }
    } else if (pickedZip.value) {
      if (!sourceIsTarget && await exists(targetPath)) {
        throw new Error(`A file named "${sourceFilename}" already exists in the library. Rename it or remove it before importing.`);
      }
      await writeFile(targetPath, pickedZip.value.innerBytes);
      actualSize = pickedZip.value.innerBytes.length;
    } else if (sourceIsTarget) {
      const st = await stat(targetPath);
      actualSize = st.size;
    } else {
      if (await exists(targetPath)) {
        throw new Error(`A file named "${sourceFilename}" already exists in the library. Rename it or remove it before importing.`);
      }
      actualSize = await invoke<number>("import_custom_wad", {
        sourcePath: sourcePath.value,
        targetPath,
      });
    }

    const baseSlug = kebab(title.value.trim());
    if (baseSlug.length === 0) throw new Error("Title must contain at least one letter or number.");
    const slug = makeUniqueSlug(baseSlug);

    // If the inspector decoded a TITLEPIC, embed it as a data: URL on the
    // entry's thumbnail. The card renders <img :src="wad.thumbnail"> which
    // works out of the box for data URLs — no Tauri asset-protocol setup or
    // CSP changes needed. Cost: a ~70 KB PNG becomes ~93 KB base64 inside
    // custom-wads.json. Acceptable for the typical few-entries case.
    let thumbnail = "";
    if (inspection.value?.titlepic) {
      const bytes = inspection.value.titlepic.png;
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      thumbnail = `data:image/png;base64,${btoa(bin)}`;
    }

    const entry: WadEntry = {
      slug,
      title: title.value.trim(),
      authors: [{ name: author.value.trim() || "User import" }],
      year: year.value,
      description: "User-imported mod.",
      iwad: iwad.value,
      type: entryType.value,
      sourcePort: "gzdoom",
      requires: [],
      downloads: [],
      thumbnail,
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

    const recordedFilename = externalFilename || sourceFilename;
    await registerSyntheticDownload(slug, {
      filename: recordedFilename,
      wadFilename: recordedFilename,
      size: actualSize,
      externalPath,
    });
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

        <label v-if="!editing && sourcePath" class="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            v-model="copyToLibrary"
            class="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-red-600 focus:ring-red-600"
          />
          <span class="text-sm text-zinc-300">Copy file to library</span>
        </label>

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
