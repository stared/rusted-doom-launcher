import { describe, it, expect } from "vitest";
import { ref } from "vue";
import { useTags } from "./useTags";
import type { WadEntry } from "../lib/schema";

describe("useTags composable", () => {
  it("aggregates tags and counts from wad entries", () => {
    const dummyWads = ref<WadEntry[]>([
      {
        slug: "wad-1",
        title: "Wad 1",
        authors: [{ name: "Author 1" }],
        year: 2020,
        description: "desc",
        iwad: "doom2",
        type: "megawad",
        sourcePort: "gzdoom",
        requires: [],
        downloads: [],
        thumbnail: "",
        screenshots: [],
        youtubeVideos: [],
        awards: [],
        tags: ["Slaughter", "Favorite"],
        rating: 0,
        difficulty: "unknown",
        urls: [],
        notes: "",
        extraArgs: [],
        _schemaVersion: 1,
        _source: "manual",
      },
      {
        slug: "wad-2",
        title: "Wad 2",
        authors: [{ name: "Author 2" }],
        year: 2021,
        description: "desc",
        iwad: "doom2",
        type: "episode",
        sourcePort: "gzdoom",
        requires: [],
        downloads: [],
        thumbnail: "",
        screenshots: [],
        youtubeVideos: [],
        awards: [],
        tags: ["Slaughter", "Cacowards"],
        rating: 0,
        difficulty: "unknown",
        urls: [],
        notes: "",
        extraArgs: [],
        _schemaVersion: 1,
        _source: "manual",
      },
    ]);

    const { tagCounts, allTags, selectTag, selectedTag } = useTags(dummyWads);

    expect(tagCounts.value.get("Slaughter")).toBe(2);
    expect(tagCounts.value.get("Favorite")).toBe(1);
    expect(tagCounts.value.get("Cacowards")).toBe(1);

    expect(allTags.value[0].name).toBe("Slaughter");
    expect(allTags.value[0].count).toBe(2);

    selectTag("Slaughter");
    expect(selectedTag.value).toBe("Slaughter");

    selectTag("Slaughter"); // toggle
    expect(selectedTag.value).toBeNull();
  });
});
