<script setup lang="ts">
import { computed } from "vue";
import { open } from "@tauri-apps/plugin-shell";
import type { WadEntry } from "../lib/schema";
import { getWadLinks } from "../lib/wadLinks";

const props = withDefaults(defineProps<{
  wad: WadEntry;
  includeDownloadSource?: boolean;
}>(), {
  includeDownloadSource: true,
});

const links = computed(() => getWadLinks(props.wad, {
  includeDownloadSource: props.includeDownloadSource,
}));

async function openLink(url: string) {
  try {
    await open(url);
  } catch (error) {
    console.error("[WadLinks] Failed to open external link:", url, error);
  }
}
</script>

<template>
  <div v-if="links.length" class="flex flex-nowrap gap-1">
    <button
      v-for="link in links"
      :key="link.label"
      class="whitespace-nowrap rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
      @click.stop="openLink(link.url)"
    >
      {{ link.label }}
    </button>
  </div>
</template>
