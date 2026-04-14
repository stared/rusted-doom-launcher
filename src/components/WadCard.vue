<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type { WadEntry } from "../lib/schema";
import { useDownload } from "../composables/useDownload";
import { useSaves } from "../composables/useSaves";
import { useLevelNames } from "../composables/useLevelNames";
import { formatBytes, formatTics } from "../lib/format";
import { SKILL_FROM_NUMBER } from "../lib/statsSchema";

const { isDownloaded: checkDownloaded, isDownloading: checkDownloading, getDownloadProgress } = useDownload();
const { getCachedSaveInfo } = useSaves();
const { loadLevelNames, getCachedLevelNames, getLevelDisplayName } = useLevelNames();

const TYPE_LABELS: Record<WadEntry["type"], string> = {
  "single-level": "Level", episode: "Episode", megawad: "Megawad",
  "gameplay-mod": "Mod", "total-conversion": "TC", "resource-pack": "Resources",
  deathmatch: "Deathmatch",
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
}>();

// Reactive download state from composable
const isDownloaded = computed(() => checkDownloaded(props.wad.slug));
const isDownloading = computed(() => checkDownloading(props.wad.slug));
const downloadProgress = computed(() => getDownloadProgress(props.wad.slug));
const saveInfo = computed(() => getCachedSaveInfo(props.wad.slug));

const progressPercent = computed(() => {
  const dp = downloadProgress.value;
  if (!dp || dp.total === 0) return 0;
  return Math.round((dp.progress / dp.total) * 100);
});

const progressText = computed(() => {
  const dp = downloadProgress.value;
  if (!dp) return "Downloading...";
  if (dp.total === 0) return `${formatBytes(dp.progress)}`;
  return `${formatBytes(dp.progress)} / ${formatBytes(dp.total)} (${progressPercent.value}%)`;
});

// Level completion progress
const totalLevels = computed(() => {
  const names = getCachedLevelNames(props.wad.slug);
  return names ? names.size : null;
});

const completionPercent = computed(() => {
  if (!totalLevels.value || !saveInfo.value) return 0;
  return Math.min(100, Math.round((saveInfo.value.mapsPlayed / totalLevels.value) * 100));
});

const emit = defineEmits<{ play: [wad: WadEntry, extraArgs?: string[]]; delete: [wad: WadEntry] }>();

function playLevel(levelname: string) {
  showStatsModal.value = false;
  emit('play', props.wad, ["+map", levelname, "+sv_compat_pistolstart", "1"]);
}

// State
const showStatsModal = ref(false);
const levelNamesLoaded = ref(false);

// Get thumbnail image URL (prefer dedicated thumbnail, fall back to first screenshot)
const thumbnailUrl = computed(() => {
  if (props.wad.thumbnail) return props.wad.thumbnail;
  if (props.wad.screenshots.length > 0) return props.wad.screenshots[0].url;
  return null;
});

// Load level names when stats modal opens
watch(showStatsModal, async (isOpen) => {
  if (isOpen && !levelNamesLoaded.value) {
    await loadLevelNames(props.wad.slug);
    levelNamesLoaded.value = true;
  }
});

</script>

