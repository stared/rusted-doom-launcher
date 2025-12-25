<script setup lang="ts">
import { computed } from "vue";
import { Gamepad2 } from "lucide-vue-next";
import WadList from "./WadList.vue";
import type { WadEntry } from "../lib/schema";
import type { WadSaveInfo } from "../composables/useSaves";
import type { DownloadProgress } from "../composables/useDownload";

const props = defineProps<{
  wads: WadEntry[];
  loading: boolean;
  error: string | null;
  isDownloaded: (slug: string) => boolean;
  isDownloading: (slug: string) => boolean;
  getDownloadProgress: (slug: string) => DownloadProgress | undefined;
  getSaveInfo: (slug: string) => WadSaveInfo | null;
}>();

const emit = defineEmits<{
  play: [wad: WadEntry];
  delete: [wad: WadEntry];
}>();

// Only show WADs that have been played (have saves)
const playedWads = computed(() =>
  props.wads.filter(w => {
    const info = props.getSaveInfo(w.slug);
    return info && info.saveCount > 0;
  })
);
</script>

<template>
  <div>
    <div v-if="loading" class="flex items-center justify-center py-20">
      <p class="text-zinc-400">Loading WADs...</p>
    </div>

    <div v-else-if="error" class="rounded bg-red-900/50 p-4 text-red-200">
      {{ error }}
    </div>

    <div v-else-if="playedWads.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <Gamepad2 :size="48" :stroke-width="1.5" class="text-zinc-600 mb-4" />
      <p class="text-zinc-500">No WADs played yet</p>
      <p class="text-zinc-600 text-sm mt-2">Pick a WAD from Explore to start playing</p>
    </div>

    <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <WadList
        :wads="playedWads"
        :is-downloaded="isDownloaded"
        :is-downloading="isDownloading"
        :get-download-progress="getDownloadProgress"
        :get-save-info="getSaveInfo"
        @play="emit('play', $event)"
        @delete="emit('delete', $event)"
      />
    </div>
  </div>
</template>
