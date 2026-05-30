<script setup lang="ts">
import { computed } from "vue";
import { open } from "@tauri-apps/plugin-shell";
import type { WadEntry } from "../lib/schema";
import { getWadLinks } from "../lib/wadLinks";

const props = defineProps<{ wad: WadEntry }>();

const links = computed(() => getWadLinks(props.wad));
</script>

<template>
  <div v-if="links.length" class="flex flex-wrap gap-1.5">
    <button
      v-for="link in links"
      :key="link.label"
      class="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
      @click.stop="open(link.url)"
    >
      {{ link.label }}
    </button>
  </div>
</template>
