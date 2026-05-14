<script setup lang="ts">
import { computed, ref } from "vue";
import { Layers } from "lucide-vue-next";
import FilterBar from "./FilterBar.vue";
import type { WadEntry } from "../lib/schema";
import { useDownload } from "../composables/useDownload";
import { useSettings } from "../composables/useSettings";
import DownloadPlayButton from "./DownloadPlayButton.vue";
import AddCustomTile from "./AddCustomTile.vue";

const props = defineProps<{
  wads: WadEntry[];
  loading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  play: [wad: WadEntry, extraArgs?: string[]];
  delete: [wad: WadEntry];
  toggleActive: [slug: string];
  addCustom: [defaultType: WadEntry["type"]];
  edit: [wad: WadEntry];
}>();

const { isDownloaded: checkDownloaded } = useDownload();
const { settings } = useSettings();

function thumbnailFor(wad: WadEntry): string | null {
  if (wad.thumbnail) return wad.thumbnail;
  if (wad.screenshots.length > 0) return wad.screenshots[0].url;
  return null;
}

function authorsLine(wad: WadEntry): string {
  const authors = wad.authors.map(a => a.name).join(", ");
  return authors ? `${authors} · ${wad.year}` : `${wad.year}`;
}

function isActive(slug: string): boolean {
  return settings.value.activeMods.includes(slug);
}

// Filter/sort state — mirrors MainView (Play) so the two views feel identical.
const searchQuery = ref("");
const sortBy = ref("active");

const sortOptions = [
  { value: "active", label: "Active First" },
  { value: "alpha", label: "A-Z" },
  { value: "year-desc", label: "Newest" },
];

const filteredWads = computed(() => {
  let result = [...props.wads];

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(w =>
      w.title.toLowerCase().includes(q) ||
      w.authors.some(a => a.name.toLowerCase().includes(q))
    );
  }

  result.sort((a, b) => {
    switch (sortBy.value) {
      case "active": {
        const aActive = checkDownloaded(a.slug) && isActive(a.slug) ? 1 : 0;
        const bActive = checkDownloaded(b.slug) && isActive(b.slug) ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        return a.title.localeCompare(b.title);
      }
      case "alpha":
        return a.title.localeCompare(b.title);
      case "year-desc":
        return b.year - a.year;
      default:
        return 0;
    }
  });

  return result;
});
</script>

<template>
  <div>
    <div v-if="loading" class="flex items-center justify-center py-20">
      <p class="text-zinc-400">Loading…</p>
    </div>

    <div v-else-if="error" class="rounded bg-red-900/50 p-4 text-red-200">
      {{ error }}
    </div>

    <div v-else-if="wads.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <Layers :size="48" :stroke-width="1.5" class="text-zinc-600 mb-4" />
      <p class="text-zinc-500">No gameplay mods in the catalog yet</p>
      <p class="text-zinc-600 text-sm mt-2">Browse Explore for downloadable mods, or import one you already have:</p>
      <button
        class="mt-4 rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
        @click="emit('addCustom', 'gameplay-mod')"
      >+ Add custom mod</button>
    </div>

    <template v-else>
      <FilterBar
        :sort-options="sortOptions"
        default-sort="active"
        :item-count="wads.length"
        :filtered-count="filteredWads.length"
        @update:search="searchQuery = $event"
        @update:sort="sortBy = $event"
        @update:filters="() => {}"
      />

      <div v-if="filteredWads.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
        <Layers :size="48" :stroke-width="1.5" class="text-zinc-600 mb-4" />
        <p class="text-zinc-500">No mods match your search</p>
      </div>

      <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <div
          v-for="wad in filteredWads"
          :key="wad.slug"
          class="overflow-hidden rounded-lg bg-zinc-800 shadow-lg transition-all"
          :class="checkDownloaded(wad.slug) && isActive(wad.slug) ? 'ring-2 ring-red-600' : ''"
        >
          <!-- 16:9 thumbnail -->
          <div class="relative aspect-video overflow-hidden bg-zinc-900">
            <img
              v-if="thumbnailFor(wad)"
              :src="thumbnailFor(wad) ?? ''"
              :alt="wad.title"
              class="absolute inset-0 w-full h-full object-cover"
            />
            <div
              v-else
              class="absolute inset-0 flex items-center justify-center bg-red-900 px-4 text-center"
            >
              <span class="text-xl text-red-200 font-bold leading-tight line-clamp-3">{{ wad.title }}</span>
            </div>
          </div>

          <div class="p-3">
            <h3 class="truncate font-semibold text-zinc-100 flex items-center gap-2">
              <span class="truncate">{{ wad.title }}</span>
              <span
                v-if="wad._source === 'custom'"
                class="shrink-0 rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-300"
                title="Imported from your disk"
              >Custom</span>
            </h3>
            <p class="truncate text-sm text-zinc-400">{{ authorsLine(wad) }}</p>

            <div class="mt-3 flex gap-2">
              <template v-if="checkDownloaded(wad.slug)">
                <button
                  class="flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors"
                  :class="isActive(wad.slug)
                    ? 'bg-red-600 text-white hover:bg-red-500'
                    : 'bg-green-600 text-white hover:bg-green-500'"
                  @click="emit('toggleActive', wad.slug)"
                >
                  {{ isActive(wad.slug) ? '✓ Active' : '○ Off' }}
                </button>
                <button
                  v-if="wad._source === 'custom'"
                  class="rounded bg-zinc-700 px-2 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-zinc-100"
                  @click="emit('edit', wad)"
                  title="Edit custom mod"
                >
                  <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 20h9"/>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
                  </svg>
                </button>
                <button
                  class="rounded bg-zinc-700 px-2 py-1.5 text-zinc-400 transition-colors hover:bg-red-900 hover:text-red-400"
                  @click="emit('delete', wad)"
                  title="Delete mod"
                >
                  <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M6 6l12 12M6 18L18 6"/>
                  </svg>
                </button>
              </template>
              <DownloadPlayButton
                v-else
                class="flex-1"
                :wad="wad"
                play-label="Open in Mods"
                download-label="▼ Download"
                download-variant="secondary"
                @play="(w: WadEntry) => emit('play', w)"
              />
            </div>
          </div>
        </div>
        <AddCustomTile
          v-if="!searchQuery"
          label="Add custom mod"
          @click="emit('addCustom', 'gameplay-mod')"
        />
      </div>
    </template>
  </div>
</template>
