<script setup lang="ts">
import type { WadEntry } from "../lib/schema";
import type { WadSaveInfo } from "../composables/useSaves";
import WadCard from "./WadCard.vue";

defineProps<{
  wads: WadEntry[];
  isDownloaded: (slug: string) => boolean;
  isDownloading: (slug: string) => boolean;
  getSaveInfo: (slug: string) => WadSaveInfo | null;
}>();

defineEmits<{
  play: [wad: WadEntry];
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
    :save-info="getSaveInfo(wad.slug)"
    @play="$emit('play', wad)"
    @delete="$emit('delete', wad)"
  />
</template>
