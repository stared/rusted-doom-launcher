// Structured editor model for a WadEntry's extraArgs. The entry stores a
// flat token list (one argv element per item); the editor shows it as rows —
// known flags with typed value slots, plus free-form custom rows. Round-trip
// safety matters: a bug here silently corrupts a user's saved launch args.

export type ValueKind = "none" | "skill" | "map" | "file" | "int" | "cvar";

export interface FlagDef {
  flag: string;
  description: string;
  valueKind: ValueKind;
}

export const KNOWN_FLAGS: FlagDef[] = [
  { flag: "-skill",      description: "set difficulty (1=ITYTD … 5=Nightmare!)", valueKind: "skill" },
  { flag: "-warp",       description: "jump to a specific map",                  valueKind: "map" },
  { flag: "-fast",       description: "fast monsters",                           valueKind: "none" },
  { flag: "-respawn",    description: "monsters respawn",                        valueKind: "none" },
  { flag: "-nomonsters", description: "empty maps",                              valueKind: "none" },
  { flag: "-file",       description: "load extra WAD/PK3 (dependencies)",       valueKind: "file" },
  { flag: "-loadgame",   description: "auto-load save slot (0–9)",               valueKind: "int" },
  { flag: "-nomusic",    description: "disable music",                           valueKind: "none" },
  { flag: "-nosound",    description: "disable all audio",                       valueKind: "none" },
  { flag: "-deathmatch", description: "enable deathmatch",                       valueKind: "none" },
  { flag: "-altdeath",   description: "alt deathmatch (items respawn)",          valueKind: "none" },
  { flag: "-timer",      description: "round time limit (minutes)",              valueKind: "int" },
  { flag: "+set",        description: "set any CVAR (advanced)",                 valueKind: "cvar" },
];

export const SKILL_OPTIONS = [
  { value: "1", label: "1 — I'm Too Young To Die" },
  { value: "2", label: "2 — Hey, Not Too Rough" },
  { value: "3", label: "3 — Hurt Me Plenty" },
  { value: "4", label: "4 — Ultra-Violence" },
  { value: "5", label: "5 — Nightmare!" },
];

export type ArgRow =
  | { kind: "known"; flag: string; values: string[] }
  | { kind: "custom"; raw: string };

export function flagDefFor(flag: string): FlagDef | undefined {
  return KNOWN_FLAGS.find(f => f.flag === flag);
}

export function defaultValuesFor(kind: ValueKind): string[] {
  switch (kind) {
    case "none":  return [];
    case "skill": return ["4"];
    case "map":   return [""];
    case "file":  return [""];
    case "int":   return [""];
    case "cvar":  return ["", ""];
  }
}

/** Parse a stored token list into editor rows. Unknown tokens are grouped
 * into a single custom row until the next known flag. */
export function rowsFromTokens(tokens: string[]): ArgRow[] {
  const out: ArgRow[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    const def = flagDefFor(tok);
    if (def) {
      const need = def.valueKind === "none" ? 0 : def.valueKind === "cvar" ? 2 : 1;
      const values: string[] = [];
      for (let j = 0; j < need && i + 1 + j < tokens.length; j++) values.push(tokens[i + 1 + j]);
      i += 1 + values.length;
      if (def.valueKind === "cvar") while (values.length < 2) values.push("");
      else if (need === 1 && values.length === 0) values.push("");
      out.push({ kind: "known", flag: tok, values });
    } else {
      const start = i;
      i++;
      while (i < tokens.length && !flagDefFor(tokens[i])) i++;
      out.push({ kind: "custom", raw: tokens.slice(start, i).join(" ") });
    }
  }
  return out;
}

/** Serialize editor rows back to a token list, dropping empty values. */
export function rowsToTokens(rows: ArgRow[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (row.kind === "known") {
      out.push(row.flag);
      out.push(...row.values.map(v => v.trim()).filter(v => v.length > 0));
    } else {
      out.push(...row.raw.split(/\s+/).filter(t => t.length > 0));
    }
  }
  return out;
}
