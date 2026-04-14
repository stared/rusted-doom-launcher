<script setup lang="ts">
import { ref, computed } from "vue";
import { Gamepad2 } from "lucide-vue-next";
import FilterBar from "./FilterBar.vue";
import WadList from "./WadList.vue";
import type { WadEntry } from "../lib/schema";
import type { WadSaveInfo } from "../composables/useSaves";
import type { DownloadProgress } from "../composables/useDownload";
import { useWadSummaries } from "../composables/useWadSummaries";

const props = defineProps<{
  wads: WadEntry[];
  loading: boolean;
  error: string | null;
  isDownloaded: (slug: string) => boolean;
  isDownloading: (slug: string) => boolean;
  downloadProgress: Record<string, DownloadProgress>;
  getSaveInfo: (slug: string) => WadSaveInfo | null;
}>();

// Helper to get progress for a specific slug
function getDownloadProgress(slug: string): DownloadProgress | undefined {
  return props.downloadProgress[slug];
}

const emit = defineEmits<{
  play: [wad: WadEntry, extraArgs?: string[]];
  delete: [wad: WadEntry];
  navigate: [view: "explore", query?: string];
}>();

const { getVibe } = useWadSummaries();

// Filter/sort state
const searchQuery = ref("");
const sortBy = ref("last-played");

// Sort options - Last Played is default (most relevant for "resume" context)
const sortOptions = [
  { value: "last-played", label: "Recently Played" },
  { value: "most-saves", label: "Most Saves" },
  { value: "most-maps", label: "Most Maps" },
  { value: "alpha", label: "A-Z" },
];

// WADs that are downloaded OR have saves (ready to play)
const playableWads = computed(() =>
  props.wads.filter(w => {
    const info = props.getSaveInfo(w.slug);
    const hasSaves = info && info.saveCount > 0;
    return props.isDownloaded(w.slug) || hasSaves;
  })
);

// Filtered and sorted WADs
const filteredWads = computed(() => {
  let result = [...playableWads.value];

  // Search filter
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(w =>
      w.title.toLowerCase().includes(q) ||
      w.authors.some(a => a.name.toLowerCase().includes(q))
    );
  }

  // Sort
  result.sort((a, b) => {
    const infoA = props.getSaveInfo(a.slug);
    const infoB = props.getSaveInfo(b.slug);

    switch (sortBy.value) {
      case "last-played": {
        const dateA = infoA?.lastPlayed?.getTime() ?? 0;
        const dateB = infoB?.lastPlayed?.getTime() ?? 0;
        return dateB - dateA;
      }
      case "most-saves": {
        const savesA = infoA?.saveCount ?? 0;
        const savesB = infoB?.saveCount ?? 0;
        return savesB - savesA;
      }
      case "most-maps": {
        const mapsA = infoA?.mapsPlayed ?? 0;
        const mapsB = infoB?.mapsPlayed ?? 0;
        return mapsB - mapsA;
      }
      case "alpha":
        return a.title.localeCompare(b.title);
      default:
        return 0;
    }
  });

  return result;
});

// When search has no results in collection, count matches in Explore
const exploreMatchCount = computed(() => {
  // Only count if there's a search query and no results in collection
  if (!searchQuery.value || filteredWads.value.length > 0) return 0;

  const q = searchQuery.value.toLowerCase();
  return props.wads.filter(w => {
    // Exclude already playable WADs
    const info = props.getSaveInfo(w.slug);
    const hasSaves = info && info.saveCount > 0;
    if (props.isDownloaded(w.slug) || hasSaves) return false;

    // Search title, authors, and vibe
    const vibe = getVibe(w.slug) ?? "";
    return (
      w.title.toLowerCase().includes(q) ||
      w.authors.some(a => a.name.toLowerCase().includes(q)) ||
      vibe.toLowerCase().includes(q)
    );
  }).length;
});
</script>

<template>
  <div>
    <div v-if="loading" class="flex items-center justify-center py-20">
      <p class="text-zinc-400">Loading WADs...</p>
    </div>

    <div v-else-if="error" class="rounded bg-red-900/50 p-4 text-red-200">
      {{ error }}
    </div>

    <div v-else-if="playableWads.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <Gamepad2 :size="48" :stroke-width="1.5" class="text-zinc-600 mb-4" />
      <p class="text-zinc-500">No WADs downloaded yet</p>
      <p class="text-zinc-600 text-sm mt-2">Pick a WAD from Explore to download and play</p>
    </div>

    <template v-else>
      <FilterBar
        :sort-options="sortOptions"
        default-sort="last-played"
        :item-count="playableWads.length"
        :filtered-count="filteredWads.length"
        @update:search="searchQuery = $event"
        @update:sort="sortBy = $event"
        @update:filters="() => {}"
      />

      <div v-if="filteredWads.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
        <Gamepad2 :size="48" :stroke-width="1.5" class="text-zinc-600 mb-4" />
        <p class="text-zinc-500">No WADs match your search in your collection</p>
        <button
          v-if="exploreMatchCount > 0"
          class="mt-2 text-zinc-400 hover:text-zinc-200 transition-colors"
          @click="emit('navigate', 'explore', searchQuery)"
        >
          See {{ exploreMatchCount }} {{ exploreMatchCount === 1 ? 'match' : 'matches' }} in Explore →
        </button>
      </div>

      <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <WadList
          :wads="filteredWads"
          :is-downloaded="isDownloaded"
          :is-downloading="isDownloading"
          :get-download-progress="getDownloadProgress"
          :get-save-info="getSaveInfo"
          @play="(wad: WadEntry, args?: string[]) => emit('play', wad, args)"
          @delete="emit('delete', $event)"
        />
      </div>
    </template>
  </div>
</template>
