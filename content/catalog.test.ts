// Catalog linter, not a unit test suite: validates every content/wads/*.json
// entry against the schema plus content rules (slug matches filename, real
// download URLs, sane years). Run with `pnpm test:content`. Kept out of
// `pnpm test` so the unit-test count reflects code tests.
//
// Set CHECK_YOUTUBE=1 to also verify referenced YouTube videos still exist —
// network calls, so off by default.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { safeValidateWadEntry } from "../src/lib/schema";
import { GOG_EXPANSIONS } from "../src/lib/gogContent";

const CHECK_YOUTUBE = !!process.env.CHECK_YOUTUBE;

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

const CONTENT_DIR = join(__dirname, "wads");

function getWadFiles(): string[] {
  return readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".json"));
}

describe("WAD catalog", () => {
  const wadFiles = getWadFiles();

  it("should have at least one WAD file", () => {
    expect(wadFiles.length).toBeGreaterThan(0);
  });

  wadFiles.forEach((filename) => {
    describe(filename, () => {
      const filePath = join(CONTENT_DIR, filename);
      const content = readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);

      it("should validate against WadEntrySchema", () => {
        const result = safeValidateWadEntry(data);
        if (!result.success) {
          console.error(`Validation errors in ${filename}:`, result.error.issues);
        }
        expect(result.success).toBe(true);
      });

      it("should have slug matching filename", () => {
        const expectedSlug = filename.replace(".json", "");
        expect(data.slug).toBe(expectedSlug);
      });

      it("should have at least one author", () => {
        expect(data.authors.length).toBeGreaterThan(0);
        expect(data.authors[0].name.length).toBeGreaterThan(0);
      });

      it("should have at least one download source (unless obtainable via GOG import)", () => {
        const gogSourced = GOG_EXPANSIONS.some(e => e.slug === data.slug);
        if (!gogSourced) {
          expect(data.downloads.length).toBeGreaterThan(0);
        }
        for (const download of data.downloads) {
          expect(download.url).toMatch(/^https?:\/\//);
        }
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

        // Verify videos still exist via the oEmbed API — network, opt-in only.
        data.youtubeVideos.forEach((video: { id: string; title: string }) => {
          it.runIf(CHECK_YOUTUBE)(`YouTube video "${video.title}" (${video.id}) should exist`, async () => {
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
