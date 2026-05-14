import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { WadEntrySchema, type WadEntry } from "../lib/schema";
import { useLibrary } from "./useLibrary";

interface CustomWadsFile {
  version: 1;
  entries: WadEntry[];
}

// Singleton state - shared across all callers (mirrors useDownload's pattern).
const customWads = ref<WadEntry[]>([]);
const loaded = ref(false);

export function useCustomWads() {
  const { base } = useLibrary();

  async function loadState() {
    const raw = await invoke<unknown>("read_custom_wads", { libraryPath: base() });
    const file = raw as CustomWadsFile;
    const parsed: WadEntry[] = [];
    for (const entry of file.entries ?? []) {
      const result = WadEntrySchema.safeParse(entry);
      if (result.success) {
        parsed.push(result.data);
      } else {
        console.error("[useCustomWads] Invalid custom-wads.json entry:", result.error.format(), entry);
      }
    }
    customWads.value = parsed;
    loaded.value = true;
  }

  async function saveState() {
    const file: CustomWadsFile = { version: 1, entries: customWads.value };
    await invoke("write_custom_wads", { libraryPath: base(), state: file });
  }

  async function addCustomWad(entry: WadEntry) {
    customWads.value = [...customWads.value, entry];
    await saveState();
  }

  async function updateCustomWad(entry: WadEntry) {
    customWads.value = customWads.value.map(w => w.slug === entry.slug ? entry : w);
    await saveState();
  }

  async function removeCustomWad(slug: string) {
    customWads.value = customWads.value.filter(w => w.slug !== slug);
    await saveState();
  }

  function hasSlug(slug: string): boolean {
    return customWads.value.some(w => w.slug === slug);
  }

  return { customWads, loaded, loadState, addCustomWad, updateCustomWad, removeCustomWad, hasSlug };
}
