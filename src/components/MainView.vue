<!--suppress SpellCheckingInspection -->
<script setup lang="ts">
import { ref, computed } from "vue";
import { Gamepad2, Tag, X, Sparkles, Plus } from "@lucide/vue";
import FilterBar from "./FilterBar.vue";
import WadCard from "./WadCard.vue";
import AddCustomTile from "./AddCustomTile.vue";
import type { WadEntry } from "../lib/schema";
import { useDownload } from "../composables/useDownload";
import { useStats } from "../composables/useStats";
import { useWadSummaries } from "../composables/useWadSummaries";
import { useTags } from "../composables/useTags";

const { wads } = defineProps<{
  wads: WadEntry[];
}>();

const emit = defineEmits<{
  play: [wad: WadEntry, extraArgs?: string[]];
  delete: [wad: WadEntry];
  navigate: [view: "explore", query?: string];
  addCustom: [defaultType: WadEntry["type"]];
  edit: [wad: WadEntry];
  importDoomLauncher: [];
}>();

const { isDownloaded } = useDownload();
const { getCachedPlaySummary } = useStats();
const { getVibe } = useWadSummaries();

// Filter/sort state
const searchQuery = ref("");
const sortBy = ref("last-played");
const activeTab = ref<string>("all");
const activeTag = ref<string | null>(null);

// Sort options - Last Played is default (most relevant for "resume" context)
const sortOptions = [
  { value: "last-played", label: "Recently Played" },
  { value: "most-saves", label: "Most Saves" },
  { value: "most-maps", label: "Most Maps" },
  { value: "alpha", label: "A-Z" },
];

// WADs that are downloaded OR have saves (ready to play). IWADs are always
// playable when the IWAD file is on disk (the parent only synthesises an
// entry once detection succeeds).
const playableWads = computed(() =>
  wads.filter(w => {
    if (w.type === "iwad") return true;
    const info = getCachedPlaySummary(w.slug);
    const hasSaves = info && info.sessionCount > 0;
    return isDownloaded(w.slug) || hasSaves || w._source === "custom";
  })
);

// Tags calculation for playable WADs
const { allTags } = useTags(playableWads);

// System category tabs
const categoryTabs = computed(() => {
  const allCount = playableWads.value.length;
  const favCount = playableWads.value.filter(w =>
    w.tags?.some(t => t.toLowerCase() === "favorite" || t.toLowerCase() === "favorites" || t.toLowerCase() === "favourite")
  ).length;
  const megawadCount = playableWads.value.filter(w => w.type === "megawad").length;
  const episodeCount = playableWads.value.filter(w => w.type === "episode").length;
  const iwadCount = playableWads.value.filter(w => w.type === "iwad").length;
  const customCount = playableWads.value.filter(w => w._source === "custom").length;

  return [
    { id: "all", label: "All", count: allCount },
    ...(favCount > 0 ? [{ id: "favorites", label: "Favorites", count: favCount }] : []),
    ...(megawadCount > 0 ? [{ id: "megawads", label: "Megawads", count: megawadCount }] : []),
    ...(episodeCount > 0 ? [{ id: "episodes", label: "Episodes", count: episodeCount }] : []),
    ...(iwadCount > 0 ? [{ id: "iwads", label: "Base Games", count: iwadCount }] : []),
    ...(customCount > 0 ? [{ id: "custom", label: "Custom Mods", count: customCount }] : []),
  ];
});

function toggleTag(tagName: string) {
  if (activeTag.value === tagName) {
    activeTag.value = null;
  } else {
    activeTag.value = tagName;
  }
}

function clearAllFilters() {
  activeTab.value = "all";
  activeTag.value = null;
  searchQuery.value = "";
}

