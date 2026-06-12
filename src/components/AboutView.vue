<script setup lang="ts">
import { Skull } from "@lucide/vue";
import { open } from "@tauri-apps/plugin-shell";
import { APP_VERSION, GIT_HASH, GIT_DATE } from "../lib/version";
</script>

<template>
  <div class="flex flex-col items-center justify-center h-full text-center space-y-6">
    <Skull :size="64" :stroke-width="1.5" class="text-rose-600" />

    <div>
      <h1 class="text-2xl font-bold tracking-tight">Rusted Doom Launcher</h1>
      <p class="text-zinc-500 mt-2 font-mono text-sm">
        v{{ APP_VERSION }} · {{ GIT_HASH }} · {{ GIT_DATE }}
      </p>
    </div>

    <p class="text-sm text-zinc-400">
      Browse, download, and play Doom community WADs.
    </p>

    <div class="text-sm text-zinc-500">
      <span>MIT License · Source code: </span>
      <button
        class="text-zinc-400 hover:text-zinc-200 transition-colors font-mono"
        @click="open('https://github.com/stared/rusted-doom-launcher')"
      >
        stared/rusted-doom-launcher
      </button>
    </div>
  </div>
</template>
