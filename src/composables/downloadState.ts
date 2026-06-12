import { ref } from "vue";
import type { LauncherDownloads } from "../lib/schema";

// Singleton download bookkeeping. useDownload owns mutation and persistence;
// useLevelNames only resolves slugs to files. Holding the state in its own
// module breaks the useDownload <-> useLevelNames import cycle that
// previously forced useLevelNames to re-read launcher-downloads.json from
// disk via IPC on every lookup.
export const downloads = ref<LauncherDownloads>({ version: 1, downloads: {} });

export function getDownloadRecord(slug: string): LauncherDownloads["downloads"][string] | null {
  return downloads.value.downloads[slug] ?? null;
}
