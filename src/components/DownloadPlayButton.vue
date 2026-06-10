<script setup lang="ts">
import { computed } from "vue";
import type { WadEntry } from "../lib/schema";
import { useDownload } from "../composables/useDownload";
import { formatBytes } from "../lib/format";

const { isDownloaded: checkDownloaded, isDownloading: checkDownloading, isInstalling: checkInstalling, getDownloadProgress } = useDownload();

const props = defineProps<{
  wad: WadEntry;
  /** Label when downloaded. Defaults to "Play" */
  playLabel?: string;
  /** Label when not downloaded. Defaults to "Download & Play" */
  downloadLabel?: string;
  /** "primary" = red CTA (Play view); "secondary" = gray (Mods view, where downloading is optional). */
  downloadVariant?: "primary" | "secondary";
}>();

const emit = defineEmits<{ play: [wad: WadEntry] }>();

const isDownloaded = computed(() => props.wad.type === "iwad" || checkDownloaded(props.wad.slug));
const isInstalling = computed(() => checkInstalling(props.wad.slug));
const isDownloading = computed(() => checkDownloading(props.wad.slug) || isInstalling.value);
const downloadProgress = computed(() => getDownloadProgress(props.wad.slug));

const progressPercent = computed(() => {
  if (isInstalling.value) return 100;
  const dp = downloadProgress.value;
  if (!dp || dp.total === 0) return 0;
  return Math.round((dp.progress / dp.total) * 100);
});

const progressText = computed(() => {
  if (isInstalling.value) return "Installing...";
  const dp = downloadProgress.value;
  if (!dp) return "Downloading...";
  if (dp.total === 0) return `${formatBytes(dp.progress)}`;
  return `${formatBytes(dp.progress)} / ${formatBytes(dp.total)} (${progressPercent.value}%)`;
});
</script>

<template>
  <button
    class="w-full rounded px-3 py-1.5 text-sm font-medium text-white transition-colors relative overflow-hidden"
    :class="isDownloading ? 'bg-zinc-700 cursor-wait' : isDownloaded ? 'bg-green-600 hover:bg-green-500' : (downloadVariant === 'secondary' ? 'bg-zinc-600 hover:bg-zinc-500' : 'bg-red-600 hover:bg-red-500')"
    :disabled="isDownloading"
    @click="emit('play', wad)"
  >
    <!-- Progress bar background -->
    <div
      v-if="isDownloading && (downloadProgress || isInstalling)"
      class="absolute inset-0 bg-blue-600 transition-all duration-300"
      :style="{ width: `${progressPercent}%` }"
    />
    <span class="relative z-10">
      {{ isDownloading ? progressText : isDownloaded ? `\u25B6 ${playLabel ?? 'Play'}` : `${downloadLabel ?? 'Download & Play'}` }}
    </span>
  </button>
</template>
