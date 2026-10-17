import { describe, expect, it } from "vitest";
import { getWadLinks } from "./wadLinks";
import type { WadEntry } from "./schema";

const wad = {
  urls: ["http://www.doomworld.com/", "http://esselfortium.net/"],
  notes: "",
  downloads: [],
} as unknown as WadEntry;

describe("getWadLinks", () => {
  it("keeps arbitrary author websites found in custom WAD READMEs", () => {
    expect(getWadLinks(wad)).toEqual([
      { label: "doomworld.com", url: "https://www.doomworld.com/" },
      { label: "esselfortium.net", url: "https://esselfortium.net/" },
    ]);
  });

  it("can omit a direct download URL when the view has its own download action", () => {
    const downloadableWad = {
      ...wad,
      downloads: [{
        type: "direct",
        url: "https://example.invalid/mod.zip",
        filename: "mod.zip",
      }],
    } as unknown as WadEntry;

    expect(getWadLinks(downloadableWad, { includeDownloadSource: false })).toEqual([
      { label: "doomworld.com", url: "https://www.doomworld.com/" },
      { label: "esselfortium.net", url: "https://esselfortium.net/" },
    ]);
  });
});
