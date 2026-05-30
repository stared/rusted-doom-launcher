import type { WadEntry } from "./schema";

export type WadLink = { label: string; url: string };

// Labels we surface, in display order. First matching URL per label wins.
const LINK_ORDER = ["Doomworld", "DoomWiki"] as const;

function labelForHost(host: string): (typeof LINK_ORDER)[number] | null {
  if (host.includes("doomworld.com")) return "Doomworld";
  if (host.includes("doomwiki.org")) return "DoomWiki";
  return null;
}

// Pull bare http(s) URLs out of free text (e.g. markdown notes like "[Forum](https://...)").
function extractUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s)]+/g) ?? [];
}

// External reference links (Doomworld thread, DoomWiki page) for a WAD, derived
// from its `urls` list and any links embedded in `notes`. Returns one per label.
export function getWadLinks(wad: WadEntry): WadLink[] {
  const found = new Map<string, string>();
  for (const url of [...wad.urls, ...extractUrls(wad.notes)]) {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      continue;
    }
    const label = labelForHost(host);
    if (label && !found.has(label)) found.set(label, url);
  }
  return LINK_ORDER.filter(label => found.has(label)).map(label => ({
    label,
    url: found.get(label)!,
  }));
}
