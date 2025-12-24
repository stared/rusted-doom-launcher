<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ScrollText, Skull, MapPin, KeyRound, Package, Clock, ChevronDown, ChevronRight } from "lucide-vue-next";
import { useGameplayLog, getDeathCount, getLevelsVisited, formatDuration } from "../composables/useGameplayLog";
import type { GameplayLog, GameEvent } from "../composables/useGameplayLog";
import type { WadEntry } from "../lib/schema";

interface SessionEntry {
  log: GameplayLog;
  wadTitle: string;
  deathCount: number;
  levelsVisited: string[];
}

interface DateGroup {
  date: string;
  dateKey: string;
  sessions: SessionEntry[];
}

const props = defineProps<{
  wads: WadEntry[];
}>();

const { loadAllGameplayLogs } = useGameplayLog();

const dateGroups = ref<DateGroup[]>([]);
const loading = ref(true);
const expandedSessions = ref<Set<string>>(new Set());

// Get local date key for grouping (YYYY-MM-DD in local timezone)
function getDateKey(isoString: string): string {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Format date key as "18 Dec 2025"
function formatDateHeader(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${months[month - 1]} ${year}`;
}

// Format time from ms to HH:MM:SS
function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Get session key for expansion tracking
function getSessionKey(log: GameplayLog): string {
  return `${log.wadSlug}-${log.startedAt}`;
}

function toggleSession(log: GameplayLog) {
  const key = getSessionKey(log);
  if (expandedSessions.value.has(key)) {
    expandedSessions.value.delete(key);
  } else {
    expandedSessions.value.add(key);
  }
}

function isExpanded(log: GameplayLog): boolean {
  return expandedSessions.value.has(getSessionKey(log));
}

// Get icon and color for event type
function getEventStyle(event: GameEvent): { icon: typeof Skull; color: string } {
  switch (event.type) {
    case "death":
      return { icon: Skull, color: "text-red-400" };
    case "level_enter":
      return { icon: MapPin, color: "text-emerald-400" };
    case "pickup":
      return { icon: Package, color: "text-sky-400" };
    case "secret":
      return { icon: KeyRound, color: "text-amber-400" };
    default:
      return { icon: ScrollText, color: "text-zinc-500" };
  }
}

// Get display text for event
function getEventText(event: GameEvent): string {
  switch (event.type) {
    case "death":
      return `Died: ${event.cause}`;
    case "level_enter":
      return `${event.mapId} - ${event.mapName}`;
    case "pickup":
      return `Picked up ${event.item}`;
    case "secret":
      return "Found a secret!";
    default:
      return event.text;
  }
}

// Filter events to only show interesting ones (not all messages)
function getInterestingEvents(events: GameEvent[]): GameEvent[] {
  return events.filter(e => e.type !== "message");
}

onMounted(async () => {
  loading.value = true;

  // Collect all sessions with metadata
  const entries: { dateKey: string; date: string; session: SessionEntry }[] = [];

  for (const wad of props.wads) {
    const logs = await loadAllGameplayLogs(wad.slug);
    for (const log of logs) {
      const dateKey = getDateKey(log.startedAt);
      entries.push({
        dateKey,
        date: log.startedAt,
        session: {
          log,
          wadTitle: wad.title,
          deathCount: getDeathCount(log),
          levelsVisited: getLevelsVisited(log),
        },
      });
    }
  }

  // Sort by date, newest first
  entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Group by date
  const groupedByDate: Record<string, SessionEntry[]> = {};
  const dateOrder: string[] = [];

  for (const entry of entries) {
    if (!groupedByDate[entry.dateKey]) {
      groupedByDate[entry.dateKey] = [];
      dateOrder.push(entry.dateKey);
    }
    groupedByDate[entry.dateKey].push(entry.session);
  }

  // Convert to final structure
  const result: DateGroup[] = dateOrder.map(dateKey => ({
    date: formatDateHeader(dateKey),
    dateKey,
    sessions: groupedByDate[dateKey],
  }));

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
      <ScrollText :size="48" :stroke-width="1.5" class="text-zinc-600 mb-4" />
      <p class="text-zinc-500">No gameplay logs recorded yet</p>
      <p class="text-zinc-600 text-sm mt-2">Play a WAD to capture console output</p>
    </div>

    <div v-else class="space-y-8">
      <!-- Date Group -->
      <div v-for="dateGroup in dateGroups" :key="dateGroup.dateKey">
        <!-- Date Header -->
        <div class="flex items-center gap-2 mb-3">
          <div class="h-1.5 w-1.5 rounded-full bg-violet-600"></div>
          <h2 class="text-xs font-medium text-zinc-400 uppercase tracking-wider">{{ dateGroup.date }}</h2>
        </div>

        <!-- Sessions -->
        <div class="space-y-3 pl-3 border-l border-zinc-800">
          <div
            v-for="session in dateGroup.sessions"
            :key="getSessionKey(session.log)"
            class="bg-zinc-900/50 rounded-lg overflow-hidden"
          >
            <!-- Session Header (clickable) -->
            <button
              @click="toggleSession(session.log)"
              class="w-full flex items-center gap-4 p-4 hover:bg-zinc-800/50 transition-colors text-left"
            >
              <!-- Expand/Collapse Icon -->
              <component
                :is="isExpanded(session.log) ? ChevronDown : ChevronRight"
                :size="16"
                class="text-zinc-500 flex-shrink-0"
              />

              <!-- WAD Title -->
              <div class="flex-1 min-w-0">
                <span class="text-zinc-200 font-medium">{{ session.wadTitle }}</span>
              </div>

              <!-- Stats Summary -->
              <div class="flex items-center gap-6 text-xs font-mono tabular-nums">
                <!-- Deaths -->
                <div class="flex items-center gap-1.5" title="Deaths">
                  <Skull :size="12" class="text-red-400/70" />
                  <span class="text-red-400">{{ session.deathCount }}</span>
                </div>

                <!-- Levels -->
                <div class="flex items-center gap-1.5" title="Levels visited">
                  <MapPin :size="12" class="text-emerald-400/70" />
                  <span class="text-emerald-400">{{ session.levelsVisited.length }}</span>
                </div>

                <!-- Duration -->
                <div class="flex items-center gap-1.5 text-zinc-400" title="Duration">
                  <Clock :size="12" class="text-zinc-500/70" />
                  <span>{{ formatDuration(session.log.durationMs) }}</span>
                </div>
              </div>
            </button>

            <!-- Expanded Event Timeline (inline, no scroll) -->
            <template v-if="isExpanded(session.log)">
              <div
                v-for="(event, idx) in getInterestingEvents(session.log.events)"
                :key="idx"
                class="flex items-center gap-3 px-4 py-1.5 text-sm border-t border-zinc-800/50 first:border-t-zinc-800"
              >
                <!-- Time -->
                <span class="font-mono text-[10px] text-zinc-600 w-14 text-right">
                  {{ formatTime(event.time_ms) }}
                </span>

                <!-- Icon -->
                <component
                  :is="getEventStyle(event).icon"
                  :size="12"
                  :class="getEventStyle(event).color"
                />

                <!-- Text -->
                <span :class="event.type === 'death' ? 'text-red-300' : 'text-zinc-500'" class="text-xs">
                  {{ getEventText(event) }}
                </span>
              </div>

              <!-- Show message if no interesting events -->
              <div
                v-if="getInterestingEvents(session.log.events).length === 0"
                class="px-4 py-4 text-center text-zinc-600 text-xs border-t border-zinc-800"
              >
                No notable events recorded
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
