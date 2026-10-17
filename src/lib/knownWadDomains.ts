/** Trusted public sources worth surfacing from an uncurated custom-WAD README. */
const KNOWN_WAD_DOMAINS = [
  "doomworld.com",
  "doomwiki.org",
  "github.com",
  "gitlab.com",
  "moddb.com",
  "archive.org",
  "dsdarchive.com",
  "doomshack.org",
  "zdoom.org",
  "zandronum.com",
];

export function isKnownWadUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return KNOWN_WAD_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
