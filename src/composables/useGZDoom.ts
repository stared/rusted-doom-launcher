import { ref } from "vue";
import { Command } from "@tauri-apps/plugin-shell";
import { readDir, mkdir } from "@tauri-apps/plugin-fs";
import type { Iwad } from "../lib/schema";
import { useSettings } from "./useSettings";

const IWADS: Iwad[] = ["doom", "doom2", "plutonia", "tnt", "heretic", "hexen", "freedoom1", "freedoom2"];

export function useGZDoom() {
  const isRunning = ref(false);
  const availableIwads = ref<Iwad[]>([]);
  const { getLibraryPath, getGZDoomCommandName, isGZDoomFound, gzdoomDetectedPath } = useSettings();

  async function detectIwads() {
    const dir = await getLibraryPath();
    const entries = await readDir(dir);
    const files = new Set(entries.map(e => e.name?.toUpperCase()));
    availableIwads.value = IWADS.filter(iwad => files.has(`${iwad.toUpperCase()}.WAD`));
  }

  async function launch(wadPath: string, iwad: Iwad, additionalFiles: string[] = [], wadSlug?: string) {
    const dir = await getLibraryPath();
    const iwadPath = `${dir}/${iwad.toUpperCase()}.WAD`;

    // Create per-WAD save directory if slug provided
    const saveDir = wadSlug ? `${dir}/saves/${wadSlug}` : null;
    if (saveDir) {
      try {
        await mkdir(saveDir, { recursive: true });
      } catch { /* directory may already exist */ }
    }

    const args = [
      "-iwad", iwadPath,
      "-file", wadPath,
      ...additionalFiles.flatMap(f => ["-file", f]),
      ...(saveDir ? ["-savedir", saveDir] : []),
    ];

    const commandName = getGZDoomCommandName();
    const command = Command.create(commandName, args);
    command.on("close", () => { isRunning.value = false; });
    command.on("error", () => { isRunning.value = false; });

    await command.spawn();
    isRunning.value = true;
  }

  return { isRunning, availableIwads, detectIwads, launch, isGZDoomFound, gzdoomDetectedPath };
}
