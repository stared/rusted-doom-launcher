<script setup lang="ts">
import { computed } from "vue";
import { Compass } from "lucide-vue-next";
import WadList from "./WadList.vue";
import type { WadEntry } from "../lib/schema";
import type { WadSaveInfo } from "../composables/useSaves";
import type { DownloadProgress } from "../composables/useDownload";

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

const notDownloadedWads = computed(() =>
  props.wads.filter(w => !props.isDownloaded(w.slug))
);
</script>

<template>
  <div>
    <div v-if="notDownloadedWads.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <Compass :size="48" :stroke-width="1.5" class="text-zinc-600 mb-4" />
      <p class="text-zinc-500">All WADs downloaded!</p>
      <p class="text-zinc-600 text-sm mt-2">Check Library to play your collection</p>
    </div>

    <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <WadList
        :wads="notDownloadedWads"
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
