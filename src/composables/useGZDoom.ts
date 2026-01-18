import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { readDir, mkdir } from "@tauri-apps/plugin-fs";
import type { Iwad } from "../lib/schema";
import type { SkillLevel } from "../lib/statsSchema";
import { useSettings } from "./useSettings";
import { useGameplayLog } from "./useGameplayLog";
import { isExistsError } from "../lib/errors";

const IWADS: Iwad[] = ["doom", "doom2", "plutonia", "tnt", "heretic", "hexen", "freedoom1", "freedoom2"];

// Session tracking for gameplay log
interface SessionInfo {
  slug: string;
  skill: SkillLevel;
  startedAt: Date;
}

// Singleton state - shared across all components
const isRunning = ref(false);
const availableIwads = ref<Iwad[]>([]);
const currentSession = ref<SessionInfo | null>(null);
const iwadFilenames = new Map<Iwad, string>(); // e.g., "doom" -> "doom.wad"

export function useGZDoom() {
  const { getLibraryPath, getGZDoomPath, isGZDoomFound, gzdoomDetectedPath } = useSettings();
  const { saveGameplayLog } = useGameplayLog();

  async function detectIwads() {
    const dir = await getLibraryPath();
    const entries = await readDir(dir);
    iwadFilenames.clear();
    availableIwads.value = IWADS.filter(iwad => {
      const found = entries.find(e =>
        e.name?.toUpperCase() === `${iwad.toUpperCase()}.WAD`
      );
      if (found?.name) {
        iwadFilenames.set(iwad, found.name);
        return true;
      }
      return false;
    });
  }

  async function launch(
    wadPath: string,
    iwad: Iwad,
    additionalFiles: string[] = [],
    wadSlug?: string,
    skill: SkillLevel = "HMP"
  ) {
    const dir = await getLibraryPath();
    const filename = iwadFilenames.get(iwad);
    if (!filename) throw new Error(`IWAD ${iwad} not detected`);
    const iwadPath = `${dir}/${filename}`;

    // Create per-WAD save directory if slug provided
    const saveDir = wadSlug ? `${dir}/saves/${wadSlug}` : null;
    if (saveDir) {
      try {
        await mkdir(saveDir, { recursive: true });
      } catch (e) {
        if (!isExistsError(e)) throw e;
        // Directory already exists - that's fine
      }
    }

    const args = [
      "-iwad", iwadPath,
      "-file", wadPath,
      ...additionalFiles.flatMap(f => ["-file", f]),
      ...(saveDir ? ["-savedir", saveDir] : []),
    ];

    const gzdoomPath = getGZDoomPath();
    if (!gzdoomPath) {
      throw new Error("GZDoom not found");
    }

    // Track session info for gameplay log
    if (wadSlug) {
      currentSession.value = {
        slug: wadSlug,
        skill,
        startedAt: new Date(),
      };
    }

    // Use Rust command to launch GZDoom (supports custom paths)
    await invoke("launch_gzdoom", { gzdoomPath, args });
    isRunning.value = true;

    // Poll to detect when GZDoom exits
    pollForExit();
  }

  function pollForExit() {
    // Derive process name from path (e.g., /bin/uzdoom -> uzdoom)
    const enginePath = getGZDoomPath();
    const processName = enginePath?.split("/").pop() ?? "gzdoom";

    const pollInterval = setInterval(async () => {
      try {
        const running = await invoke<boolean>("is_process_running", { processName });
        if (!running) {
          clearInterval(pollInterval);
          isRunning.value = false;

          // Capture gameplay log if we have session info
          if (currentSession.value) {
            try {
              const log = await invoke<Array<[number, string]> | null>("get_gzdoom_log");
              if (log && log.length > 0) {
                await saveGameplayLog(
                  currentSession.value.slug,
                  currentSession.value.skill,
                  log,
                  currentSession.value.startedAt,
                  new Date()
                );
              }
            } catch (e) {
              console.error("Failed to save gameplay log:", e);
            }
            currentSession.value = null;
          }
        }
      } catch {
        // If check fails, assume not running
        clearInterval(pollInterval);
        isRunning.value = false;
        currentSession.value = null;
      }
    }, 2000); // Check every 2 seconds
  }

  return { isRunning, availableIwads, detectIwads, launch, isGZDoomFound, gzdoomDetectedPath };
}
