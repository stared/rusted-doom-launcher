<script setup lang="ts">
import { Plus } from "lucide-vue-next";

defineProps<{
  label?: string;
}>();

defineEmits<{ click: [] }>();
</script>

<template>
  <button
    class="group flex h-full min-h-[200px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-zinc-700 bg-zinc-900/40 p-6 transition-all hover:border-red-600 hover:bg-zinc-800/60"
    @click="$emit('click')"
  >
    <Plus :size="56" :stroke-width="1.5" class="text-zinc-600 transition-colors group-hover:text-red-400" />
    <span class="text-base font-semibold text-zinc-300 transition-colors group-hover:text-zinc-100">
      {{ label ?? 'Add custom' }}
    </span>
  </button>
</template>
