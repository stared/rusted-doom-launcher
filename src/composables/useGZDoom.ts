import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readDir, mkdir } from "@tauri-apps/plugin-fs";
import { IWADS, type Iwad } from "../lib/schema";
import type { SkillLevel } from "../lib/statsSchema";
import { useSettings } from "./useSettings";
import { useGameplayLog } from "./useGameplayLog";
import { useLibrary } from "./useLibrary";
import { isExistsError } from "../lib/errors";

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

// The Rust side emits "gzdoom-exited" from the thread that wait()s on the
// spawned engine process — no polling needed. Registered once, before the
// first launch.
let exitListener: UnlistenFn | null = null;

async function handleEngineExit() {
  isRunning.value = false;
  const session = currentSession.value;
  currentSession.value = null;
  if (!session) return;
  try {
    const log = await invoke<Array<[number, string]> | null>("get_gzdoom_log");
    if (log && log.length > 0) {
      const { saveGameplayLog } = useGameplayLog();
      await saveGameplayLog(session.slug, session.skill, log, session.startedAt, new Date());
    }
  } catch (e) {
    console.error("Failed to save gameplay log:", e);
  }
}

export function useGZDoom() {
  const { settings } = useSettings();
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

    // Register the exit listener before launching so the event can't beat it.
    if (!exitListener) {
      exitListener = await listen("gzdoom-exited", handleEngineExit);
    }

    // Use Rust command to launch GZDoom (supports custom paths)
    await invoke("launch_gzdoom", { gzdoomPath, args });
    isRunning.value = true;
  }

  return { isRunning, availableIwads, detectIwads, launch };
}
