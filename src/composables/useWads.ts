import { ref, computed } from "vue";
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
  const loading = ref(false);
  const error = ref<string | null>(null);
  const { customWads } = useCustomWads();

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

  // loadState() is intentionally NOT called here. The library path lives in
  // settings, which App.vue initialises in its own onMounted; if we called
  // loadState() from this composable's onMounted we'd race with
  // initSettings() and read from an empty library path. App.vue calls
  // useCustomWads().loadState() explicitly after initSettings().
  return { wads, loading, error };
}
