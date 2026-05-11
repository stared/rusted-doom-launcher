<script setup lang="ts">
import { Layers } from "lucide-vue-next";
import type { WadEntry } from "../lib/schema";
import { useDownload } from "../composables/useDownload";
import { useSettings } from "../composables/useSettings";
import DownloadPlayButton from "./DownloadPlayButton.vue";

defineProps<{
  wads: WadEntry[];
  loading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  play: [wad: WadEntry, extraArgs?: string[]];
  delete: [wad: WadEntry];
  toggleActive: [slug: string];
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
      <p class="text-zinc-600 text-sm mt-2">Browse Explore for downloadable mods. Enabled mods layer into every Play launch.</p>
    </div>

    <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <div
        v-for="wad in wads"
        :key="wad.slug"
        class="overflow-hidden rounded-lg bg-zinc-800 shadow-lg transition-all"
        :class="checkDownloaded(wad.slug) && isActive(wad.slug) ? 'ring-2 ring-rose-600' : ''"
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
            class="absolute inset-0 flex items-center justify-center bg-red-900"
          >
            <span class="text-2xl text-red-300 font-bold">DOOM</span>
          </div>
        </div>

        <div class="p-3">
          <h3 class="truncate font-semibold text-zinc-100">{{ wad.title }}</h3>
          <p class="truncate text-sm text-zinc-400">{{ authorsLine(wad) }}</p>

          <div class="mt-3 flex gap-2">
            <template v-if="checkDownloaded(wad.slug)">
              <button
                class="flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors"
                :class="isActive(wad.slug)
                  ? 'bg-rose-600 text-white hover:bg-rose-500'
                  : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'"
                @click="emit('toggleActive', wad.slug)"
              >
                {{ isActive(wad.slug) ? '✓ Active' : '○ Off' }}
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
              @play="(w: WadEntry) => emit('play', w)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
