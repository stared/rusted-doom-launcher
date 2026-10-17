import type { WadEntry } from "./schema";

function key(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Return a catalog entry only for an unambiguous exact title or archive-name
 * match. DoomLauncher metadata is user-authored, so fuzzy matching could
 * accidentally attach saves to the wrong WAD.
 */
export function findCatalogMatch(
  catalog: readonly WadEntry[],
  title: string,
  filename: string,
): WadEntry | null {
  const titleKey = key(title);
  const filenameKey = key(filename.split(/[\\/]/).pop() ?? "");
  const matches = catalog.filter(wad =>
    key(wad.title) === titleKey || wad.downloads.some(download => key(download.filename) === filenameKey),
  );
  return matches.length === 1 ? matches[0] : null;
}
