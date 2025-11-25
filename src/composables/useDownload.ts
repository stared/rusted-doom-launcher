import { ref } from "vue";
import { exists, mkdir, writeFile, remove, stat } from "@tauri-apps/plugin-fs";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { WadEntry } from "../lib/schema";
import { useDownloadState } from "./useDownloadState";

export type FileStatus = "not-exists" | "tracked" | "untracked-exists";

export function useDownload() {
  const error = ref<string | null>(null);

  const {
    isTracked,
    markDownloaded,
    setProgress,
    clearProgress,
    getProgress,
    isDownloading,
    getWadsDir,
  } = useDownloadState();

  // Get full path to a WAD file
  async function getWadPath(filename: string): Promise<string> {
    const wadsDir = await getWadsDir();
    return `${wadsDir}/${filename}`;
  }

  // Check if WAD file exists and its tracking status
  async function checkFileStatus(wad: WadEntry): Promise<FileStatus> {
    if (wad.downloads.length === 0) {
      return "not-exists";
    }

    const download = wad.downloads[0];
    const wadsDir = await getWadsDir();
    const filePath = `${wadsDir}/${download.filename}`;

    if (isTracked(wad.slug)) {
      // Verify file still exists
      const fileExists = await exists(filePath);
      if (fileExists) {
        return "tracked";
      }
      // File was deleted externally - treat as not exists
      return "not-exists";
    }

    // Not tracked - check if file exists anyway
    const fileExists = await exists(filePath);
    if (fileExists) {
      return "untracked-exists";
    }

    return "not-exists";
  }

  // Mark an existing (untracked) file as downloaded
  async function markExistingAsDownloaded(wad: WadEntry): Promise<string> {
    if (wad.downloads.length === 0) {
      throw new Error("No download info available for this WAD");
    }

    const download = wad.downloads[0];
    const wadsDir = await getWadsDir();
    const filePath = `${wadsDir}/${download.filename}`;

    // Get file size
    const fileStat = await stat(filePath);
    const size = fileStat.size;

    // Mark as downloaded
    await markDownloaded(wad.slug, download.filename, size);
    console.log(`Marked existing file as downloaded: ${download.filename}`);

    return filePath;
  }

  // Force re-download: delete existing file and download fresh
  async function forceRedownload(wad: WadEntry): Promise<string> {
    if (wad.downloads.length === 0) {
      throw new Error("No download URL available for this WAD");
    }

    const download = wad.downloads[0];
    const wadsDir = await getWadsDir();
    const filePath = `${wadsDir}/${download.filename}`;

    // Delete existing file if it exists
    const fileExists = await exists(filePath);
    if (fileExists) {
      await remove(filePath);
      console.log(`Deleted existing file: ${download.filename}`);
    }

    // Now download fresh (this will handle progress and tracking)
    return downloadWad(wad);
  }

  // Download with progress tracking using Tauri HTTP plugin (bypasses CORS)
  async function downloadWithProgress(
    url: string,
    slug: string
  ): Promise<{ data: Uint8Array; size: number }> {
    const response = await tauriFetch(url);

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const contentLength = response.headers.get("Content-Length");
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      received += value.length;

      // Update progress
      if (total > 0) {
        setProgress(slug, (received / total) * 100);
      } else {
        // Unknown size - show indeterminate-ish progress (received bytes as proxy)
        setProgress(slug, Math.min(90, received / 10000));
      }
    }

    // Combine chunks into single Uint8Array
    const data = new Uint8Array(received);
    let pos = 0;
    for (const chunk of chunks) {
      data.set(chunk, pos);
      pos += chunk.length;
    }

    return { data, size: received };
  }

  // Download a WAD from URL to the GZDoom directory
  async function downloadWad(wad: WadEntry): Promise<string> {
    if (wad.downloads.length === 0) {
      throw new Error("No download URL available for this WAD");
    }

    const download = wad.downloads[0];
    const wadsDir = await getWadsDir();
    const filePath = `${wadsDir}/${download.filename}`;

    // Check if already tracked by us
    if (isTracked(wad.slug)) {
      // Verify file still exists
      const fileExists = await exists(filePath);
      if (fileExists) {
        console.log(`WAD already downloaded: ${download.filename}`);
        return filePath;
      }
      // File was deleted externally, continue with download
    }

    // Check if file exists (maybe downloaded manually)
    const fileExists = await exists(filePath);
    if (fileExists) {
      console.log(`WAD file exists (not tracked): ${download.filename}`);
      return filePath;
    }

    setProgress(wad.slug, 0);
    error.value = null;

    try {
      // Ensure directory exists
      await mkdir(wadsDir, { recursive: true });

      console.log(`Downloading ${download.filename} from ${download.url}`);

      // Download with progress tracking
      const { data, size } = await downloadWithProgress(download.url, wad.slug);

      // Write to file
      await writeFile(filePath, data);

      // Mark as downloaded in state
      await markDownloaded(wad.slug, download.filename, size);

      console.log(`Downloaded ${download.filename} to ${filePath}`);
      setProgress(wad.slug, 100);

      return filePath;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Download failed";
      throw e;
    } finally {
      // Clear progress after a short delay to show 100%
      setTimeout(() => clearProgress(wad.slug), 500);
    }
  }

  // Download WAD and its dependencies
  async function downloadWadWithDependencies(
    wad: WadEntry,
    allWads: WadEntry[]
  ): Promise<{ wadPath: string; dependencyPaths: string[] }> {
    // Download dependencies first
    const dependencyPaths: string[] = [];

    for (const dep of wad.requires) {
      const depWad = allWads.find((w) => w.slug === dep.slug);
      if (depWad) {
        const depPath = await downloadWad(depWad);
        dependencyPaths.push(depPath);
      } else {
        console.warn(`Dependency ${dep.slug} not found in WAD list`);
      }
    }

    // Download the main WAD
    const wadPath = await downloadWad(wad);

    return { wadPath, dependencyPaths };
  }

  return {
    error,
    getWadsDir,
    getWadPath,
    checkFileStatus,
    markExistingAsDownloaded,
    forceRedownload,
    downloadWad,
    downloadWadWithDependencies,
    // Expose state functions for convenience
    isTracked,
    getProgress,
    isDownloading,
  };
}
