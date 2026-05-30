import type { WadEntry } from "./schema";

export type WadLink = { label: string; url: string };

// Reference labels we surface from urls/notes, in display order.
const REF_ORDER = ["Doomworld", "DoomWiki"] as const;

function refLabelForHost(host: string): (typeof REF_ORDER)[number] | null {
  if (host.includes("doomworld.com")) return "Doomworld";
  if (host.includes("doomwiki.org")) return "DoomWiki";
  return null;
}

// Pull bare http(s) URLs out of free text (e.g. markdown notes like "[Forum](https://...)").
function extractUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s)]+/g) ?? [];
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// The page you'd visit to download a WAD, derived from its primary download.
// idgames mirrors → the canonical (browsable) Doomworld idgames page; other
// hosts → their own page, with a recognisable label.
function sourceLink(wad: WadEntry): WadLink | null {
  const dl = wad.downloads[0];
  if (!dl) return null;
  const host = hostOf(dl.url);
  if (!host) return null;

  // Any idgames-tree URL (any mirror) maps to the Doomworld idgames page.
  const idgames = dl.url.match(/\/idgames\/(.+)$/);
  if (idgames) {
    const path = idgames[1].replace(/\.[a-z0-9]+$/i, "");
    return { label: "idgames", url: `https://www.doomworld.com/idgames/${path}` };
  }
  if (host.includes("archive.org")) {
    const item = dl.url.match(/archive\.org\/download\/([^/]+)/);
    return { label: "Archive.org", url: item ? `https://archive.org/details/${item[1]}` : dl.url };
  }
  if (host.includes("github.com")) return { label: "GitHub", url: dl.url };
  if (host.includes("moddb.com")) return { label: "ModDB", url: dl.url };
  if (host.includes("dsdarchive.com")) return { label: "DSDA", url: dl.url };
  return { label: "Download", url: dl.url };
}

// External links shown on a WAD card: Doomworld thread, DoomWiki page, and the
// download source page. Returns an empty array when none apply (card unchanged).
export function getWadLinks(wad: WadEntry): WadLink[] {
  const refs = new Map<string, string>();
  for (const url of [...wad.urls, ...extractUrls(wad.notes)]) {
    const host = hostOf(url);
    if (!host) continue;
    const label = refLabelForHost(host);
    if (label && !refs.has(label)) refs.set(label, url);
  }

  const links: WadLink[] = REF_ORDER.filter(label => refs.has(label)).map(label => ({
    label,
    url: refs.get(label)!,
  }));

  const source = sourceLink(wad);
  if (source) links.push(source);

  return links;
}
