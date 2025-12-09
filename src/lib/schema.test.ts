import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  WadEntrySchema,
  YouTubeVideoSchema,
  safeValidateWadEntry,
} from "./schema";

// Check if a YouTube video actually exists via oEmbed API
async function youtubeVideoExists(videoId: string): Promise<boolean> {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

// Check if a URL is accessible (HEAD request to avoid downloading full file)
async function urlIsAccessible(url: string): Promise<{ ok: boolean; status: number }> {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "follow" });
    return { ok: response.ok, status: response.status };
  } catch {
    // Some servers don't support HEAD, try GET with abort
    try {
      const controller = new AbortController();
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal
      });
      controller.abort(); // Don't download the whole file
      return { ok: response.ok, status: response.status };
    } catch {
      return { ok: false, status: 0 };
    }
  }
}

const CONTENT_DIR = join(__dirname, "../../content/wads");

// Get all WAD JSON files
function getWadFiles(): string[] {
  return readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".json"));
}

describe("WAD Entry Schema", () => {
  describe("validates all WAD JSON files", () => {
    const wadFiles = getWadFiles();

    it("should have at least one WAD file", () => {
      expect(wadFiles.length).toBeGreaterThan(0);
    });

    wadFiles.forEach((filename) => {
      it(`should validate ${filename}`, () => {
        const filePath = join(CONTENT_DIR, filename);
        const content = readFileSync(filePath, "utf-8");
        const data = JSON.parse(content);

        const result = safeValidateWadEntry(data);
        if (!result.success) {
          console.error(`Validation errors in ${filename}:`, result.error.issues);
        }
        expect(result.success).toBe(true);
      });
    });
  });

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
      downloads: [{ type: "idgames", url: "https://example.com", filename: "test.zip" }],
      thumbnail: "",
      screenshots: [],
      youtubeVideos: [],
      awards: [],
      tags: [],
      difficulty: "unknown",
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
          downloads: [{ type: "idgames", url: "https://example.com", filename: "test.zip" }],
          thumbnail: "",
          screenshots: [],
          youtubeVideos: [],
          awards: [],
          tags: [],
          difficulty: "unknown",
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
          downloads: [{ type: "idgames", url: "https://example.com", filename: "test.zip" }],
          thumbnail: "",
          screenshots: [],
          youtubeVideos: [],
          awards: [],
          tags: [],
          difficulty: "unknown",
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
          downloads: [{ type: "idgames", url: "https://example.com", filename: "test.zip" }],
          thumbnail: "",
          screenshots: [],
          youtubeVideos: [],
          awards: [],
          tags: [],
          difficulty: "unknown",
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

describe("WAD JSON files content checks", () => {
  const wadFiles = getWadFiles();

  wadFiles.forEach((filename) => {
    describe(filename, () => {
      const filePath = join(CONTENT_DIR, filename);
      const content = readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);

      it("should have slug matching filename", () => {
        const expectedSlug = filename.replace(".json", "");
        expect(data.slug).toBe(expectedSlug);
      });

      it("should have at least one author", () => {
        expect(data.authors.length).toBeGreaterThan(0);
        expect(data.authors[0].name.length).toBeGreaterThan(0);
      });

      it("should have at least one download source", () => {
        expect(data.downloads.length).toBeGreaterThan(0);
        expect(data.downloads[0].url).toMatch(/^https?:\/\//);
      });

      // Actually verify download URLs are accessible via network request
      data.downloads.forEach((download: { url: string; filename: string; type: string }) => {
        it(`download URL for "${download.filename}" should be accessible`, async () => {
          const result = await urlIsAccessible(download.url);
          expect(
            result.ok,
            `Download URL ${download.url} returned status ${result.status}`
          ).toBe(true);
        });
      });

      it("should have valid year", () => {
        expect(data.year).toBeGreaterThanOrEqual(1993);
        expect(data.year).toBeLessThanOrEqual(new Date().getFullYear() + 1);
      });

      it("should have thumbnail as empty string or valid URL", () => {
        if (data.thumbnail === "") {
          expect(data.thumbnail).toBe("");
        } else {
          expect(data.thumbnail).toMatch(/^https?:\/\/.+/);
        }
      });

      it("should have all screenshots as valid URLs", () => {
        data.screenshots.forEach((screenshot: { url: string }) => {
          expect(screenshot.url).toMatch(/^https?:\/\/.+/);
        });
      });

      if (data.youtubeVideos && data.youtubeVideos.length > 0) {
        it("should have valid YouTube video IDs (format)", () => {
          data.youtubeVideos.forEach((video: { id: string }) => {
            // YouTube IDs are exactly 11 characters
            expect(video.id).toMatch(/^[a-zA-Z0-9_-]{11}$/);
          });
        });

        // Actually verify YouTube videos exist via network request
        data.youtubeVideos.forEach((video: { id: string; title: string }) => {
          it(`YouTube video "${video.title}" (${video.id}) should exist`, async () => {
            const exists = await youtubeVideoExists(video.id);
            expect(exists, `YouTube video ${video.id} does not exist`).toBe(true);
          });
        });
      }

      if (data.awards && data.awards.length > 0) {
        it("should have valid award years", () => {
          data.awards.forEach((award: { year: number }) => {
            expect(award.year).toBeGreaterThanOrEqual(1994); // Cacowards started in 2004, but some old awards exist
            expect(award.year).toBeLessThanOrEqual(new Date().getFullYear());
          });
        });
      }
    });
  });
});
