<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { Gamepad2 } from "@lucide/vue";
import type { WadEntry } from "../lib/schema";
import { useWadSummaries } from "../composables/useWadSummaries";
import { useRemoteImage } from "../composables/useRemoteImage";
import DownloadPlayButton from "./DownloadPlayButton.vue";
import WadLinks from "./WadLinks.vue";
import WadRating from "./WadRating.vue";
import { useWadRatings } from "../composables/useWadRatings";

// Slideshow interval in milliseconds
const SLIDESHOW_INTERVAL_MS = 2000;

const { getDifficulty, getVibe } = useWadSummaries();
const { getRating, setRating } = useWadRatings();

const props = defineProps<{
  wad: WadEntry;
}>();

const emit = defineEmits<{ play: [wad: WadEntry] }>();

// Get difficulty from summaries
const difficulty = computed(() => getDifficulty(props.wad.slug));
const vibe = computed(() => getVibe(props.wad.slug));
const rating = computed(() => getRating(props.wad.slug, props.wad.rating));

async function updateRating(value: number) {
  try {
    await setRating(props.wad.slug, value);
  } catch (error) {
    console.error("[ExploreCard] Failed to save rating:", error);
  }
}

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

// Fetching every remote image in the catalog at once overwhelms WebKit. Start
// only when the card is close to the viewport; cards stay loaded after that so
// hovering can still cycle their screenshots without another fetch.
const imageArea = ref<HTMLElement | null>(null);
const shouldLoadImages = ref(false);
let imageObserver: IntersectionObserver | null = null;
const imageToLoad = computed(() => shouldLoadImages.value ? currentImage.value : null);

onMounted(() => {
  if (!imageArea.value || typeof IntersectionObserver === "undefined") {
    shouldLoadImages.value = true;
    return;
  }

  imageObserver = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      shouldLoadImages.value = true;
      imageObserver?.disconnect();
      imageObserver = null;
    }
  }, { rootMargin: "0px" });
  imageObserver.observe(imageArea.value);
});

const { resolvedUrl: resolvedCurrentImage, markError: markImageError, isError: isImageError } = useRemoteImage(imageToLoad);

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
  imageObserver?.disconnect();
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
  <div class="flex flex-col overflow-hidden rounded-lg bg-zinc-900 shadow-lg">
    <!-- Image area with overlay -->
    <div
      ref="imageArea"
      class="relative aspect-video overflow-hidden"
      @mouseenter="startSlideshow"
      @mouseleave="stopSlideshow"
    >
      <!-- Screenshot/thumbnail with slideshow -->
      <img
        v-if="resolvedCurrentImage && !isImageError"
        :src="resolvedCurrentImage"
        :alt="wad.title"
        loading="lazy"
        class="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
        @error="markImageError"
      />

      <!-- Fallback for no image or on load error -->
      <div
        v-else
        class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-red-950 via-zinc-900 to-zinc-950 px-4 text-center"
      >
        <div class="flex h-12 w-12 items-center justify-center rounded-full border border-red-900/40 bg-red-950/30 text-red-500/40">
          <Gamepad2 :size="24" />
        </div>
      </div>

      <!-- Gradient overlay for text readability -->
      <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

      <!-- Difficulty badge (top right) -->
      <div
        v-if="difficultyConfig"
        class="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded bg-black/80"
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
        <h3 class="text-lg font-bold text-white leading-tight line-clamp-2">
          {{ wad.title }}
        </h3>
        <p class="text-xs text-zinc-300 mt-0.5 truncate">
          {{ authorDisplay }} · {{ wad.year }}
        </p>
      </div>
    </div>

    <!-- Content area -->
    <div class="flex flex-1 flex-col p-3">
      <WadRating class="mb-2" :rating="rating" @change="updateRating" />
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
