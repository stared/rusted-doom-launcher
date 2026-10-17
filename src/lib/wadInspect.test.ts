import { describe, expect, it } from "vitest";
import { parseInfoText } from "./wadInspect";

describe("parseInfoText", () => {
  it("extracts web links only from the idgames download section", () => {
    const info = parseInfoText(`
      Web sites: http://www.doomworld.com/, http://esselfortium.net/

      * Where to get the file that this text file describes *
      https://www.doomworld.com/idgames/levels/doom2/Ports/example.zip
      https://untrusted.example.org/releases/my-wad.zip

      * Miscellaneous *
      https://not-a-download.example.org/
    `);
    expect(info.urls).toEqual([
      "https://www.doomworld.com/idgames/levels/doom2/Ports/example.zip",
    ]);
  });
});
