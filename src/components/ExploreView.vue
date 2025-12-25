<script setup lang="ts">
import { ref, computed } from "vue";
import { Compass } from "lucide-vue-next";
import FilterBar from "./FilterBar.vue";
import ExploreCard from "./ExploreCard.vue";
import type { WadEntry } from "../lib/schema";
import type { WadSaveInfo } from "../composables/useSaves";
import type { DownloadProgress } from "../composables/useDownload";
import { useWadSummaries } from "../composables/useWadSummaries";

const props = defineProps<{
  wads: WadEntry[];
  isDownloaded: (slug: string) => boolean;
  isDownloading: (slug: string) => boolean;
  getDownloadProgress: (slug: string) => DownloadProgress | undefined;
  getSaveInfo: (slug: string) => WadSaveInfo | null;
}>();

const emit = defineEmits<{
  play: [wad: WadEntry];
  delete: [wad: WadEntry];
}>();

const { getDifficulty, getVibe } = useWadSummaries();

// Filter/sort state
const searchQuery = ref("");
const sortBy = ref("year-desc");
const activeFilters = ref<Record<string, string>>({});

// Sort options - Year (newest) is default, Alpha is last
const sortOptions = [
  { value: "year-desc", label: "Newest" },
  { value: "year-asc", label: "Oldest" },
  { value: "diff-asc", label: "Easiest" },
  { value: "diff-desc", label: "Hardest" },
  { value: "alpha", label: "A-Z" },
];

// Filter definitions
const filterDefs = computed(() => {
  // Get unique IWADs from data
  const iwads = [...new Set(props.wads.map(w => w.iwad))].sort();
  const types = [...new Set(props.wads.map(w => w.type))].sort();

  return [
    {
      key: "iwad",
      label: "IWAD",
      options: iwads.map(i => ({ value: i, label: formatIwad(i) })),
    },
    {
      key: "type",
      label: "Type",
      options: types.map(t => ({ value: t, label: formatType(t) })),
    },
    {
      key: "difficulty",
      label: "Difficulty",
      options: [
        { value: "chill", label: "Chill (1-3)" },
        { value: "spicy", label: "Spicy (3.5-5)" },
        { value: "brutal", label: "Brutal (5-7)" },
        { value: "nightmare", label: "Nightmare (7+)" },
      ],
    },
  ];
});

function formatIwad(iwad: string): string {
  const names: Record<string, string> = {
    doom: "Doom",
    doom2: "Doom II",
    plutonia: "Plutonia",
    tnt: "TNT",
    heretic: "Heretic",
    hexen: "Hexen",
    freedoom1: "Freedoom 1",
    freedoom2: "Freedoom 2",
  };
  return names[iwad] ?? iwad;
}

function formatType(type: string): string {
  const names: Record<string, string> = {
    "single-level": "Single Level",
    episode: "Episode",
    megawad: "Megawad",
    "gameplay-mod": "Mod",
    "total-conversion": "TC",
    "resource-pack": "Resource",
  };
  return names[type] ?? type;
}

// Filtered and sorted WADs
const filteredWads = computed(() => {
  let result = [...props.wads];

  // Search filter - searches title, authors, and vibe
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(w => {
      const vibe = getVibe(w.slug) ?? "";
      return (
        w.title.toLowerCase().includes(q) ||
        w.authors.some(a => a.name.toLowerCase().includes(q)) ||
        vibe.toLowerCase().includes(q)
      );
    });
  }

  // IWAD filter
  if (activeFilters.value.iwad) {
    result = result.filter(w => w.iwad === activeFilters.value.iwad);
  }

  // Type filter
  if (activeFilters.value.type) {
    result = result.filter(w => w.type === activeFilters.value.type);
  }

  // Difficulty filter
  if (activeFilters.value.difficulty) {
    result = result.filter(w => {
      const d = getDifficulty(w.slug);
      if (d === null) return false;
      switch (activeFilters.value.difficulty) {
        case "chill": return d <= 3;
        case "spicy": return d > 3 && d <= 5;
        case "brutal": return d > 5 && d <= 7;
        case "nightmare": return d > 7;
        default: return true;
      }
    });
  }

  // Sort
  result.sort((a, b) => {
    switch (sortBy.value) {
      case "year-desc":
        return b.year - a.year;
      case "year-asc":
        return a.year - b.year;
      case "diff-asc": {
        const da = getDifficulty(a.slug) ?? 5;
        const db = getDifficulty(b.slug) ?? 5;
        return da - db;
      }
      case "diff-desc": {
        const da = getDifficulty(a.slug) ?? 5;
        const db = getDifficulty(b.slug) ?? 5;
        return db - da;
      }
      case "alpha":
        return a.title.localeCompare(b.title);
      default:
        return 0;
    }
  });

  return result;
});
</script>

<template>
  <div>
    <FilterBar
      :sort-options="sortOptions"
      default-sort="year-desc"
      :filters="filterDefs"
      :item-count="wads.length"
      :filtered-count="filteredWads.length"
      @update:search="searchQuery = $event"
      @update:sort="sortBy = $event"
      @update:filters="activeFilters = $event"
    />

    <div v-if="filteredWads.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <Compass :size="48" :stroke-width="1.5" class="text-zinc-600 mb-4" />
      <p class="text-zinc-500">No WADs match your filters</p>
      <p class="text-zinc-600 text-sm mt-2">Try adjusting your search or filters</p>
    </div>

    <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <ExploreCard
        v-for="wad in filteredWads"
        :key="wad.slug"
        :wad="wad"
        :is-downloaded="isDownloaded(wad.slug)"
        :is-downloading="isDownloading(wad.slug)"
        :download-progress="getDownloadProgress(wad.slug)"
        @play="emit('play', $event)"
      />
    </div>
  </div>
</template>
