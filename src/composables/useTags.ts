import { ref, computed, type Ref } from "vue";
import type { WadEntry } from "../lib/schema";

export interface TagInfo {
  name: string;
  count: number;
}

export function useTags(wadsRef?: Ref<WadEntry[]>) {
  const selectedTag = ref<string | null>(null);
  const selectedTab = ref<string>("all");

  const tagCounts = computed<Map<string, number>>(() => {
    const counts = new Map<string, number>();
    const list = wadsRef?.value ?? [];
    for (const wad of list) {
      if (!wad.tags) continue;
      for (const tag of wad.tags) {
        const trimmed = tag.trim();
        if (!trimmed) continue;
        counts.set(trimmed, (counts.get(trimmed) || 0) + 1);
      }
    }
    return counts;
  });

  const allTags = computed<TagInfo[]>(() => {
    const list: TagInfo[] = [];
    for (const [name, count] of tagCounts.value.entries()) {
      list.push({ name, count });
    }
    // Sort by count desc, then alphabetically
    return list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  });

  function selectTag(tag: string | null) {
    if (selectedTag.value === tag) {
      selectedTag.value = null; // Toggle off if already selected
    } else {
      selectedTag.value = tag;
    }
  }

  function selectTab(tab: string) {
    selectedTab.value = tab;
    // Reset tag when selecting standard tabs if appropriate, or keep active
  }

  function clearFilters() {
    selectedTag.value = null;
    selectedTab.value = "all";
  }

  return {
    selectedTag,
    selectedTab,
    tagCounts,
    allTags,
    selectTag,
    selectTab,
    clearFilters,
  };
}
