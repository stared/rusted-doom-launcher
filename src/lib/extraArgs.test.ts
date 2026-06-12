import { describe, it, expect } from "vitest";
import { rowsFromTokens, rowsToTokens, type ArgRow } from "./extraArgs";

describe("rowsFromTokens", () => {
  it("parses a valueless flag", () => {
    expect(rowsFromTokens(["-fast"])).toEqual([
      { kind: "known", flag: "-fast", values: [] },
    ]);
  });

  it("parses a single-value flag with its value", () => {
    expect(rowsFromTokens(["-warp", "MAP05"])).toEqual([
      { kind: "known", flag: "-warp", values: ["MAP05"] },
    ]);
  });

  it("pads a single-value flag missing its value", () => {
    expect(rowsFromTokens(["-warp"])).toEqual([
      { kind: "known", flag: "-warp", values: [""] },
    ]);
  });

  it("parses a cvar flag taking two values", () => {
    expect(rowsFromTokens(["+set", "sv_cheats", "1"])).toEqual([
      { kind: "known", flag: "+set", values: ["sv_cheats", "1"] },
    ]);
  });

  it("pads a cvar flag to two values when tokens run out", () => {
    expect(rowsFromTokens(["+set", "sv_cheats"])).toEqual([
      { kind: "known", flag: "+set", values: ["sv_cheats", ""] },
    ]);
  });

  it("groups consecutive unknown tokens into one custom row", () => {
    expect(rowsFromTokens(["+sv_friction", "0.5", "-fast"])).toEqual([
      { kind: "custom", raw: "+sv_friction 0.5" },
      { kind: "known", flag: "-fast", values: [] },
    ]);
  });

  it("does not swallow a known flag into a preceding value slot's row", () => {
    // -fast takes no value, so -nomonsters must become its own row.
    expect(rowsFromTokens(["-fast", "-nomonsters"])).toEqual([
      { kind: "known", flag: "-fast", values: [] },
      { kind: "known", flag: "-nomonsters", values: [] },
    ]);
  });
});

describe("rowsToTokens", () => {
  it("emits flag then non-empty trimmed values", () => {
    const rows: ArgRow[] = [
      { kind: "known", flag: "-skill", values: [" 4 "] },
      { kind: "known", flag: "-warp", values: [""] },
      { kind: "custom", raw: "  +sv_friction   0.5 " },
    ];
    expect(rowsToTokens(rows)).toEqual(["-skill", "4", "-warp", "+sv_friction", "0.5"]);
  });
});

describe("round trip", () => {
  it.each([
    [["-skill", "4"]],
    [["-warp", "MAP05", "-fast", "-nomonsters"]],
    [["+set", "sv_cheats", "1", "-timer", "10"]],
    [["-file", "/path/to/extra.wad"]],
    [["+custom_thing", "abc", "-respawn"]],
  ])("tokens -> rows -> tokens preserves %j", (tokens) => {
    expect(rowsToTokens(rowsFromTokens(tokens))).toEqual(tokens);
  });
});
