import { ref, computed, onMounted } from "vue";
import { WadEntry, WadEntrySchema } from "../lib/schema";
import { useCustomWads } from "./useCustomWads";

const wadModules = import.meta.glob<{ default: unknown }>("../../content/wads/*.json", { eager: true });

// Catalog is build-time static — parse once at module load.
const catalogWads: WadEntry[] = [];
for (const [path, module] of Object.entries(wadModules)) {
  const result = WadEntrySchema.safeParse(module.default);
  if (result.success) {
    catalogWads.push(result.data);
  } else {
    console.error(`WAD validation failed for ${path}:`, result.error.format());
  }
}
const catalogSlugs = new Set(catalogWads.map(w => w.slug));

export function useWads() {
  const loading = ref(true);
  const error = ref<string | null>(null);
  const { customWads, loadState: loadCustomWads } = useCustomWads();

  // Catalog wins on slug collisions — custom entries with a clashing slug
  // are dropped from the merged list (the file on disk is left alone so
  // the user can pick a different title and re-import).
  const wads = computed<WadEntry[]>(() => {
    const merged = [
      ...catalogWads,
      ...customWads.value.filter(w => !catalogSlugs.has(w.slug)),
    ];
    return merged.sort((a, b) => a.title.localeCompare(b.title));
  });

  onMounted(async () => {
    try {
      await loadCustomWads();
    } catch (e) {
      // A missing/unreadable custom-wads.json should not kill the whole list.
      console.error("[useWads] Failed to load custom wads:", e);
    } finally {
      loading.value = false;
    }
  });

  return { wads, loading, error };
}
