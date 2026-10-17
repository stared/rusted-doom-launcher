<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { ZipEntryInfo } from "../lib/zipExtract";

const props = defineProps<{
  open: boolean;
  archivePath: string;
  title: string;
}>();

const emit = defineEmits<{ close: [] }>();

const entries = ref<ZipEntryInfo[]>([]);
const selectedPath = ref("");
const content = ref("");
const loading = ref(false);
const error = ref("");
const dialog = ref<HTMLElement | null>(null);
const dialogSize = ref<{ width: number; height: number } | null>(null);

const TEXT_EXTENSIONS = new Set(["txt", "md", "nfo", "cfg", "ini", "acs", "zs", "zsc", "txt"]);
const TEXT_FILENAMES = new Set(["readme", "readme.txt", "license", "copying", "credits", "changelog"]);
const MAX_TEXT_BYTES = 16 * 1024 * 1024;

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function isTextFile(entry: ZipEntryInfo): boolean {
  const name = basename(entry.path).toLowerCase();
  const ext = name.split(".").pop() ?? "";
  return TEXT_FILENAMES.has(name) || TEXT_EXTENSIONS.has(ext);
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const textEntries = computed(() => entries.value.filter(isTextFile));
const selectedEntry = computed(() => entries.value.find(entry => entry.path === selectedPath.value) ?? null);

function stopResize() {
  window.removeEventListener("pointermove", resizeDialog);
  window.removeEventListener("pointerup", stopResize);
  resizeStart = null;
}

let resizeStart: { x: number; y: number; width: number; height: number } | null = null;
function resizeDialog(event: PointerEvent) {
  if (!resizeStart) return;
  dialogSize.value = {
    width: Math.max(640, Math.min(resizeStart.width + event.clientX - resizeStart.x, window.innerWidth * 0.9)),
    height: Math.max(448, Math.min(resizeStart.height + event.clientY - resizeStart.y, window.innerHeight * 0.9)),
  };
}

function startResize(event: PointerEvent) {
  const rect = dialog.value?.getBoundingClientRect();
  if (!rect) return;
  event.preventDefault();
  resizeStart = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
  window.addEventListener("pointermove", resizeDialog);
  window.addEventListener("pointerup", stopResize, { once: true });
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}

watch(() => props.open, (open) => {
  if (open) window.addEventListener("keydown", closeOnEscape);
  else window.removeEventListener("keydown", closeOnEscape);
}, { immediate: true });

onBeforeUnmount(() => {
  stopResize();
  window.removeEventListener("keydown", closeOnEscape);
});
async function selectFile(entry: ZipEntryInfo) {
  selectedPath.value = entry.path;
  content.value = "";
  error.value = "";
  if (!isTextFile(entry)) return;
  if (entry.size > MAX_TEXT_BYTES) {
    error.value = `${entry.path} is too large to display (${formatSize(entry.size)}).`;
    return;
  }
  loading.value = true;
  try {
    const data = await invoke<ArrayBuffer>("read_zip_entry", {
      zipPath: props.archivePath,
      entryPath: entry.path,
    });
    content.value = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(data));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function loadArchive() {
  entries.value = [];
  selectedPath.value = "";
  content.value = "";
  error.value = "";
  if (!props.open || !props.archivePath) return;
  loading.value = true;
  try {
    entries.value = await invoke<ZipEntryInfo[]>("list_zip_entries", { zipPath: props.archivePath });
    const preferred = textEntries.value.find(entry => /^readme(?:\.txt)?$/i.test(basename(entry.path))) ?? textEntries.value[0];
    if (preferred) await selectFile(preferred);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

watch(() => [props.open, props.archivePath], loadArchive, { immediate: true });
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70" @click.self="emit('close')">
      <section
        ref="dialog"
        class="relative flex h-[65vh] min-h-[28rem] w-[56rem] max-h-[90vh] max-w-[90vw] flex-col overflow-hidden rounded-lg bg-zinc-800 shadow-xl"
        :style="dialogSize ? { width: `${dialogSize.width}px`, height: `${dialogSize.height}px` } : undefined"
      >
        <header class="flex items-center justify-between border-b border-zinc-700 p-4">
          <div>
            <h2 class="text-lg font-semibold text-zinc-100">{{ title }} — archive files</h2>
            <p class="text-xs text-zinc-500">{{ entries.length }} files · {{ textEntries.length }} text files</p>
          </div>
          <button class="text-zinc-400 hover:text-zinc-200" title="Close" @click="emit('close')">✕</button>
        </header>

        <div class="grid min-h-0 flex-1 grid-cols-[minmax(11rem,0.4fr)_minmax(24rem,1.6fr)]">
          <div class="min-h-0 overflow-auto border-r border-zinc-700 p-2">
            <p class="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Archive contents</p>
            <button
              v-for="entry in entries"
              :key="entry.path"
              class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-700"
              :class="selectedPath === entry.path ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-300'"
              @click="selectFile(entry)"
            >
              <span class="min-w-0 flex-1 break-all font-mono text-xs">{{ entry.path }}</span>
              <span class="shrink-0 text-xs text-zinc-500">{{ formatSize(entry.size) }}</span>
            </button>
          </div>

          <div class="min-h-0 overflow-auto bg-zinc-950 p-4">
            <p v-if="loading" class="text-sm text-zinc-400">Loading…</p>
            <p v-else-if="error" class="whitespace-pre-wrap text-sm text-red-300">{{ error }}</p>
            <template v-else-if="selectedEntry">
              <p class="mb-3 break-all font-mono text-xs text-zinc-500">{{ selectedEntry.path }}</p>
              <pre v-if="isTextFile(selectedEntry)" class="whitespace-pre-wrap break-words font-mono text-sm text-zinc-200">{{ content }}</pre>
              <p v-else class="text-sm text-zinc-400">This is not a text file. Select a text file from the archive to view its contents.</p>
            </template>
            <p v-else class="text-sm text-zinc-400">This archive has no text files to preview.</p>
          </div>
        </div>
        <button
          class="absolute bottom-0 right-0 flex h-7 w-7 cursor-nwse-resize items-end justify-end bg-zinc-700/80 pb-0.5 pr-0.5 text-xs leading-none text-zinc-300 hover:bg-red-600 hover:text-white"
          title="Resize window"
          aria-label="Resize window"
          @pointerdown="startResize"
        >◢</button>
      </section>
    </div>
  </Teleport>
</template>
