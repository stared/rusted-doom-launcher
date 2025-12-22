<script setup lang="ts">
import { Gamepad2, HardDrive, Compass, Settings2, Info } from "lucide-vue-next";

type View = "main" | "library" | "explore" | "settings" | "about";

defineProps<{
  activeView: View;
}>();

const emit = defineEmits<{
  navigate: [view: View];
}>();

const topNav: { view: View; icon: typeof Gamepad2; label: string }[] = [
  { view: "main", icon: Gamepad2, label: "Play" },
  { view: "library", icon: HardDrive, label: "Library" },
  { view: "explore", icon: Compass, label: "Explore" },
];

const bottomNav: { view: View; icon: typeof Settings2; label: string }[] = [
  { view: "settings", icon: Settings2, label: "Settings" },
  { view: "about", icon: Info, label: "About" },
];
</script>

<template>
  <nav class="w-[72px] flex flex-col items-center py-4 bg-zinc-900 border-r border-zinc-800">
    <!-- Top Navigation -->
    <div class="flex flex-col gap-1 w-full px-2">
      <button
        v-for="item in topNav"
        :key="item.view"
        class="group relative flex flex-col items-center justify-center w-full py-2 rounded-md transition-all duration-200 active:scale-95"
        :class="activeView === item.view
          ? 'bg-zinc-800/80 text-rose-500'
          : 'text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/40'"
        @click="emit('navigate', item.view)"
      >
        <!-- Active Indicator Line -->
        <div
          v-if="activeView === item.view"
          class="absolute left-0 top-2 bottom-2 w-1 bg-rose-600 rounded-r-full"
        />
        <component :is="item.icon" :size="20" :stroke-width="activeView === item.view ? 2.5 : 2" />
        <span class="text-[10px] mt-1">{{ item.label }}</span>
      </button>
    </div>

    <!-- Spacer -->
    <div class="flex-grow" />

    <!-- Bottom Navigation -->
    <div class="flex flex-col gap-1 w-full px-2">
      <button
        v-for="item in bottomNav"
        :key="item.view"
        class="group relative flex flex-col items-center justify-center w-full py-2 rounded-md transition-all duration-200 active:scale-95"
        :class="activeView === item.view
          ? 'bg-zinc-800/80 text-rose-500'
          : 'text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/40'"
        @click="emit('navigate', item.view)"
      >
        <!-- Active Indicator Line -->
        <div
          v-if="activeView === item.view"
          class="absolute left-0 top-2 bottom-2 w-1 bg-rose-600 rounded-r-full"
        />
        <component :is="item.icon" :size="20" :stroke-width="activeView === item.view ? 2.5 : 2" />
        <span class="text-[10px] mt-1">{{ item.label }}</span>
      </button>
    </div>
  </nav>
</template>
