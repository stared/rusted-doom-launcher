import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useLibrary } from "./useLibrary";

interface WadRatingsFile {
  version: 1;
  ratings: Record<string, number>;
}

const ratings = ref<Record<string, number>>({});

function normalize(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 5 ? value : 0;
}

/** Stores personal ratings separately from the read-only WAD catalog. */
export function useWadRatings() {
  const { base } = useLibrary();

  async function loadState() {
    const raw = await invoke<unknown>("read_wad_ratings", { libraryPath: base() });
    const file = raw as Partial<WadRatingsFile>;
    const next: Record<string, number> = {};
    for (const [slug, rating] of Object.entries(file.ratings ?? {})) {
      if (typeof rating === "number" && normalize(rating) === rating) {
        next[slug] = rating;
      }
    }
    ratings.value = next;
  }

  function getRating(slug: string, importedRating = 0): number {
    return ratings.value[slug] ?? normalize(importedRating);
  }

  async function setRating(slug: string, rating: number) {
    const previous = ratings.value;
    const next = { ...previous };
    const normalized = normalize(rating);
    // Preserve zero as an explicit override: it lets a user clear a rating
    // that was originally imported from DoomLauncher.
    next[slug] = normalized;
    ratings.value = next;
    try {
      await invoke("write_wad_ratings", {
        libraryPath: base(),
        state: { version: 1, ratings: next } satisfies WadRatingsFile,
      });
    } catch (error) {
      ratings.value = previous;
      throw error;
    }
  }

  return { ratings, loadState, getRating, setRating };
}
