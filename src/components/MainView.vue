<script setup lang="ts">
import WadList from "./WadList.vue";
import type { WadEntry } from "../lib/schema";
import type { WadSaveInfo } from "../composables/useSaves";
import type { DownloadProgress } from "../composables/useDownload";

defineProps<{
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
</script>

<template>
  <div>
    <div v-if="loading" class="flex items-center justify-center py-20">
      <p class="text-zinc-400">Loading WADs...</p>
    </div>

    <div v-else-if="error" class="rounded bg-red-900/50 p-4 text-red-200">
      {{ error }}
    </div>

    <div v-else-if="wads.length === 0" class="flex items-center justify-center py-20">
      <p class="text-zinc-400">No WADs found.</p>
    </div>

    <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <WadList
        :wads="wads"
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