<template>
  <div class="overflow-hidden rounded-lg bg-zinc-800 shadow-lg">
    <!-- 16:9 aspect ratio thumbnail area -->
    <div class="relative aspect-video overflow-hidden bg-zinc-900">
      <!-- Screenshot/thumbnail image -->
      <img
        v-if="thumbnailUrl"
        :src="thumbnailUrl"
        :alt="wad.title"
        class="absolute inset-0 w-full h-full object-cover"
      />

      <!-- Fallback for WADs without thumbnail or screenshots -->
      <div
        v-else
        class="absolute inset-0 flex items-center justify-center bg-red-900"
      >
        <span class="text-2xl text-red-300 font-bold">DOOM</span>
      </div>
    </div>

    <div class="p-3">
      <h3 class="truncate font-semibold text-zinc-100">{{ wad.title }}</h3>
      <p class="truncate text-sm text-zinc-400">{{ wad.authors.map(a => a.name).join(", ") }} • {{ wad.year }} • {{ TYPE_LABELS[wad.type] }}<template v-if="wad.difficulty !== 'unknown'"> • {{ DIFFICULTY_CONFIG[wad.difficulty].label }}</template></p>

      <!-- Save/Progress info (clickable to show details) -->
      <button
        v-if="saveInfo && saveInfo.levels.length > 0"
        class="mt-1 w-full text-left"
        @click="showStatsModal = true"
      >
        <!-- Progress bar when total level count is known -->
        <template v-if="totalLevels">
          <div class="flex items-center gap-2">
            <div class="flex-1 h-1.5 rounded-full bg-zinc-700 overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-300 bg-red-500"
                :style="{ width: `${completionPercent}%` }"
              />
            </div>
            <span class="text-xs text-zinc-400 tabular-nums shrink-0">{{ saveInfo.mapsPlayed }}/{{ totalLevels }}</span>
          </div>
        </template>
        <!-- Fallback text when total unknown -->
        <template v-else>
          <span class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
            {{ saveInfo.mapsPlayed }} maps played • {{ saveInfo.saveCount }} saves
          </span>
        </template>
      </button>

      <div class="mt-3 flex gap-2">
        <button
          class="flex-1 rounded px-3 py-1.5 text-sm font-medium text-white transition-colors relative overflow-hidden"
          :class="isDownloading ? 'bg-zinc-700 cursor-wait' : isDownloaded ? 'bg-green-600 hover:bg-green-500' : 'bg-red-600 hover:bg-red-500'"
          :disabled="isDownloading"
          @click="emit('play', wad)"
        >
          <!-- Progress bar background -->
          <div
            v-if="isDownloading && downloadProgress"
            class="absolute inset-0 bg-blue-600 transition-all duration-300"
            :style="{ width: `${progressPercent}%` }"
          />
          <span class="relative z-10">
            {{ isDownloading ? progressText : isDownloaded ? "▶ Play" : "▶ Download & Play" }}
          </span>
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

  <!-- Stats Modal -->
  <Teleport to="body">
    <div
      v-if="showStatsModal && saveInfo"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      @click.self="showStatsModal = false"
    >
      <div class="bg-zinc-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between p-4 border-b border-zinc-700">
          <h2 class="text-lg font-semibold text-zinc-100">{{ wad.title }} - Level Stats</h2>
          <button
            class="text-zinc-400 hover:text-zinc-200 transition-colors"
            @click="showStatsModal = false"
          >
            <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 6l12 12M6 18L18 6"/>
            </svg>
          </button>
        </div>

        <!-- Table -->
        <div class="overflow-auto flex-1 p-4">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-zinc-400 text-left border-b border-zinc-700">
                <th class="pb-2 pr-4">Level</th>
                <th class="pb-2 pr-4 text-center">Kills</th>
                <th class="pb-2 pr-4 text-center">Items</th>
                <th class="pb-2 pr-4 text-center">Secrets</th>
                <th class="pb-2 pr-4 text-center">Skill</th>
                <th class="pb-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(level, idx) in saveInfo.levels"
                :key="`${level.levelname}-${level.skill}-${idx}`"
                class="group border-b border-zinc-700/50 text-zinc-300 cursor-pointer hover:bg-zinc-700/50"
                :title="`Pistol start ${level.levelname}`"
                @click="playLevel(level.levelname)"
              >
                <td class="py-2 pr-4 font-medium">
                  <span class="flex items-center gap-2">
                    {{ getLevelDisplayName(wad.slug, level.levelname) }}
                    <span class="opacity-0 group-hover:opacity-100 transition-opacity rounded bg-green-600 px-1.5 py-0.5 text-xs text-white shrink-0">▶ Play</span>
                  </span>
                </td>
                <td class="py-2 pr-4 text-center">
                  <span :class="level.killcount === level.totalkills ? 'text-green-400' : ''">
                    {{ level.killcount }}/{{ level.totalkills }}
                  </span>
                </td>
                <td class="py-2 pr-4 text-center">
                  <span :class="level.itemcount === level.totalitems ? 'text-green-400' : ''">
                    {{ level.itemcount }}/{{ level.totalitems }}
                  </span>
                </td>
                <td class="py-2 pr-4 text-center">
                  <span :class="level.secretcount === level.totalsecrets ? 'text-green-400' : ''">
                    {{ level.secretcount }}/{{ level.totalsecrets }}
                  </span>
                </td>
                <td class="py-2 pr-4 text-center text-xs">
                  <span :class="level.skill >= 3 ? 'text-red-400' : level.skill >= 2 ? 'text-yellow-400' : 'text-zinc-400'">
                    {{ SKILL_FROM_NUMBER[level.skill] }}
                  </span>
                </td>
                <td class="py-2 text-right font-mono">{{ formatTics(level.leveltime) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Footer with totals -->
        <div class="p-4 border-t border-zinc-700 text-sm text-zinc-400 flex justify-between">
          <span>
            <template v-if="totalLevels">{{ saveInfo.mapsPlayed }}/{{ totalLevels }} maps completed • {{ saveInfo.saveCount }} saves</template>
            <template v-else>{{ saveInfo.mapsPlayed }} maps played • {{ saveInfo.saveCount }} saves</template>
          </span>
          <span class="text-zinc-500">Click a level to pistol start</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