// Filtered and sorted WADs
const filteredWads = computed(() => {
  let result = playableWads.value;

  // 1. Tab category filter
  if (activeTab.value === "favorites") {
    result = result.filter(w =>
      w.tags?.some(t => t.toLowerCase() === "favorite" || t.toLowerCase() === "favorites" || t.toLowerCase() === "favourite")
    );
  } else if (activeTab.value === "megawads") {
    result = result.filter(w => w.type === "megawad");
  } else if (activeTab.value === "episodes") {
    result = result.filter(w => w.type === "episode");
  } else if (activeTab.value === "iwads") {
    result = result.filter(w => w.type === "iwad");
  } else if (activeTab.value === "custom") {
    result = result.filter(w => w._source === "custom");
  }

  // 2. Tag filter
  if (activeTag.value === "untagged") {
    result = result.filter(w => !w.tags || w.tags.length === 0);
  } else if (activeTag.value) {
    const target = activeTag.value.toLowerCase();
    result = result.filter(w => w.tags && w.tags.some(t => t.toLowerCase() === target));
  }

  // 3. Search filter
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(w =>
      w.title.toLowerCase().includes(q) ||
      w.authors.some(a => a.name.toLowerCase().includes(q)) ||
      w.tags?.some(t => t.toLowerCase().includes(q))
    );
  }

  // 4. Sort
  return [...result].sort((a, b) => {
    const infoA = getCachedPlaySummary(a.slug);
    const infoB = getCachedPlaySummary(b.slug);

    switch (sortBy.value) {
      case "last-played": {
        const dateA = infoA?.lastPlayed?.getTime() ?? 0;
        const dateB = infoB?.lastPlayed?.getTime() ?? 0;
        return dateB - dateA;
      }
      case "most-saves": {
        const savesA = infoA?.sessionCount ?? 0;
        const savesB = infoB?.sessionCount ?? 0;
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
});

// When search has no results in collection, count matches in Explore
const exploreMatchCount = computed(() => {
  if (!searchQuery.value || filteredWads.value.length > 0) return 0;

  const q = searchQuery.value.toLowerCase();
  return wads.filter(w => {
    const info = getCachedPlaySummary(w.slug);
    const hasSaves = info && info.sessionCount > 0;
    if (isDownloaded(w.slug) || hasSaves) return false;

    const vibe = getVibe(w.slug) ?? "";
    return (
      w.title.toLowerCase().includes(q) ||
      w.authors.some(a => a.name.toLowerCase().includes(q)) ||
      vibe.toLowerCase().includes(q) ||
      w.tags?.some(t => t.toLowerCase().includes(q))
    );
  }).length;
});
</script>

<template>
  <div class="space-y-4">
    <div v-if="playableWads.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <Gamepad2 :size="48" :stroke-width="1.5" class="text-zinc-600 mb-4" />
      <p class="text-zinc-500">No WADs downloaded yet</p>
      <p class="text-zinc-600 text-sm mt-2">Pick a WAD from Explore, or import one you already have:</p>
      <div class="flex items-center gap-3 mt-4">
        <button
          class="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 transition-colors"
          @click="emit('addCustom', 'megawad')"
        >+ Add custom WAD</button>
        <button
          class="rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
          @click="emit('importDoomLauncher')"
        >Import from DoomLauncher</button>
      </div>
    </div>

    <template v-else>
      <!-- Top Tab Bar & Filter Bar Header -->
      <div class="space-y-3">
        <!-- Category Tabs -->
        <div class="flex items-center justify-between border-b border-zinc-800/80 pb-2 overflow-x-auto">
          <div class="flex items-center gap-1.5 shrink-0">
            <button
              v-for="tab in categoryTabs"
              :key="tab.id"
              class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5"
              :class="activeTab === tab.id
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'"
              @click="activeTab = tab.id"
            >
              <span>{{ tab.label }}</span>
              <span
                class="px-1.5 py-0.2 rounded-full text-[10px]"
                :class="activeTab === tab.id ? 'bg-black/25 text-white' : 'bg-zinc-800 text-zinc-400'"
              >
                {{ tab.count }}
              </span>
            </button>
          </div>

          <div class="flex items-center gap-2 shrink-0 ml-2">
            <button
              class="text-xs text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-700/80 px-2.5 py-1 rounded-md border border-zinc-700/60 shrink-0 flex items-center gap-1.5 transition-colors"
              @click="emit('addCustom', 'megawad')"
            >
              <Plus :size="13" class="text-zinc-300" />
              <span>Add custom WAD</span>
            </button>
            <button
              class="text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 px-2.5 py-1 rounded-md border border-zinc-800 shrink-0 flex items-center gap-1.5 transition-colors"
              @click="emit('importDoomLauncher')"
            >
              <Sparkles :size="13" class="text-amber-400" />
              <span>Import DoomLauncher</span>
            </button>
          </div>
        </div>

        <!-- Tag Pills Strip (when tags exist) -->
        <div v-if="allTags.length > 0" class="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none">
          <span class="text-xs text-zinc-500 font-medium flex items-center gap-1 shrink-0 mr-1">
            <Tag :size="12" />
            Tags:
          </span>
          <button
            v-for="tag in allTags"
            :key="tag.name"
            class="px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 transition-all flex items-center gap-1.5"
            :class="activeTag === tag.name
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
              : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-zinc-700/50'"
            @click="toggleTag(tag.name)"
          >
            <span>{{ tag.name }}</span>
            <span class="text-[10px] opacity-75">({{ tag.count }})</span>
            <X v-if="activeTag === tag.name" :size="12" class="hover:text-white" />
          </button>
        </div>

        <!-- Active Filter Summary Chip (if filtered by tag or search) -->
        <div v-if="activeTag || activeTab !== 'all' || searchQuery" class="flex items-center gap-2 pt-1">
          <span class="text-xs text-zinc-500">Active filters:</span>
          <span v-if="activeTab !== 'all'" class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-red-950/60 text-red-300 border border-red-800/60">
            Tab: {{ categoryTabs.find(t => t.id === activeTab)?.label }}
            <button class="hover:text-white" @click="activeTab = 'all'"><X :size="10" /></button>
          </span>
          <span v-if="activeTag" class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-amber-950/60 text-amber-300 border border-amber-800/60">
            Tag: {{ activeTag }}
            <button class="hover:text-white" @click="activeTag = null"><X :size="10" /></button>
          </span>
          <button
            class="text-[11px] text-zinc-400 hover:text-zinc-200 underline ml-1"
            @click="clearAllFilters"
          >
            Clear all
          </button>
        </div>

        <!-- FilterBar with Sort & Search -->
        <FilterBar
          :sort-options="sortOptions"
          default-sort="last-played"
          :item-count="playableWads.length"
          :filtered-count="filteredWads.length"
          @update:search="searchQuery = $event"
          @update:sort="sortBy = $event"
          @update:filters="() => {}"
        />
      </div>

      <!-- Empty match state -->
      <div v-if="filteredWads.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
        <Gamepad2 :size="48" :stroke-width="1.5" class="text-zinc-600 mb-4" />
        <p class="text-zinc-400 font-medium">No WADs match the active filter</p>
        <div class="flex items-center gap-3 mt-3">
          <button
            class="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors"
            @click="clearAllFilters"
          >
            Reset Filters
          </button>
          <button
            v-if="exploreMatchCount > 0"
            class="text-xs text-red-400 hover:text-red-300 transition-colors"
            @click="emit('navigate', 'explore', searchQuery)"
          >
            See {{ exploreMatchCount }} {{ exploreMatchCount === 1 ? 'match' : 'matches' }} in Explore →
          </button>
        </div>
      </div>

      <!-- WAD Grid -->
      <div v-else class="wad-grid">
        <WadCard
          v-for="wad in filteredWads"
          :key="wad.slug"
          :wad="wad"
          @play="(w: WadEntry, args?: string[]) => emit('play', w, args)"
          @delete="emit('delete', $event)"
          @edit="emit('edit', $event)"
          @tag-click="toggleTag($event)"
        />
        <AddCustomTile
          v-if="!searchQuery && activeTab === 'all' && !activeTag"
          label="Add custom WAD"
          @click="emit('addCustom', 'megawad')"
        />
      </div>
    </template>
  </div>
</template>
