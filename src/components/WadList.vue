<script setup lang="ts">
import type { WadEntry } from "../lib/schema";
import type { WadSaveInfo } from "../composables/useSaves";
import type { DownloadProgress } from "../composables/useDownload";
import WadCard from "./WadCard.vue";

defineProps<{
  wads: WadEntry[];
  isDownloaded: (slug: string) => boolean;
  isDownloading: (slug: string) => boolean;
  getDownloadProgress: (slug: string) => DownloadProgress | undefined;
  getSaveInfo: (slug: string) => WadSaveInfo | null;
}>();

defineEmits<{
  play: [wad: WadEntry, extraArgs?: string[]];
  delete: [wad: WadEntry];
}>();
</script>

<template>
  <WadCard
    v-for="wad in wads"
    :key="wad.slug"
    :wad="wad"
    :is-downloaded="isDownloaded(wad.slug)"
    :is-downloading="isDownloading(wad.slug)"
    :download-progress="getDownloadProgress(wad.slug)"
    :save-info="getSaveInfo(wad.slug)"
    @play="(w: WadEntry, args?: string[]) => $emit('play', w, args)"
    @delete="$emit('delete', wad)"
  />
</template>
