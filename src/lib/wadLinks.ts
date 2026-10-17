import type { WadEntry } from "./schema";
import { isKnownWadUrl } from "./knownWadDomains";

export type WadLink = { label: string; url: string };
export type WadLinkOptions = { includeDownloadSource?: boolean };

/** Sites from older README templates that are known to have HTTPS endpoints. */
function preferredUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "");
    if (parsed.protocol === "http:" && ["esselfortium.net", "doomworld.com"].includes(host)) {
      parsed.protocol = "https:";
      return parsed.toString();
    }
  } catch {
    // Schema validation will reject malformed catalog URLs; notes may contain
    // arbitrary prose, so leave those alone here.
  }
  return url;
}

// Reference labels we surface from urls/notes, in display order.
const REF_ORDER = ["Doomworld", "Cacoward", "DoomWiki"] as const;

// Classify a reference URL by what it points at (path matters: Doomworld hosts
// forum threads, Cacoward writeups, and idgames pages under the same domain).
function refLabel(url: string): (typeof REF_ORDER)[number] | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const { host, pathname } = parsed;
  if (host.includes("doomwiki.org") && pathname.startsWith("/wiki/")) return "DoomWiki";
  if (host.includes("doomworld.com")) {
    if (/^\/(cacowards\/\d+|\d+years)/.test(pathname)) return "Cacoward";
    if (/^\/(forum\/topic|vb\/thread|vb\/showthread)/.test(pathname)) return "Doomworld";
  }
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
    return { label: "Archive", url: item ? `https://archive.org/details/${item[1]}` : dl.url };
  }
  if (host.includes("github.com")) return { label: "GitHub", url: dl.url };
  if (host.includes("moddb.com")) return { label: "ModDB", url: dl.url };
  if (host.includes("dsdarchive.com")) return { label: "DSDA", url: dl.url };
  return { label: "Download", url: dl.url };
}

// External links shown on a WAD card: Doomworld thread, DoomWiki page, and,
// where useful, the download source page. Views that already offer a download
// action can omit the latter to avoid opening an archive directly.
export function getWadLinks(wad: WadEntry, options: WadLinkOptions = {}): WadLink[] {
  const refs = new Map<string, string>();
  const allUrls = [...wad.urls, ...extractUrls(wad.notes)]
    .map(preferredUrl)
    .filter(url => wad._source !== "custom" || isKnownWadUrl(url));
  for (const url of allUrls) {
    const label = refLabel(url);
    if (label && !refs.has(label)) refs.set(label, url);
  }

  const links: WadLink[] = REF_ORDER.filter(label => refs.has(label)).map(label => ({
    label,
    url: refs.get(label)!,
  }));

  // Custom WAD READMEs often point to an author's own site. Keep those links
  // too; the curated labels above remain first for familiar community pages.
  const seen = new Set(links.map(link => link.url));
  for (const url of allUrls) {
    if (seen.has(url) || refLabel(url)) continue;
    const host = hostOf(url);
    if (!host) continue;
    links.push({ label: host.replace(/^www\./i, ""), url });
    seen.add(url);
  }

  if (options.includeDownloadSource !== false) {
    const source = sourceLink(wad);
    if (source && !seen.has(source.url)) {
      seen.add(source.url);
      links.push(source);
    }
  }

  return links;
}
