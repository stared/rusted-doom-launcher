import { describe, it, expect } from "vitest";
import {
  STEAM_WANTED_WADS,
  STEAM_WAD_DETAILS,
  getWadFriendlyName,
} from "./steamContent";

describe("steamContent", () => {
  it("includes all base IWADs", () => {
    expect(STEAM_WANTED_WADS).toContain("doom.wad");
    expect(STEAM_WANTED_WADS).toContain("doom2.wad");
    expect(STEAM_WANTED_WADS).toContain("plutonia.wad");
    expect(STEAM_WANTED_WADS).toContain("tnt.wad");
  });

  it("includes 2024 rerelease and official expansions", () => {
    expect(STEAM_WANTED_WADS).toContain("id1.wad");
    expect(STEAM_WANTED_WADS).toContain("id24res.wad");
    expect(STEAM_WANTED_WADS).toContain("id1-res.wad");
    expect(STEAM_WANTED_WADS).toContain("id1-weap.wad");
    expect(STEAM_WANTED_WADS).toContain("nerve.wad");
    expect(STEAM_WANTED_WADS).toContain("masterlevels.wad");
    expect(STEAM_WANTED_WADS).toContain("sigil.wad");
    expect(STEAM_WANTED_WADS).toContain("sigil2.wad");
    expect(STEAM_WAD_DETAILS["id1.wad"].category).toBe("expansion");
  });

  it("returns human friendly titles for known WADs", () => {
    expect(getWadFriendlyName("doom.wad")).toBe("The Ultimate Doom");
    expect(getWadFriendlyName("DOOM2.WAD")).toBe("DOOM II: Hell on Earth");
    expect(getWadFriendlyName("id1.wad")).toBe("Legacy of Rust");
    expect(getWadFriendlyName("id24res.wad")).toBe("ID24 Resources");
  });

  it("falls back to filename for unknown WADs", () => {
    expect(getWadFriendlyName("custom_map.wad")).toBe("custom_map.wad");
  });
});
