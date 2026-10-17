<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Compass } from "@lucide/vue";
import FilterBar from "./FilterBar.vue";
import ExploreCard from "./ExploreCard.vue";
import type { Iwad, WadEntry } from "../lib/schema";
import { useWadSummaries } from "../composables/useWadSummaries";
import { TYPE_LABELS, IWAD_LABELS } from "../lib/constants";

const { wads, initialQuery } = defineProps<{
  wads: WadEntry[];
  initialQuery?: string;
}>();

const emit = defineEmits<{
  play: [wad: WadEntry];
  delete: [wad: WadEntry];
}>();

const { getDifficulty, getVibe } = useWadSummaries();

// Filter/sort state
const searchQuery = ref(initialQuery ?? "");
const sortBy = ref("year-desc");
const activeFilters = ref<Record<string, string>>({});
// Rendering the whole catalog at once also starts every card's image work.
// Keep the first paint small and let the user request the next batch.
const PAGE_SIZE = 24;
const visibleCount = ref(PAGE_SIZE);

// Update search when navigating from Play with a query
watch(() => initialQuery, (newQuery) => {
  if (newQuery) searchQuery.value = newQuery;
}, { immediate: true });

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
  const iwads = [...new Set(wads.map(w => w.iwad))].sort();
  const types = [...new Set(wads.map(w => w.type))].sort();

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

function formatIwad(iwad: Iwad): string {
  return IWAD_LABELS[iwad];
}

function formatType(type: string): string {
  return TYPE_LABELS[type as keyof typeof TYPE_LABELS] ?? type;
}

// Filtered and sorted WADs
const filteredWads = computed(() => {
  let result = wads;

  // Search filter
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(w => {
      const searchableText = [
        w.title,
        w.slug,
        w.authors.map(a => a.name).join(" "),
        w.downloads.map(d => d.filename).join(" "),
        getVibe(w.slug) ?? "",
      ].join(" ").toLowerCase();
      return searchableText.includes(q);
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
  // WebKitGTK versions bundled by some Linux distributions do not yet expose
  // ES2023's Array.prototype.toSorted. Copy before sorting so props stay
  // immutable while keeping the Explore tab compatible with those runtimes.
  const sorted = [...result].sort((a, b) => {
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
  return sorted;
});

const visibleWads = computed(() => filteredWads.value.slice(0, visibleCount.value));
const hasMoreWads = computed(() => visibleCount.value < filteredWads.value.length);

function showMore() {
  visibleCount.value += PAGE_SIZE;
}

// A new search, filter, or sort should always begin at the top of its result.
watch([searchQuery, sortBy, activeFilters], () => {
  visibleCount.value = PAGE_SIZE;
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
      :initial-search="initialQuery"
      @update:search="searchQuery = $event"
      @update:sort="sortBy = $event"
      @update:filters="activeFilters = $event"
    />

    <div v-if="filteredWads.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <Compass :size="48" :stroke-width="1.5" class="text-zinc-600 mb-4" />
      <p class="text-zinc-500">No WADs match your filters</p>
      <p class="text-zinc-600 text-sm mt-2">Try adjusting your search or filters</p>
    </div>

    <div v-else class="wad-grid">
      <ExploreCard
        v-for="wad in visibleWads"
        :key="wad.slug"
        :wad="wad"
        @play="emit('play', $event)"
      />
    </div>

    <div v-if="hasMoreWads" class="flex justify-center pt-6">
      <button
        class="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
        @click="showMore"
      >
        Show more ({{ filteredWads.length - visibleWads.length }} remaining)
      </button>
    </div>
  </div>
</template>
