import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { STEAM_WANTED_WADS } from "../lib/steamContent";
import { useLibrary } from "./useLibrary";
import { useDownload } from "./useDownload";

export interface SteamStatus {
  installed: boolean;
  steamPath: string | null;
  accountName: string | null;
  personaName: string | null;
  libraries: string[];
  candidateDirs: string[];
  foundWads: string[];
  stagingDir: string | null;
}

export interface SteamLogStatus {
  state: "idle" | "downloading" | "complete" | "failed";
  message: string | null;
}

export interface CollectedWad {
  name: string;
  size: number;
}

export interface SteamImportResult {
  imported: CollectedWad[];
  skipped: string[];
  totalFound: number;
}

export function useSteamImport() {
  const { iwadsDir } = useLibrary();
  const { registerOwnedExpansions } = useDownload();

  const steamStatus = ref<SteamStatus | null>(null);
  const loading = ref(false);
  const importing = ref(false);
  const watching = ref(false);
  const logStatus = ref<SteamLogStatus | null>(null);
  const importResult = ref<SteamImportResult | null>(null);
  const cleanedUpStaging = ref(false);
  const errorMessage = ref<string | null>(null);

  let watchTimer: ReturnType<typeof setInterval> | null = null;

  async function detectSteam(customPath?: string): Promise<SteamStatus> {
    loading.value = true;
    errorMessage.value = null;
    try {
      const status = await invoke<SteamStatus>("detect_steam_installation", {
        customSteamPath: customPath || null,
        wanted: STEAM_WANTED_WADS,
      });
      steamStatus.value = status;
      return status;
    } catch (e: any) {
      errorMessage.value = e?.toString() || "Failed to detect Steam installation";
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function checkLogStatus(): Promise<SteamLogStatus | null> {
    if (!steamStatus.value?.steamPath) return null;
    try {
      const status = await invoke<SteamLogStatus>("check_steam_log_status", {
        steamRoot: steamStatus.value.steamPath,
      });
      logStatus.value = status;
      return status;
    } catch (e) {
      console.warn("[useSteamImport] Failed to check steam content log:", e);
      return null;
    }
  }

  async function triggerDownload(): Promise<boolean> {
    const commandText = "download_depot 2280 2281";
    try {
      await navigator.clipboard.writeText(commandText);
    } catch (e) {
      console.warn("[useSteamImport] Failed to copy to clipboard:", e);
    }

    try {
      await invoke("open_steam_console");
      return true;
    } catch (e: any) {
      errorMessage.value = `Failed to open Steam Console: ${e?.toString() || e}`;
      return false;
    }
  }

  function startWatching(onFound?: () => void) {
    stopWatching();
    watching.value = true;

    watchTimer = setInterval(async () => {
      if (!watching.value) return;

      // 1. Check if files have completed on disk
      if (steamStatus.value?.steamPath) {
        try {
          const status = await invoke<SteamStatus>("detect_steam_installation", {
            customSteamPath: steamStatus.value.steamPath,
            wanted: STEAM_WANTED_WADS,
          });
          steamStatus.value = status;

          const CORE_WADS = ["doom.wad", "doom2.wad", "id1.wad"];
          const hasAllCoreWads = CORE_WADS.every((w) =>
            status.foundWads.map((f) => f.toLowerCase()).includes(w)
          );

          if (hasAllCoreWads) {
            stopWatching();
            if (onFound) onFound();
            return;
          }
        } catch {
        }
      }

      // 2. Check Steam log status
      const log = await checkLogStatus();
      if (log?.state === "failed") {
        errorMessage.value = log.message || "Steam reported a download error.";
        stopWatching();
        return;
      }

      if (log?.state === "complete") {
        stopWatching();
        if (onFound) onFound();
        return;
      }
    }, 1500);
  }

  function stopWatching() {
    watching.value = false;
    if (watchTimer) {
      clearInterval(watchTimer);
      watchTimer = null;
    }
  }

  async function importWadsFromSource(sourceDir: string): Promise<SteamImportResult> {
    importing.value = true;
    errorMessage.value = null;
    try {
      const res = await invoke<SteamImportResult>("import_steam_wads", {
        sourceDir,
        destDir: iwadsDir(),
        wanted: STEAM_WANTED_WADS,
      });
      importResult.value = res;

      await registerOwnedExpansions();
      await detectSteam(steamStatus.value?.steamPath || undefined);

      return res;
    } catch (e: any) {
      errorMessage.value = e?.toString() || "Failed to import Steam WADs";
      throw e;
    } finally {
      importing.value = false;
    }
  }

  async function reclaimStagingSpace(): Promise<void> {
    if (!steamStatus.value?.stagingDir) return;
    try {
      await invoke("cleanup_steam_staging", {
        stagingDir: steamStatus.value.stagingDir,
      });
      cleanedUpStaging.value = true;
      if (steamStatus.value) {
        steamStatus.value.stagingDir = null;
      }
    } catch (e: any) {
      errorMessage.value = e?.toString() || "Failed to cleanup staging directory";
      throw e;
    }
  }

  return {
    steamStatus,
    loading,
    importing,
    watching,
    logStatus,
    importResult,
    cleanedUpStaging,
    errorMessage,
    detectSteam,
    checkLogStatus,
    triggerDownload,
    startWatching,
    stopWatching,
    importWadsFromSource,
    reclaimStagingSpace,
  };
}
