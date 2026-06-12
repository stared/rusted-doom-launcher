// Unit tests for the schema's validation rules. The catalog itself is
// linted against the schema by content/catalog.test.ts (pnpm test:content).

import { describe, it, expect } from "vitest";
import { WadEntrySchema, YouTubeVideoSchema } from "./schema";

describe("WAD Entry Schema", () => {
  describe("year validation", () => {
    const baseWad = {
      slug: "test-wad",
      title: "Test",
      authors: [{ name: "Test" }],
      description: "Test",
      iwad: "doom2",
      type: "megawad",
      sourcePort: "gzdoom",
      requires: [],
      downloads: [{ type: "idgames", url: "https://example.org/test.zip", filename: "test.zip" }],
      thumbnail: "",
      screenshots: [],
      youtubeVideos: [],
      awards: [],
      tags: [],
      difficulty: "unknown",
      urls: ["https://example.org/test"],
      notes: "",
      _schemaVersion: 1,
      _source: "manual",
    };

    it("should accept current year", () => {
      expect(() =>
        WadEntrySchema.parse({ ...baseWad, year: new Date().getFullYear() })
      ).not.toThrow();
    });

    it("should accept next year (for upcoming releases)", () => {
      expect(() =>
        WadEntrySchema.parse({ ...baseWad, year: new Date().getFullYear() + 1 })
      ).not.toThrow();
    });

    it("should reject year too far in the future", () => {
      expect(() =>
        WadEntrySchema.parse({ ...baseWad, year: new Date().getFullYear() + 2 })
      ).toThrow();
    });

    it("should accept 1993 (Doom release year)", () => {
      expect(() =>
        WadEntrySchema.parse({ ...baseWad, year: 1993 })
      ).not.toThrow();
    });

    it("should reject year before Doom existed", () => {
      expect(() =>
        WadEntrySchema.parse({ ...baseWad, year: 1992 })
      ).toThrow();
    });
  });

  describe("slug validation", () => {
    it("should accept valid kebab-case slugs", () => {
      expect(() =>
        WadEntrySchema.parse({
          slug: "ancient-aliens",
          title: "Test",
          authors: [{ name: "Test" }],
          year: 2020,
          description: "Test",
          iwad: "doom2",
          type: "megawad",
          sourcePort: "gzdoom",
          requires: [],
          downloads: [{ type: "idgames", url: "https://example.org/test.zip", filename: "test.zip" }],
          thumbnail: "",
          screenshots: [],
          youtubeVideos: [],
          awards: [],
          tags: [],
          difficulty: "unknown",
          urls: ["https://example.org/test"],
          notes: "",
          _schemaVersion: 1,
          _source: "manual",
        })
      ).not.toThrow();
    });

    it("should reject invalid slugs with uppercase", () => {
      expect(() =>
        WadEntrySchema.parse({
          slug: "Ancient-Aliens",
          title: "Test",
          authors: [{ name: "Test" }],
          year: 2020,
          description: "Test",
          iwad: "doom2",
          type: "megawad",
          sourcePort: "gzdoom",
          requires: [],
          downloads: [{ type: "idgames", url: "https://example.org/test.zip", filename: "test.zip" }],
          thumbnail: "",
          screenshots: [],
          youtubeVideos: [],
          awards: [],
          tags: [],
          difficulty: "unknown",
          urls: ["https://example.org/test"],
          notes: "",
          _schemaVersion: 1,
          _source: "manual",
        })
      ).toThrow();
    });

    it("should reject slugs with spaces", () => {
      expect(() =>
        WadEntrySchema.parse({
          slug: "ancient aliens",
          title: "Test",
          authors: [{ name: "Test" }],
          year: 2020,
          description: "Test",
          iwad: "doom2",
          type: "megawad",
          sourcePort: "gzdoom",
          requires: [],
          downloads: [{ type: "idgames", url: "https://example.org/test.zip", filename: "test.zip" }],
          thumbnail: "",
          screenshots: [],
          youtubeVideos: [],
          awards: [],
          tags: [],
          difficulty: "unknown",
          urls: ["https://example.org/test"],
          notes: "",
          _schemaVersion: 1,
          _source: "manual",
        })
      ).toThrow();
    });
  });
});

describe("YouTube Video Schema", () => {
  it("should accept valid YouTube video IDs (11 characters)", () => {
    const validIds = [
      "dQw4w9WgXcQ", // Standard
      "HB3TdGSDL_A", // With underscore
      "Yp9HiLdvINI", // Mixed case
      "-1234567890", // Starting with hyphen
      "_1234567890", // Starting with underscore
    ];

    validIds.forEach((id) => {
      expect(() =>
        YouTubeVideoSchema.parse({
          id,
          title: "Test Video",
          type: "playthrough",
        })
      ).not.toThrow();
    });
  });

  it("should reject invalid YouTube video IDs", () => {
    const invalidIds = [
      "too-short",      // Too short (9 chars)
      "waytoolongid12", // Too long (14 chars)
      "has spaces!",    // Invalid characters
      "special@char",   // Invalid characters
      "",               // Empty
    ];

    invalidIds.forEach((id) => {
      expect(() =>
        YouTubeVideoSchema.parse({
          id,
          title: "Test Video",
          type: "playthrough",
        })
      ).toThrow();
    });
  });

  it("should validate video types", () => {
    const validTypes = ["review", "playthrough", "trailer", "speedrun"];
    validTypes.forEach((type) => {
      expect(() =>
        YouTubeVideoSchema.parse({
          id: "dQw4w9WgXcQ",
          title: "Test",
          type,
        })
      ).not.toThrow();
    });
  });

  it("should reject invalid video types", () => {
    expect(() =>
      YouTubeVideoSchema.parse({
        id: "dQw4w9WgXcQ",
        title: "Test",
        type: "invalid-type",
      })
    ).toThrow();
  });
});
