<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import type { WadEntry } from "../lib/schema";

const TYPE_LABELS: Record<WadEntry["type"], string> = {
  "single-level": "Level", episode: "Episode", megawad: "Megawad",
  "gameplay-mod": "Mod", "total-conversion": "TC", "resource-pack": "Resources",
};

const DIFFICULTY_CONFIG: Record<WadEntry["difficulty"], { label: string; color: string }> = {
  easy: { label: "Easy", color: "bg-green-600" },
  medium: { label: "Medium", color: "bg-yellow-600" },
  hard: { label: "Hard", color: "bg-orange-600" },
  slaughter: { label: "Slaughter", color: "bg-red-600" },
  unknown: { label: "", color: "" },
};

const props = defineProps<{
  wad: WadEntry;
  isDownloaded: boolean;
  isDownloading: boolean;
}>();

const emit = defineEmits<{ play: [wad: WadEntry]; delete: [wad: WadEntry] }>();

const hasVideo = computed(() => props.wad.youtubeVideos.length > 0);
const videoId = computed(() => props.wad.youtubeVideos[0]?.id);

// State
const playerReady = ref(false);
const isPlaying = ref(false);
const playerContainerRef = ref<HTMLDivElement | null>(null);

let player: YT.Player | null = null;

// Load YouTube API globally
const ytWindow = window as Window & {
  onYouTubeIframeAPIReady?: () => void;
  ytApiLoaded?: boolean;
  ytApiCallbacks?: (() => void)[];
};

function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }

    if (!ytWindow.ytApiCallbacks) {
      ytWindow.ytApiCallbacks = [];
    }
    ytWindow.ytApiCallbacks.push(resolve);

    if (!ytWindow.ytApiLoaded) {
      ytWindow.ytApiLoaded = true;
      const existingCallback = ytWindow.onYouTubeIframeAPIReady;
      ytWindow.onYouTubeIframeAPIReady = () => {
        existingCallback?.();
        ytWindow.ytApiCallbacks?.forEach(cb => cb());
        ytWindow.ytApiCallbacks = [];
      };
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
        playerReady.value = true;
      },
      onStateChange: (e: YT.OnStateChangeEvent) => {
        isPlaying.value = e.data === 1;
      },
      onError: (e: YT.OnErrorEvent) => {
        console.error("[YT] Player error for:", props.wad.slug, "code:", e.data);
      },
    },
  });
}

// Pre-load player on mount so it's ready when user clicks
onMounted(async () => {
  if (hasVideo.value) {
    await loadYouTubeAPI();
    initPlayer();
  }
});

onUnmounted(() => {
  player?.destroy();
  player = null;
});

function handleVideoClick(e: MouseEvent) {
  if (!hasVideo.value) {
    emit('play', props.wad);
    return;
  }

  e.stopPropagation();

  // Player should be ready (pre-loaded on mount)
  if (playerReady.value && player) {
    if (isPlaying.value) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  }
}
</script>

<template>
  <div class="overflow-hidden rounded-lg bg-zinc-800 shadow-lg">
    <!-- 16:9 aspect ratio video area -->
    <div
      class="relative aspect-video cursor-pointer overflow-hidden bg-zinc-900"
      @click="handleVideoClick"
    >
      <!-- YouTube player (always present, loaded on mount) -->
      <div
        v-if="hasVideo"
        ref="playerContainerRef"
        class="absolute inset-0 w-full h-full"
      />

      <!-- Play button overlay - shown when not playing -->
      <div
        v-if="hasVideo && !isPlaying"
        class="absolute inset-0 flex items-center justify-center bg-black/30 z-20 pointer-events-none"
      >
        <div class="w-16 h-16 rounded-full bg-red-600/90 flex items-center justify-center shadow-lg">
          <svg class="w-8 h-8 text-white ml-1" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
      </div>

      <!-- Fallback for WADs without video -->
      <div
        v-if="!hasVideo"
        class="absolute inset-0 flex items-center justify-center bg-red-900"
      >
        <span class="text-2xl text-red-300 font-bold">DOOM</span>
      </div>

            <!-- Award badge -->
      <span v-if="wad.awards.length" class="absolute top-2 right-2 text-lg pointer-events-none z-30">🏆</span>
    </div>

    <div class="p-3">
      <h3 class="truncate font-semibold text-zinc-100">{{ wad.title }}</h3>
      <p class="truncate text-sm text-zinc-400">{{ wad.authors.map(a => a.name).join(", ") }} • {{ wad.year }} • {{ TYPE_LABELS[wad.type] }}<template v-if="wad.difficulty !== 'unknown'"> • {{ DIFFICULTY_CONFIG[wad.difficulty].label }}</template></p>

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
