import { describe, it, expect } from "vitest";
import { zipSync } from "fflate";
import { findGameFilesInZip, selectPrimaryGameFile, type GameFile } from "./zipExtract";

/** Helper: create a synthetic ZIP containing given files */
function makeZip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}

/** Helper: create dummy data of a given size */
function dummyData(size: number): Uint8Array {
  return new Uint8Array(size).fill(0x42);
}

describe("findGameFilesInZip", () => {
  it("extracts single .wad from ZIP", () => {
    const zip = makeZip({ "map01.wad": dummyData(100) });
    const files = findGameFilesInZip(zip);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("map01.wad");
    expect(files[0].data.length).toBe(100);
  });

  it("extracts single .pk3 from ZIP", () => {
    const zip = makeZip({ "mod.pk3": dummyData(200) });
    const files = findGameFilesInZip(zip);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("mod.pk3");
  });

  it("extracts multiple .wad files", () => {
    const zip = makeZip({
      "map01.wad": dummyData(100),
      "map02.wad": dummyData(200),
      "readme.txt": dummyData(50),
    });
    const files = findGameFilesInZip(zip);
    expect(files).toHaveLength(2);
    const names = files.map(f => f.name).sort();
    expect(names).toEqual(["map01.wad", "map02.wad"]);
  });

  it("ignores non-game files (.txt, .deh, .bex)", () => {
    const zip = makeZip({
      "readme.txt": dummyData(50),
      "patch.deh": dummyData(80),
      "compat.bex": dummyData(30),
      "level.wad": dummyData(100),
    });
    const files = findGameFilesInZip(zip);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("level.wad");
  });

  it("handles files in subdirectories (uses basename)", () => {
    const zip = makeZip({
      "mymod/maps/level.wad": dummyData(100),
      "mymod/readme.txt": dummyData(50),
    });
    const files = findGameFilesInZip(zip);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("level.wad");
  });

  it("case-insensitive matching (.WAD, .Wad)", () => {
    const zip = makeZip({
      "LEVEL.WAD": dummyData(100),
      "Mod.Pk3": dummyData(200),
    });
    const files = findGameFilesInZip(zip);
    expect(files).toHaveLength(2);
    const names = files.map(f => f.name).sort();
    expect(names).toEqual(["LEVEL.WAD", "Mod.Pk3"]);
  });

  it("throws when ZIP contains no game files", () => {
    const zip = makeZip({
      "readme.txt": dummyData(50),
      "screenshot.png": dummyData(1000),
    });
    expect(() => findGameFilesInZip(zip)).toThrow("No WAD or PK3 files found inside ZIP archive");
  });

  it("handles mixed .wad and .pk3 files", () => {
    const zip = makeZip({
      "level.wad": dummyData(100),
      "textures.pk3": dummyData(300),
    });
    const files = findGameFilesInZip(zip);
    expect(files).toHaveLength(2);
    const names = files.map(f => f.name).sort();
    expect(names).toEqual(["level.wad", "textures.pk3"]);
  });
});

describe("selectPrimaryGameFile", () => {
  it("single file: returns it as primary", () => {
    const files: GameFile[] = [{ name: "level.wad", data: dummyData(100) }];
    const result = selectPrimaryGameFile(files);
    expect(result.primary.name).toBe("level.wad");
    expect(result.additional).toHaveLength(0);
  });

  it("multiple files: largest is primary", () => {
    const files: GameFile[] = [
      { name: "small.wad", data: dummyData(100) },
      { name: "big.wad", data: dummyData(500) },
      { name: "medium.wad", data: dummyData(300) },
    ];
    const result = selectPrimaryGameFile(files);
    expect(result.primary.name).toBe("big.wad");
    expect(result.additional).toHaveLength(2);
  });

  it("additional files sorted by name for determinism", () => {
    const files: GameFile[] = [
      { name: "zebra.wad", data: dummyData(100) },
      { name: "main.wad", data: dummyData(500) },
      { name: "alpha.wad", data: dummyData(100) },
    ];
    const result = selectPrimaryGameFile(files);
    expect(result.primary.name).toBe("main.wad");
    expect(result.additional.map(f => f.name)).toEqual(["alpha.wad", "zebra.wad"]);
  });
});
