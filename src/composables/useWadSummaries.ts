export interface WadSummary {
  slug: string;
  title: string;
  authors: string[];
  difficulty_rating: number | null;
  vibe: string | null;
  praise: string | null;
}

// Load summaries at build time
import summariesData from "../../scripts/data/all_wad_summaries.json";

const summariesMap = new Map<string, WadSummary>();

// Build map once
for (const summary of summariesData as WadSummary[]) {
  summariesMap.set(summary.slug, summary);
}

export function useWadSummaries() {
  function getSummary(slug: string): WadSummary | null {
    return summariesMap.get(slug) ?? null;
  }

  function getDifficulty(slug: string): number | null {
    return summariesMap.get(slug)?.difficulty_rating ?? null;
  }

  function getVibe(slug: string): string | null {
    return summariesMap.get(slug)?.vibe ?? null;
  }

  function getPraise(slug: string): string | null {
    return summariesMap.get(slug)?.praise ?? null;
  }

  return { getSummary, getDifficulty, getVibe, getPraise };
}
