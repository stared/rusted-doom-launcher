<script setup lang="ts">
import { ref, computed, onUnmounted } from "vue";
import type { WadEntry } from "../lib/schema";
import { useWadSummaries } from "../composables/useWadSummaries";
import DownloadPlayButton from "./DownloadPlayButton.vue";
import WadLinks from "./WadLinks.vue";

// Slideshow interval in milliseconds
const SLIDESHOW_INTERVAL_MS = 2000;

const { getDifficulty, getVibe } = useWadSummaries();

const props = defineProps<{
  wad: WadEntry;
}>();

const emit = defineEmits<{ play: [wad: WadEntry] }>();

// Get difficulty from summaries
const difficulty = computed(() => getDifficulty(props.wad.slug));
const vibe = computed(() => getVibe(props.wad.slug));

// Difficulty color and label based on 1-10 scale
const difficultyConfig = computed(() => {
  const d = difficulty.value;
  if (d === null) return null;

  if (d <= 2) return { color: "bg-green-500", textColor: "text-green-400", label: "Chill" };
  if (d <= 3.5) return { color: "bg-lime-500", textColor: "text-lime-400", label: "Classic" };
  if (d <= 5) return { color: "bg-yellow-500", textColor: "text-yellow-400", label: "Spicy" };
  if (d <= 6.5) return { color: "bg-orange-500", textColor: "text-orange-400", label: "Brutal" };
  if (d <= 8) return { color: "bg-red-500", textColor: "text-red-400", label: "Slaughter" };
  return { color: "bg-red-700", textColor: "text-red-300", label: "Nightmare" };
});

// All available images: thumbnail first, then screenshots
const allImages = computed(() => {
  const images: string[] = [];
  if (props.wad.thumbnail) images.push(props.wad.thumbnail);
  for (const s of props.wad.screenshots) {
    images.push(s.url);
  }
  return images;
});

// Slideshow state
const currentImageIndex = ref(0);
let slideshowInterval: ReturnType<typeof setInterval> | null = null;

const currentImage = computed(() => {
  if (allImages.value.length === 0) return null;
  return allImages.value[currentImageIndex.value];
});

function startSlideshow() {
  if (allImages.value.length <= 1) return;
  slideshowInterval = setInterval(() => {
    currentImageIndex.value = (currentImageIndex.value + 1) % allImages.value.length;
  }, SLIDESHOW_INTERVAL_MS);
}

function stopSlideshow() {
  if (slideshowInterval) {
    clearInterval(slideshowInterval);
    slideshowInterval = null;
  }
  currentImageIndex.value = 0;
}

onUnmounted(() => {
  stopSlideshow();
});

// Author display (truncated if too long)
const authorDisplay = computed(() => {
  const names = props.wad.authors.map(a => a.name);
  if (names.length === 1) return names[0];
  if (names.length === 2) return names.join(" & ");
  return `${names[0]} +${names.length - 1}`;
});
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden rounded-lg bg-zinc-900 shadow-lg">
    <!-- Image area with overlay -->
    <div
      class="relative aspect-video overflow-hidden"
      @mouseenter="startSlideshow"
      @mouseleave="stopSlideshow"
    >
      <!-- Screenshot/thumbnail with slideshow -->
      <img
        v-if="currentImage"
        :src="currentImage"
        :alt="wad.title"
        class="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
      />

      <!-- Fallback for no image -->
      <div
        v-else
        class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-red-900 to-zinc-900 px-4 text-center"
      >
        <span class="text-2xl text-red-200 font-bold leading-tight line-clamp-3 opacity-80">{{ wad.title }}</span>
      </div>

      <!-- Gradient overlay for text readability -->
      <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

      <!-- Difficulty badge (top right) -->
      <div
        v-if="difficultyConfig"
        class="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded bg-black/70 backdrop-blur-sm"
      >
        <span :class="['text-xs font-bold uppercase tracking-wide', difficultyConfig.textColor]">
          {{ difficultyConfig.label }}
        </span>
        <span class="text-[10px] text-zinc-400">
          {{ difficulty?.toFixed(1) }}
        </span>
      </div>

      <!-- Title overlay (bottom) -->
      <div class="absolute bottom-0 left-0 right-0 p-3">
        <h3 class="text-lg font-bold text-white drop-shadow-lg leading-tight">
          {{ wad.title }}
        </h3>
        <p class="text-xs text-zinc-300 mt-0.5">
          {{ authorDisplay }} · {{ wad.year }}
        </p>
      </div>
    </div>

    <!-- Content area -->
    <div class="flex flex-1 flex-col p-3">
      <!-- Vibe text - the hook -->
      <p
        v-if="vibe"
        class="text-sm text-zinc-400 italic leading-relaxed line-clamp-3"
      >
        "{{ vibe }}"
      </p>
      <p
        v-else
        class="text-sm text-zinc-500 italic line-clamp-3"
      >
        {{ wad.description.slice(0, 120) }}{{ wad.description.length > 120 ? '...' : '' }}
      </p>

      <!-- Bottom-anchored: reference links + play button (aligned across cards) -->
      <div class="mt-auto space-y-3 pt-3">
        <WadLinks :wad="wad" />
        <DownloadPlayButton :wad="wad" @play="emit('play', wad)" />
      </div>
    </div>
  </div>
</template>
