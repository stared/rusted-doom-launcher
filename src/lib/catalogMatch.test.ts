import { describe, expect, it } from "vitest";
import { findCatalogMatch } from "./catalogMatch";
import type { WadEntry } from "./schema";

const catalog = [{
  slug: "sunlust", title: "Sunlust", downloads: [{ filename: "sunlust.zip" }],
}, {
  slug: "other-sunlust", title: "Other Sunlust", downloads: [{ filename: "other.zip" }],
}] as WadEntry[];

describe("findCatalogMatch", () => {
  it("matches an exact title regardless of punctuation", () => {
    expect(findCatalogMatch(catalog, "Sunlust!", "unknown.wad")?.slug).toBe("sunlust");
  });

  it("matches the configured download filename", () => {
    expect(findCatalogMatch(catalog, "Unknown title", "C:\\Wads\\sunlust.zip")?.slug).toBe("sunlust");
  });

  it("rejects ambiguous matches", () => {
    const ambiguous = [...catalog, { ...catalog[0], slug: "sunlust-alt" }];
    expect(findCatalogMatch(ambiguous, "Sunlust", "unknown.wad")).toBeNull();
  });
});
