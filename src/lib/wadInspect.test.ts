import { describe, it, expect } from "vitest";
import { parseInfoText } from "./wadInspect";

describe("parseInfoText", () => {
  it("parses standard idgames template", () => {
    const text = `
===========================================================================
Title                   : Eviternity
Filename                : eviternity.wad
Release date            : 10.02.2019
Author                  : Dragonfly
Email Address           : dragonfly@example.com
Other Files By Author   : Skulldash
Misc. Author Info       : Level designer
Description             : A 32-level megawad
===========================================================================
`;
    const result = parseInfoText(text);
    expect(result.title).toBe("Eviternity");
    expect(result.author).toBe("Dragonfly");
    expect(result.year).toBe(2019);
  });

  it("handles 'Authors' plural and ISO date", () => {
    const text = `
Title       : Beautiful Doom
Authors     : Jekyll Grim Payne, Gifty
Release date: 2020-07-03
`;
    const result = parseInfoText(text);
    expect(result.title).toBe("Beautiful Doom");
    expect(result.author).toBe("Jekyll Grim Payne, Gifty");
    expect(result.year).toBe(2020);
  });

  it("extracts 4-digit year from 90s releases", () => {
    const text = `
Title: Alien Vendetta
Author: Anders Johnsen et al.
Date: December 1999
`;
    const result = parseInfoText(text);
    expect(result.title).toBe("Alien Vendetta");
    expect(result.author).toBe("Anders Johnsen et al.");
    expect(result.year).toBe(1999);
  });

  it("returns safe defaults for unpopulated text", () => {
    const text = `Random text without idgames fields`;
    const result = parseInfoText(text);
    expect(result.title).toBe("");
    expect(result.author).toBe("");
    expect(result.year).toBe(0);
  });
});

