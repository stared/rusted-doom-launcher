<script setup lang="ts">
import { Compass } from "lucide-vue-next";
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-bold tracking-tight">Explore</h1>

    <div class="flex flex-col items-center justify-center py-20 text-center">
      <Compass :size="48" :stroke-width="1.5" class="text-zinc-600 mb-4" />
      <p class="text-zinc-500">Discover new WADs from the community</p>
      <p class="text-zinc-600 text-sm mt-2">Coming soon</p>
    </div>
  </div>
</template>
