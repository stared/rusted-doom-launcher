import { ref, watch, isRef, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

// In-memory cache for resolved data URLs
const imageCache = new Map<string, string>();
const failedUrls = new Set<string>();
const pendingFetches = new Map<string, Promise<string | null>>();
const MAX_CONCURRENT_IMAGE_FETCHES = 3;
let activeImageFetches = 0;
const queuedImageFetches: Array<() => void> = [];

/**
 * Image data URLs are expensive for WebKit to decode. Limit native fetches so
 * entering a screen with many cards cannot start dozens of decodes at once.
 */
function queueImageFetch<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = async () => {
      activeImageFetches++;
      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      } finally {
        activeImageFetches--;
        queuedImageFetches.shift()?.();
      }
    };

    if (activeImageFetches < MAX_CONCURRENT_IMAGE_FETCHES) {
      void run();
    } else {
      queuedImageFetches.push(() => void run());
    }
  });
}

/**
 * Resolves a remote image URL to a local/cached data URL via Tauri backend
 * to bypass CORS / CORP restrictions on external hosts like DoomWiki.
 */
export async function fetchImageDataUrl(url: string): Promise<string | null> {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
    return trimmed;
  }
  // Vite serves bundled assets directly. Sending a relative application path
  // to reqwest produces a URL-builder error and needlessly occupies the image
  // queue.
  if (trimmed.startsWith("/")) {
    return trimmed;
  }

  if (imageCache.has(trimmed)) {
    return imageCache.get(trimmed)!;
  }

  if (failedUrls.has(trimmed)) {
    return null;
  }

  if (pendingFetches.has(trimmed)) {
    return pendingFetches.get(trimmed)!;
  }

  const promise = (async () => {
    try {
      const dataUrl = await queueImageFetch(() =>
        invoke<string>("fetch_remote_image", { url: trimmed })
      );
      imageCache.set(trimmed, dataUrl);
      return dataUrl;
    } catch {
      failedUrls.add(trimmed);
      return null;
    } finally {
      pendingFetches.delete(trimmed);
    }
  })();

  pendingFetches.set(trimmed, promise);
  return promise;
}

/**
 * Reactive composable for loading a remote image as a data URL with automatic caching.
 */
export function useRemoteImage(sourceUrl: Ref<string | null | undefined> | (() => string | null | undefined) | string | null | undefined) {
  const resolvedUrl = ref<string | null>(null);
  const isLoading = ref(false);
  const isError = ref(false);

  function getRaw(): string | null | undefined {
    if (typeof sourceUrl === "function") return sourceUrl();
    if (isRef(sourceUrl)) return sourceUrl.value;
    return sourceUrl;
  }

  async function update() {
    const raw = getRaw();
    if (!raw) {
      resolvedUrl.value = null;
      isLoading.value = false;
      isError.value = false;
      return;
    }

    if (raw.startsWith("data:") || raw.startsWith("blob:")) {
      resolvedUrl.value = raw;
      isLoading.value = false;
      isError.value = false;
      return;
    }

    if (imageCache.has(raw)) {
      resolvedUrl.value = imageCache.get(raw)!;
      isLoading.value = false;
      isError.value = false;
      return;
    }

    if (failedUrls.has(raw)) {
      resolvedUrl.value = null;
      isLoading.value = false;
      isError.value = true;
      return;
    }

    // Do NOT set resolvedUrl.value = raw here, because raw is an external URL
    // which triggers the webview/browser DOM to request it directly and fail with CORP!
    resolvedUrl.value = null;
    isLoading.value = true;
    isError.value = false;

    try {
      const dataUrl = await fetchImageDataUrl(raw);
      if (dataUrl) {
        resolvedUrl.value = dataUrl;
      } else {
        isError.value = true;
      }
    } catch {
      isError.value = true;
    } finally {
      isLoading.value = false;
    }
  }

  if (typeof sourceUrl === "function" || isRef(sourceUrl)) {
    watch(typeof sourceUrl === "function" ? sourceUrl : () => sourceUrl.value, update, { immediate: true });
  } else {
    update();
  }

  return {
    resolvedUrl,
    isLoading,
    isError,
    markError: () => {
      isError.value = true;
    },
  };
}
