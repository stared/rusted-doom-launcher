<script setup lang="ts">
import { ref, onMounted } from "vue";
import { History } from "lucide-vue-next";
import { useStats } from "../composables/useStats";
import type { SkillLevel } from "../lib/statsSchema";
import type { WadEntry } from "../lib/schema";

interface LevelEntry {
  levelId: string;
  levelName: string;
  skill: SkillLevel;
  kills: number;
  totalKills: number;
  secrets: number;
  totalSecrets: number;
  items: number;
  totalItems: number;
  timeTics: number;
}

interface WadGroup {
  wadTitle: string;
  levels: LevelEntry[];
}

interface DateGroup {
  date: string;
  dateKey: string;
  wads: WadGroup[];
}

const props = defineProps<{
  wads: WadEntry[];
}>();

const { loadAllSessions } = useStats();

const dateGroups = ref<DateGroup[]>([]);
const loading = ref(true);

// Format tics to M:SS or H:MM:SS
function formatTime(tics: number): string {
  const seconds = Math.floor(tics / 35);
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Format date as "18 Dec 2025"
function formatDateHeader(isoString: string): string {
  const date = new Date(isoString);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

// Get date key for grouping (YYYY-MM-DD)
function getDateKey(isoString: string): string {
  return isoString.slice(0, 10);
}

onMounted(async () => {
  loading.value = true;

  // Collect all level entries with metadata
  const entries: { dateKey: string; date: string; wadTitle: string; level: LevelEntry }[] = [];

  for (const wad of props.wads) {
    const sessions = await loadAllSessions(wad.slug);
    for (const session of sessions) {
      const dateKey = getDateKey(session.capturedAt);
      for (const level of session.levels) {
        entries.push({
          dateKey,
          date: session.capturedAt,
          wadTitle: wad.title,
          level: {
            levelId: level.id,
            levelName: level.name,
            skill: session.skill,
            kills: level.kills,
            totalKills: level.totalKills,
            secrets: level.secrets,
            totalSecrets: level.totalSecrets,
            items: level.items,
            totalItems: level.totalItems,
            timeTics: level.timeTics,
          },
        });
      }
    }
  }

  // Sort by date, newest first
  entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Group by date, then by WAD
  const groupedByDate = new Map<string, Map<string, LevelEntry[]>>();
  const dateOrder: string[] = [];

  for (const entry of entries) {
    if (!groupedByDate.has(entry.dateKey)) {
      groupedByDate.set(entry.dateKey, new Map());
      dateOrder.push(entry.dateKey);
    }
    const wadMap = groupedByDate.get(entry.dateKey)!;
    if (!wadMap.has(entry.wadTitle)) {
      wadMap.set(entry.wadTitle, []);
    }
    wadMap.get(entry.wadTitle)!.push(entry.level);
  }

  // Convert to final structure
  const result: DateGroup[] = [];
  for (const dateKey of dateOrder) {
    const wadMap = groupedByDate.get(dateKey)!;
    const wads: WadGroup[] = [];
    for (const [wadTitle, levels] of wadMap) {
      wads.push({ wadTitle, levels });
    }
    // Find first entry date for display
    const firstEntry = entries.find(e => e.dateKey === dateKey);
    result.push({
      date: firstEntry ? formatDateHeader(firstEntry.date) : dateKey,
      dateKey,
      wads,
    });
  }

  dateGroups.value = result;
  loading.value = false;
});
</script>

<template>
  <div>
    <div v-if="loading" class="flex items-center justify-center py-20">
      <p class="text-zinc-400">Loading...</p>
    </div>

    <div v-else-if="dateGroups.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <History :size="48" :stroke-width="1.5" class="text-zinc-600 mb-4" />
      <p class="text-zinc-500">No play sessions recorded yet</p>
    </div>

    <div v-else class="space-y-8">
      <!-- Date Group -->
      <div v-for="dateGroup in dateGroups" :key="dateGroup.dateKey">
        <!-- Date Header -->
        <div class="flex items-center gap-2 mb-3">
          <div class="h-1.5 w-1.5 rounded-full bg-rose-600"></div>
          <h2 class="text-xs font-medium text-zinc-400 uppercase tracking-wider">{{ dateGroup.date }}</h2>
        </div>

        <!-- WAD Groups -->
        <div class="space-y-4 pl-3 border-l border-zinc-800">
          <div v-for="wadGroup in dateGroup.wads" :key="wadGroup.wadTitle" class="space-y-1">
            <!-- WAD Name -->
            <div class="text-sm text-zinc-300 mb-2">{{ wadGroup.wadTitle }}</div>

            <!-- Level Rows -->
            <div
              v-for="(level, idx) in wadGroup.levels"
              :key="`${level.levelId}-${idx}`"
              class="flex items-center gap-4 py-1.5 px-3 -mx-3 rounded hover:bg-zinc-800/40 transition-colors text-sm"
            >
              <!-- Level Name -->
              <div class="flex-1 min-w-0">
                <span class="font-mono text-zinc-500 text-xs">{{ level.levelId }}</span>
                <span v-if="level.levelName !== level.levelId" class="ml-1.5 text-zinc-300">{{ level.levelName }}</span>
                <span v-else class="ml-1.5 text-zinc-500">—</span>
              </div>

              <!-- Skill -->
              <span class="text-[10px] font-mono text-zinc-500 w-8">{{ level.skill }}</span>

              <!-- Stats with colors -->
              <div class="flex items-center gap-4 font-mono text-xs tabular-nums">
                <!-- Kills (red) -->
                <div class="w-12 text-right" title="Kills">
                  <span class="text-red-400">{{ level.kills }}</span><span class="text-zinc-700">/</span><span class="text-zinc-600">{{ level.totalKills }}</span>
                </div>
                <!-- Secrets (amber) -->
                <div class="w-8 text-right" title="Secrets">
                  <span class="text-amber-400">{{ level.secrets }}</span><span class="text-zinc-700">/</span><span class="text-zinc-600">{{ level.totalSecrets }}</span>
                </div>
                <!-- Items (blue) -->
                <div class="w-10 text-right" title="Items">
                  <span class="text-sky-400">{{ level.items }}</span><span class="text-zinc-700">/</span><span class="text-zinc-600">{{ level.totalItems }}</span>
                </div>
                <!-- Time -->
                <div class="w-12 text-right text-zinc-400">
                  {{ formatTime(level.timeTics) }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
