export function kebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/** Allocate a "custom-<base>" slug that doesn't collide with `existing`,
 * suffixing -2, -3, … on conflicts. */
export function makeUniqueSlug(baseSlug: string, existing: Set<string>): string {
  let slug = `custom-${baseSlug}`;
  if (!existing.has(slug)) return slug;
  for (let i = 2; i < 100; i++) {
    const candidate = `custom-${baseSlug}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error(`Could not allocate slug for "${baseSlug}" — too many duplicates.`);
}
