<script setup lang="ts">
import { ref, onMounted } from "vue";
import { History, Skull, KeyRound, Package, Clock } from "@lucide/vue";
import { useStats } from "../composables/useStats";
import { useLevelNames } from "../composables/useLevelNames";
import { SKILL_FULL_NAMES, type SkillLevel } from "../lib/statsSchema";
import type { WadEntry } from "../lib/schema";
import { formatTics, getDateKey, formatDateHeader } from "../lib/format";

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
const { loadLevelNames } = useLevelNames();

const dateGroups = ref<DateGroup[]>([]);
const loading = ref(true);


onMounted(async () => {
  loading.value = true;

  // Collect all level entries with metadata
  const entries: { dateKey: string; date: string; wadSlug: string; wadTitle: string; level: LevelEntry }[] = [];

  for (const wad of props.wads) {
    // Load level names from WAD file (cached/persisted)
    const levelNamesMap = await loadLevelNames(wad.slug);

    const sessions = await loadAllSessions(wad.slug);
    for (const session of sessions) {
      const dateKey = getDateKey(session.capturedAt);
      for (const level of session.levels) {
        // Get level name from parsed WAD data (empty string if not defined)
        const levelIdUpper = level.id.toUpperCase();
        const parsedName = levelNamesMap?.get(levelIdUpper) ?? "";

        entries.push({
          dateKey,
          date: session.capturedAt,
          wadSlug: wad.slug,
          wadTitle: wad.title,
          level: {
            levelId: level.id,
            levelName: parsedName,
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

  // Sort by date, OLDEST first (so we can track first occurrence)
  entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Deduplicate: track which levels we've seen per WAD+skill
  // Only show each level the FIRST time it appears (when first completed)
  const seenLevels = new Set<string>();
  const uniqueEntries: typeof entries = [];

  for (const entry of entries) {
    const key = `${entry.wadSlug}:${entry.level.levelId}:${entry.level.skill}`;
    if (!seenLevels.has(key)) {
      seenLevels.add(key);
      uniqueEntries.push(entry);
    }
  }

  // Now sort by date, NEWEST first for display
  uniqueEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Group by date, then by WAD
  const groupedByDate: Record<string, Record<string, LevelEntry[]>> = {};
  const dateOrder: string[] = [];

  for (const entry of uniqueEntries) {
    if (!groupedByDate[entry.dateKey]) {
      groupedByDate[entry.dateKey] = {};
      dateOrder.push(entry.dateKey);
    }
    if (!groupedByDate[entry.dateKey][entry.wadTitle]) {
      groupedByDate[entry.dateKey][entry.wadTitle] = [];
    }
    groupedByDate[entry.dateKey][entry.wadTitle].push(entry.level);
  }

  // Convert to final structure - one DateGroup per unique date
  const result: DateGroup[] = dateOrder.map(dateKey => {
    const wadMap = groupedByDate[dateKey];
    const wads: WadGroup[] = Object.entries(wadMap).map(([wadTitle, levels]) => ({
      wadTitle,
      levels,
    }));
    return {
      date: formatDateHeader(dateKey),
      dateKey,
      wads,
    };
  });

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
        <div class="space-y-6 pl-3 border-l border-zinc-800">
          <div v-for="wadGroup in dateGroup.wads" :key="wadGroup.wadTitle">
            <!-- WAD Name -->
            <div class="text-sm font-medium text-zinc-300 mb-3">{{ wadGroup.wadTitle }}</div>

            <!-- Level Rows -->
            <div
              v-for="(level, idx) in wadGroup.levels"
              :key="`${level.levelId}-${idx}`"
              class="flex items-center gap-6 py-2.5 px-3 -mx-3 rounded hover:bg-zinc-800/40 transition-colors text-sm"
            >
              <!-- Level ID and Name -->
              <div class="flex-1 min-w-0">
                <span class="font-mono text-zinc-500 text-xs">{{ level.levelId }}</span>
                <span v-if="level.levelName" class="ml-1.5 text-zinc-300">{{ level.levelName }}</span>
              </div>

              <!-- Skill -->
              <span class="text-[10px] text-zinc-500 w-28 text-right" :title="level.skill">{{ SKILL_FULL_NAMES[level.skill] }}</span>

              <!-- Stats with colors and icons (icon on right, fixed widths) -->
              <div class="flex items-center gap-5 font-mono text-xs tabular-nums">
                <!-- Kills (red) -->
                <div class="w-20 flex items-center justify-end gap-1" title="Kills">
                  <span :class="level.kills === level.totalKills ? 'text-red-400' : 'text-red-400'">{{ level.kills }}</span>
                  <span class="text-zinc-700">/</span>
                  <span :class="level.kills === level.totalKills ? 'text-red-400' : 'text-zinc-600'">{{ level.totalKills }}</span>
                  <Skull :size="11" class="text-red-400/60 ml-1" />
                </div>
                <!-- Secrets (amber) -->
                <div class="w-14 flex items-center justify-end gap-1" title="Secrets">
                  <span class="text-amber-400">{{ level.secrets }}</span>
                  <span class="text-zinc-700">/</span>
                  <span :class="level.secrets === level.totalSecrets ? 'text-amber-400' : 'text-zinc-600'">{{ level.totalSecrets }}</span>
                  <KeyRound :size="11" class="text-amber-400/60 ml-1" />
                </div>
                <!-- Items (blue) -->
                <div class="w-16 flex items-center justify-end gap-1" title="Items">
                  <span class="text-sky-400">{{ level.items }}</span>
                  <span class="text-zinc-700">/</span>
                  <span :class="level.items === level.totalItems ? 'text-sky-400' : 'text-zinc-600'">{{ level.totalItems }}</span>
                  <Package :size="11" class="text-sky-400/60 ml-1" />
                </div>
                <!-- Time -->
                <div class="w-16 flex items-center justify-end gap-1 text-zinc-400">
                  <span>{{ formatTics(level.timeTics) }}</span>
                  <Clock :size="11" class="text-zinc-500/60 ml-1" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
