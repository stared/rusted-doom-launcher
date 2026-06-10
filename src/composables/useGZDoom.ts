import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { readDir, mkdir } from "@tauri-apps/plugin-fs";
import type { Iwad } from "../lib/schema";
import type { SkillLevel } from "../lib/statsSchema";
import { useSettings } from "./useSettings";
import { useGameplayLog } from "./useGameplayLog";
import { useLibrary } from "./useLibrary";
import { isExistsError } from "../lib/errors";
import { getOs } from "../lib/platform";

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
  const { settings } = useSettings();
  const { saveGameplayLog } = useGameplayLog();
  const lib = useLibrary();

  async function detectIwads() {
    if (!settings.value.libraryPath) {
      console.warn("[detectIwads] No libraryPath set, skipping");
      return;
    }
    const iwadsDir = lib.iwadsDir();
    let entries: Awaited<ReturnType<typeof readDir>> = [];
    try {
      entries = await readDir(iwadsDir);
      console.log("[detectIwads] Read", entries.length, "entries from", iwadsDir);
    } catch (e) {
      console.warn("[detectIwads] Failed to read:", iwadsDir, e);
    }
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
    console.log("[detectIwads] Available IWADs:", availableIwads.value);
  }

  async function launch(
    wadPath: string,
    iwad: Iwad,
    // Load order matters: dependencies (resource packs) come before the
    // main WAD so it overrides them; mods come after so they override it.
    depFiles: string[] = [],
    modFiles: string[] = [],
    wadSlug?: string,
    skill: SkillLevel = "HMP",
    extraArgs: string[] = []
  ) {
    const filename = iwadFilenames.get(iwad);
    if (!filename) throw new Error(`IWAD ${iwad} not detected`);
    const iwadPath = lib.iwadFile(filename);

    // Create per-WAD save directory if slug provided
    const saveDir = wadSlug ? lib.savesDir(wadSlug) : null;
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
      ...depFiles.flatMap(f => ["-file", f]),
      ...(wadPath ? ["-file", wadPath] : []),
      ...modFiles.flatMap(f => ["-file", f]),
      ...(saveDir ? ["-savedir", saveDir] : []),
      ...extraArgs,
    ];

    const gzdoomPath = settings.value.gzdoomPath;
    if (!gzdoomPath) {
      throw new Error("GZDoom not configured");
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
    // Derive process name from path for each platform (e.g., C:\...\gzdoom.exe -> gzdoom.exe)
    const enginePath = settings.value.gzdoomPath;
    const engineName = enginePath?.split(/[\\/]/).pop() ?? "gzdoom";
    const isWindows = getOs() === "win";
    const processName =
      isWindows && !engineName.toLowerCase().endsWith(".exe")
        ? `${engineName}.exe`
        : engineName;

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

  return { isRunning, availableIwads, detectIwads, launch };
}
