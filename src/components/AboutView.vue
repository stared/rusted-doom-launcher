<script setup lang="ts">
import { Skull } from "lucide-vue-next";
</script>

<template>
  <div class="flex flex-col items-center justify-center h-full text-center space-y-6">
    <Skull :size="64" :stroke-width="1.5" class="text-rose-600" />

    <div>
      <h1 class="text-2xl font-bold tracking-tight">Doom WAD Launcher</h1>
      <p class="text-zinc-500 mt-2">v0.1.0</p>
    </div>

    <div class="text-sm text-zinc-400 max-w-md space-y-2">
      <p>A modern launcher for GZDoom community WADs.</p>
      <p>Browse, download, and play the best Doom mods with one click.</p>
    </div>

    <div class="text-xs text-zinc-600 space-y-1">
      <p>Built with Tauri + Vue + TypeScript</p>
      <p>Rip and tear, until it is done.</p>
    </div>
  </div>
</template>
