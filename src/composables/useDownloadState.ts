import { ref, computed } from "vue";
import { exists, readTextFile, writeTextFile, remove } from "@tauri-apps/plugin-fs";
import { homeDir } from "@tauri-apps/api/path";
import {
  type LauncherDownloads,
  LauncherDownloadsSchema,
  createEmptyLauncherDownloads,
} from "../lib/schema";

const STATE_FILENAME = "launcher-downloads.json";

// Singleton state - shared across all components
const state = ref<LauncherDownloads>(createEmptyLauncherDownloads());
const loading = ref(true);
const error = ref<string | null>(null);

// Track active downloads with progress (slug -> progress percentage)
const activeDownloads = ref<Map<string, number>>(new Map());

async function getStateFilePath(): Promise<string> {
  const home = await homeDir();
  return `${home}/Library/Application Support/gzdoom/${STATE_FILENAME}`;
}

async function getWadsDir(): Promise<string> {
  const home = await homeDir();
  return `${home}/Library/Application Support/gzdoom`;
}

export function useDownloadState() {
  async function loadState(): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
      console.log("loadState: getting file path...");
      const filePath = await getStateFilePath();
      console.log("loadState: path =", filePath);

      console.log("loadState: checking if file exists...");
      const fileExists = await exists(filePath);
      console.log("loadState: exists =", fileExists);

      if (!fileExists) {
        console.log("loadState: no state file, using empty state");
        state.value = createEmptyLauncherDownloads();
        loading.value = false;
        return;
      }

      console.log("loadState: reading file...");
      const content = await readTextFile(filePath);
      console.log("loadState: read", content.length, "bytes");

      const parsed = JSON.parse(content);
      const validated = LauncherDownloadsSchema.safeParse(parsed);

      if (validated.success) {
        state.value = validated.data;
        console.log("loadState: loaded downloads:", Object.keys(state.value.downloads));
      } else {
        console.error("loadState: invalid state file, resetting:", validated.error);
        state.value = createEmptyLauncherDownloads();
      }
    } catch (e) {
      console.error("loadState: FAILED:", e);
      error.value = e instanceof Error ? e.message : String(e);
      state.value = createEmptyLauncherDownloads();
      // Don't re-throw - just log and continue with empty state
    } finally {
      loading.value = false;
    }
  }

  async function saveState(): Promise<void> {
    try {
      const filePath = await getStateFilePath();
      const content = JSON.stringify(state.value, null, 2);
      await writeTextFile(filePath, content);
    } catch (e) {
      console.error("Failed to save download state:", e);
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  function isTracked(slug: string): boolean {
    return slug in state.value.downloads;
  }

  function getDownloadInfo(slug: string) {
    return state.value.downloads[slug] ?? null;
  }

  async function markDownloaded(
    slug: string,
    filename: string,
    size: number
  ): Promise<void> {
    state.value.downloads[slug] = {
      filename,
      downloadedAt: new Date().toISOString(),
      size,
    };
    await saveState();
  }

  async function removeDownload(slug: string): Promise<void> {
    const info = state.value.downloads[slug];
    if (!info) return;

    // Delete the file
    const wadsDir = await getWadsDir();
    const filePath = `${wadsDir}/${info.filename}`;

    try {
      const fileExists = await exists(filePath);
      if (fileExists) {
        await remove(filePath);
      }
    } catch (e) {
      console.error("Failed to delete file:", e);
      // Continue to remove from state even if file deletion fails
    }

    // Remove from state
    delete state.value.downloads[slug];
    await saveState();
  }

  // Progress tracking
  function setProgress(slug: string, progress: number): void {
    activeDownloads.value.set(slug, progress);
  }

  function clearProgress(slug: string): void {
    activeDownloads.value.delete(slug);
  }

  function getProgress(slug: string): number | null {
    return activeDownloads.value.get(slug) ?? null;
  }

  function isDownloading(slug: string): boolean {
    return activeDownloads.value.has(slug);
  }

  const trackedSlugs = computed(() => Object.keys(state.value.downloads));

  return {
    state,
    loading,
    error,
    activeDownloads,
    loadState,
    saveState,
    isTracked,
    getDownloadInfo,
    markDownloaded,
    removeDownload,
    setProgress,
    clearProgress,
    getProgress,
    isDownloading,
    trackedSlugs,
    getWadsDir,
  };
}
