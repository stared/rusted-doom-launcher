<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type { WadEntry } from "../lib/schema";
import { useDownload } from "../composables/useDownload";
import { useStats } from "../composables/useStats";
import { useLevelNames } from "../composables/useLevelNames";
import { formatTics } from "../lib/format";
import { SKILL_FULL_NAMES } from "../lib/statsSchema";
import DownloadPlayButton from "./DownloadPlayButton.vue";
import WadLinks from "./WadLinks.vue";

const { isDownloaded: checkDownloaded } = useDownload();
const { getCachedPlaySummary } = useStats();
const { loadLevelNames, getCachedLevelNames, getLevelDisplayName } = useLevelNames();

const TYPE_LABELS: Record<WadEntry["type"], string> = {
  iwad: "Base game",
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

const isDownloaded = computed(() => checkDownloaded(props.wad.slug));
const saveInfo = computed(() => getCachedPlaySummary(props.wad.slug));

// Level completion progress
const totalLevels = computed(() => {
  const names = getCachedLevelNames(props.wad.slug);
  return names ? names.size : null;
});

const completionPercent = computed(() => {
  if (!totalLevels.value || !saveInfo.value) return 0;
  return Math.min(100, Math.round((saveInfo.value.mapsPlayed / totalLevels.value) * 100));
});

const emit = defineEmits<{ play: [wad: WadEntry, extraArgs?: string[]]; delete: [wad: WadEntry]; edit: [wad: WadEntry] }>();

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
        class="absolute inset-0 flex items-center justify-center bg-red-900 px-4 text-center"
      >
        <span class="text-xl text-red-200 font-bold leading-tight line-clamp-3">{{ wad.title }}</span>
      </div>
    </div>

    <div class="p-3">
      <h3 class="truncate font-semibold text-zinc-100 flex items-center gap-2">
        <span class="truncate">{{ wad.title }}</span>
        <span
          v-if="wad._source === 'custom'"
          class="shrink-0 rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-300"
          title="Imported from your disk"
        >Custom</span>
      </h3>
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
            {{ saveInfo.mapsPlayed }} maps played • {{ saveInfo.sessionCount }} sessions
          </span>
        </template>
      </button>

      <!-- Reference links (Doomworld thread, DoomWiki) -->
      <WadLinks :wad="wad" class="mt-2" />

      <div class="mt-3 flex gap-2">
        <DownloadPlayButton
          class="flex-1"
          :wad="wad"
          play-label="Play"
          download-label="▶ Download & Play"
          @play="emit('play', wad)"
        />
        <button
          v-if="wad._source === 'custom'"
          class="rounded bg-zinc-700 px-2 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-zinc-100"
          @click="emit('edit', wad)"
          title="Edit custom entry"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
          </svg>
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
                :key="`${level.id}-${level.skill}-${idx}`"
                class="group border-b border-zinc-700/50 text-zinc-300 cursor-pointer hover:bg-zinc-700/50"
                :title="`Pistol start ${level.id}`"
                @click="playLevel(level.id)"
              >
                <td class="py-2 pr-4 font-medium">
                  <span class="flex items-center gap-2">
                    {{ getLevelDisplayName(wad.slug, level.id) }}
                    <span class="opacity-0 group-hover:opacity-100 transition-opacity rounded bg-green-600 px-1.5 py-0.5 text-xs text-white shrink-0">▶ Play</span>
                  </span>
                </td>
                <td class="py-2 pr-4 text-center">
                  <span :class="level.kills === level.totalKills ? 'text-green-400' : ''">
                    {{ level.kills }}/{{ level.totalKills }}
                  </span>
                </td>
                <td class="py-2 pr-4 text-center">
                  <span :class="level.items === level.totalItems ? 'text-green-400' : ''">
                    {{ level.items }}/{{ level.totalItems }}
                  </span>
                </td>
                <td class="py-2 pr-4 text-center">
                  <span :class="level.secrets === level.totalSecrets ? 'text-green-400' : ''">
                    {{ level.secrets }}/{{ level.totalSecrets }}
                  </span>
                </td>
                <td class="py-2 pr-4 text-center text-xs">
                  <span :class="['UV', 'NM'].includes(level.skill) ? 'text-red-400' : level.skill === 'HMP' ? 'text-yellow-400' : 'text-zinc-400'">
                    {{ SKILL_FULL_NAMES[level.skill] }}
                  </span>
                </td>
                <td class="py-2 text-right font-mono">{{ formatTics(level.timeTics) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Footer with totals -->
        <div class="p-4 border-t border-zinc-700 text-sm text-zinc-400 flex justify-between">
          <span>
            <template v-if="totalLevels">{{ saveInfo.mapsPlayed }}/{{ totalLevels }} maps completed • {{ saveInfo.sessionCount }} sessions</template>
            <template v-else>{{ saveInfo.mapsPlayed }} maps played • {{ saveInfo.sessionCount }} sessions</template>
          </span>
          <span class="text-zinc-500">Click a level to pistol start</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
