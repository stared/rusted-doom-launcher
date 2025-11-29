<script setup lang="ts">
import { ref, computed, onUnmounted } from "vue";
import type { WadEntry } from "../lib/schema";

const TYPE_LABELS: Record<WadEntry["type"], string> = {
  "single-level": "Level", episode: "Episode", megawad: "Megawad",
  "gameplay-mod": "Mod", "total-conversion": "TC", "resource-pack": "Resources",
};

const props = defineProps<{
  wad: WadEntry;
  isDownloaded: boolean;
  isDownloading: boolean;
}>();

const emit = defineEmits<{ play: [wad: WadEntry]; delete: [wad: WadEntry] }>();

const playerContainerRef = ref<HTMLDivElement | null>(null);
const hasVideo = computed(() => props.wad.youtubeVideos.length > 0);
const videoId = computed(() => props.wad.youtubeVideos[0]?.id);

// Lazy loading state
const playerLoaded = ref(false);
const isPlaying = ref(false);

// YouTube thumbnail URL (high quality)
const thumbnailUrl = computed(() => {
  if (hasVideo.value) {
    return `https://img.youtube.com/vi/${videoId.value}/hqdefault.jpg`;
  }
  return props.wad.thumbnail || `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect fill='%23991b1b' width='320' height='180'/%3E%3Ctext x='160' y='95' text-anchor='middle' fill='%23fca5a5' font-size='24' font-family='sans-serif'%3EDOOM%3C/text%3E%3C/svg%3E`;
});

let player: YT.Player | null = null;
let playerReady = false;

// Load YouTube API once globally
const ytWindow = window as Window & { onYouTubeIframeAPIReady?: () => void };

function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    const existingCallback = ytWindow.onYouTubeIframeAPIReady;
    ytWindow.onYouTubeIframeAPIReady = () => {
      existingCallback?.();
      resolve();
    };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
}

function initPlayer() {
  if (!hasVideo.value || !playerContainerRef.value || player) return;

  const playerId = `yt-${props.wad.slug}`;
  playerContainerRef.value.id = playerId;

  player = new window.YT.Player(playerId, {
    videoId: videoId.value,
    playerVars: {
      controls: 0,
      modestbranding: 1,
      rel: 0,
      showinfo: 0,
      iv_load_policy: 3,
      mute: 1,
      playsinline: 1,
    },
    events: {
      onReady: () => {
        playerReady = true;
        // Auto-play immediately after loading (click was the gesture that triggered load)
        player?.playVideo();
      },
      onStateChange: (e: YT.OnStateChangeEvent) => {
        // Track playing state: 1 = playing
        isPlaying.value = e.data === 1;
      },
      onError: (e: YT.OnErrorEvent) => {
        console.error("[YT] Player error for:", props.wad.slug, "code:", e.data);
      },
    },
  });
}

onUnmounted(() => {
  player?.destroy();
  player = null;
});

async function handleVideoClick(e: MouseEvent) {
  if (!hasVideo.value) {
    // No video - emit play to launch the WAD
    emit('play', props.wad);
    return;
  }

  e.stopPropagation();

  // First click: load the player
  if (!playerLoaded.value) {
    playerLoaded.value = true;
    await loadYouTubeAPI();
    // Need to wait for next tick for the ref to be available
    await new Promise(resolve => setTimeout(resolve, 0));
    initPlayer();
    return;
  }

  // Subsequent clicks: toggle play/pause
  if (playerReady && player) {
    if (isPlaying.value) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  }
}

// Mouse leave no longer pauses - only click toggles play/pause
</script>

<template>
  <div class="overflow-hidden rounded-lg bg-zinc-800 shadow-lg">
    <!-- 16:9 aspect ratio thumbnail -->
    <div
      class="relative aspect-video cursor-pointer overflow-hidden"
      @click="handleVideoClick"
    >
      <!-- Static thumbnail (shown before player loads) -->
      <img
        v-if="!playerLoaded"
        :src="thumbnailUrl"
        :alt="wad.title"
        class="h-full w-full object-cover"
      />

      <!-- YouTube player container (created on click) -->
      <div
        v-if="playerLoaded && hasVideo"
        ref="playerContainerRef"
        class="absolute inset-0 w-full h-full"
      />

      <!-- Play button overlay - shown when not playing -->
      <div
        v-if="hasVideo && !isPlaying"
        class="absolute inset-0 flex items-center justify-center bg-black/20 z-20 pointer-events-none"
      >
        <div class="w-16 h-16 rounded-full bg-red-600/90 flex items-center justify-center shadow-lg">
          <svg class="w-8 h-8 text-white ml-1" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
      </div>

      <!-- Type badge -->
      <span class="absolute bottom-2 left-2 rounded bg-zinc-900/80 px-2 py-0.5 text-xs text-zinc-300 pointer-events-none z-10">
        {{ TYPE_LABELS[wad.type] }}
      </span>
      <!-- Award badge -->
      <span v-if="wad.awards.length" class="absolute top-2 right-2 text-lg pointer-events-none z-10">🏆</span>
    </div>

    <div class="p-3">
      <h3 class="truncate font-semibold text-zinc-100">{{ wad.title }}</h3>
      <p class="truncate text-sm text-zinc-400">{{ wad.authors.map(a => a.name).join(", ") }} • {{ wad.year }}</p>

      <div class="mt-3 flex gap-2">
        <button
          class="flex-1 rounded px-3 py-1.5 text-sm font-medium text-white transition-colors"
          :class="isDownloading ? 'bg-zinc-600 cursor-wait' : isDownloaded ? 'bg-green-600 hover:bg-green-500' : 'bg-red-600 hover:bg-red-500'"
          :disabled="isDownloading"
          @click="emit('play', wad)"
        >
          {{ isDownloading ? "Downloading..." : isDownloaded ? "▶ Play" : "▶ Download & Play" }}
        </button>
        <button
          v-if="isDownloaded"
          class="rounded bg-zinc-700 px-2 py-1.5 text-zinc-400 transition-colors hover:bg-red-900 hover:text-red-400"
          @click="emit('delete', wad)"
          title="Delete WAD"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M6 6l12 12M6 18L18 6"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
