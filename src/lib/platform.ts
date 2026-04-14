export type OsName = "mac" | "win" | "linux";

export function getOs(): OsName {
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad|iPod/i.test(ua)) return "mac";
  if (/Win/i.test(ua)) return "win";
  return "linux";
}

export function shortenPath(path: string | null): string {
  if (!path) return "Not found";
  const unixHome = path.match(/^\/(?:Users|home)\/[^/]+/)?.[0];
  if (unixHome) return path.replace(unixHome, "~");
  const winHome = path.match(/^[A-Za-z]:\\Users\\[^\\]+/)?.[0];
  if (winHome) return path.replace(winHome, "~");
  return path;
}
