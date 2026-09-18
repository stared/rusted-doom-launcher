import { describe, it, expect } from "vitest";
import { isOutlierAspect, markImageAspect, isImageOutlier } from "./constants";

describe("isOutlierAspect", () => {
  it("treats standard 16:9 widescreen as within tolerance", () => {
    expect(isOutlierAspect(640, 360)).toBe(false);
    expect(isOutlierAspect(1920, 1080)).toBe(false);
  });

  it("treats classic 4:3 and 16:10 Doom ratios as within tolerance", () => {
    // 4:3 (640x480, aspect ~1.33)
    expect(isOutlierAspect(640, 480)).toBe(false);
    // 16:10 (320x200, aspect 1.6)
    expect(isOutlierAspect(320, 200)).toBe(false);
    // Brutal Doom (625x300, aspect 2.08)
    expect(isOutlierAspect(625, 300)).toBe(false);
    // Legacy of Rust (426x200, aspect 2.13)
    expect(isOutlierAspect(426, 200)).toBe(false);
  });

  it("identifies extreme panoramic banners as outliers", () => {
    // Smooth Doom (500x121, aspect 4.13)
    expect(isOutlierAspect(500, 121)).toBe(true);
    // Void and Rainbow (640x254, aspect 2.52)
    expect(isOutlierAspect(640, 254)).toBe(true);
    // Nostalgic Entropy (576x240, aspect 2.40)
    expect(isOutlierAspect(576, 240)).toBe(true);
  });

  it("identifies tall and square images as outliers", () => {
    // Legacy of Suffering (640x567, aspect 1.13)
    expect(isOutlierAspect(640, 567)).toBe(true);
    // The Wayfarer (640x512, aspect 1.25)
    expect(isOutlierAspect(640, 512)).toBe(true);
    // Square image (500x500, aspect 1.0)
    expect(isOutlierAspect(500, 500)).toBe(true);
  });

  it("handles zero or invalid dimensions gracefully", () => {
    expect(isOutlierAspect(0, 0)).toBe(false);
    expect(isOutlierAspect(640, 0)).toBe(false);
    expect(isOutlierAspect(0, 480)).toBe(false);
  });
});

describe("markImageAspect and isImageOutlier", () => {
  it("caches outlier results for image URLs", () => {
    const smoothDoomUrl = "https://cdn.jsdelivr.net/.../smooth-doom.webp";
    const doom2Url = "https://cdn.jsdelivr.net/.../doom2.webp";

    expect(isImageOutlier(smoothDoomUrl)).toBe(false);
    expect(isImageOutlier(doom2Url)).toBe(false);

    markImageAspect(smoothDoomUrl, 500, 121);
    markImageAspect(doom2Url, 640, 480);

    expect(isImageOutlier(smoothDoomUrl)).toBe(true);
    expect(isImageOutlier(doom2Url)).toBe(false);
  });
});

