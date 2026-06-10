import { describe, it, expect } from "vitest";
import { findGameFileEntries, selectPrimaryGameFile, type ZipEntryInfo, type GameFileInfo } from "./zipExtract";

/** Helper: build a zip listing like the `list_zip_entries` command returns */
function listing(files: Record<string, number>): ZipEntryInfo[] {
  return Object.entries(files).map(([path, size]) => ({ path, size }));
}

describe("findGameFileEntries", () => {
  it("finds single .wad in listing", () => {
    const files = findGameFileEntries(listing({ "map01.wad": 100 }));
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("map01.wad");
    expect(files[0].size).toBe(100);
  });

  it("finds single .pk3 in listing", () => {
    const files = findGameFileEntries(listing({ "mod.pk3": 200 }));
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("mod.pk3");
  });

  it("finds multiple .wad files", () => {
    const files = findGameFileEntries(
      listing({ "map01.wad": 100, "map02.wad": 200, "readme.txt": 50 })
    );
    expect(files).toHaveLength(2);
    const names = files.map(f => f.name).sort();
    expect(names).toEqual(["map01.wad", "map02.wad"]);
  });

  it("ignores non-game files (.txt, .deh, .bex)", () => {
    const files = findGameFileEntries(
      listing({ "readme.txt": 50, "patch.deh": 80, "compat.bex": 30, "level.wad": 100 })
    );
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("level.wad");
  });

  it("handles files in subdirectories (uses basename, keeps entry path)", () => {
    const files = findGameFileEntries(
      listing({ "mymod/maps/level.wad": 100, "mymod/readme.txt": 50 })
    );
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("level.wad");
    expect(files[0].path).toBe("mymod/maps/level.wad");
  });

  it("handles backslash-separated paths from Windows-built zips", () => {
    const files = findGameFileEntries(listing({ "mymod\\level.wad": 100 }));
    expect(files[0].name).toBe("level.wad");
  });

  it("case-insensitive matching (.WAD, .Pk3)", () => {
    const files = findGameFileEntries(listing({ "LEVEL.WAD": 100, "Mod.Pk3": 200 }));
    expect(files).toHaveLength(2);
    const names = files.map(f => f.name).sort();
    expect(names).toEqual(["LEVEL.WAD", "Mod.Pk3"]);
  });

  it("throws when listing contains no game files", () => {
    expect(() =>
      findGameFileEntries(listing({ "readme.txt": 50, "screenshot.png": 1000 }))
    ).toThrow("No WAD or PK3 files found inside ZIP archive");
  });

  it("handles mixed .wad and .pk3 files", () => {
    const files = findGameFileEntries(listing({ "level.wad": 100, "textures.pk3": 300 }));
    expect(files).toHaveLength(2);
    const names = files.map(f => f.name).sort();
    expect(names).toEqual(["level.wad", "textures.pk3"]);
  });
});

describe("selectPrimaryGameFile", () => {
  it("single file: returns it as primary", () => {
    const files: GameFileInfo[] = [{ name: "level.wad", size: 100 }];
    const result = selectPrimaryGameFile(files);
    expect(result.primary.name).toBe("level.wad");
    expect(result.additional).toHaveLength(0);
  });

  it("multiple files: largest is primary", () => {
    const files: GameFileInfo[] = [
      { name: "small.wad", size: 100 },
      { name: "big.wad", size: 500 },
      { name: "medium.wad", size: 300 },
    ];
    const result = selectPrimaryGameFile(files);
    expect(result.primary.name).toBe("big.wad");
    expect(result.additional).toHaveLength(2);
  });

  it("additional files sorted by name for determinism", () => {
    const files: GameFileInfo[] = [
      { name: "zebra.wad", size: 100 },
      { name: "main.wad", size: 500 },
      { name: "alpha.wad", size: 100 },
    ];
    const result = selectPrimaryGameFile(files);
    expect(result.primary.name).toBe("main.wad");
    expect(result.additional.map(f => f.name)).toEqual(["alpha.wad", "zebra.wad"]);
  });
});
