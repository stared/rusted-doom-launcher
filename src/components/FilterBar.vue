<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { Search, X, ChevronDown, RotateCcw } from "lucide-vue-next";

export type SortOption = {
  value: string;
  label: string;
};

export type FilterDef = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
};

const props = defineProps<{
  sortOptions: SortOption[];
  defaultSort: string;
  filters?: FilterDef[];
  itemCount: number;
  filteredCount: number;
}>();

const emit = defineEmits<{
  "update:search": [value: string];
  "update:sort": [value: string];
  "update:filters": [filters: Record<string, string>];
}>();

// State
const search = ref("");
const sort = ref(props.defaultSort);
const activeFilters = ref<Record<string, string>>({});
const searchFocused = ref(false);
const openDropdown = ref<string | null>(null);

// Emit changes
function updateSearch(value: string) {
  search.value = value;
  emit("update:search", value);
}

function updateSort(value: string) {
  sort.value = value;
  emit("update:sort", value);
  openDropdown.value = null;
}

function updateFilter(key: string, value: string) {
  if (value === "all") {
    const newFilters = { ...activeFilters.value };
    delete newFilters[key];
    activeFilters.value = newFilters;
  } else {
    activeFilters.value = { ...activeFilters.value, [key]: value };
  }
  emit("update:filters", { ...activeFilters.value });
  openDropdown.value = null;
}

function clearAll() {
  search.value = "";
  sort.value = props.defaultSort;
  activeFilters.value = {};
  emit("update:search", "");
  emit("update:sort", props.defaultSort);
  emit("update:filters", {});
}

// Keyboard shortcuts
function handleKeydown(e: KeyboardEvent) {
  if (e.key === "/" && !searchFocused.value && !(e.target as HTMLElement).matches("input, textarea")) {
    e.preventDefault();
    (document.querySelector("[data-filter-search]") as HTMLInputElement)?.focus();
  }
  if (e.key === "Escape") {
    if (openDropdown.value) {
      openDropdown.value = null;
    } else if (searchFocused.value) {
      (document.querySelector("[data-filter-search]") as HTMLInputElement)?.blur();
    }
  }
}

function handleClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest("[data-dropdown]")) {
    openDropdown.value = null;
  }
}

onMounted(() => {
  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("click", handleClickOutside);
});
onUnmounted(() => {
  document.removeEventListener("keydown", handleKeydown);
  document.removeEventListener("click", handleClickOutside);
});

// Check if any filters are active
const hasActiveFilters = computed(() =>
  search.value ||
  Object.keys(activeFilters.value).length > 0 ||
  sort.value !== props.defaultSort
);

// Get display label for a filter
function getFilterLabel(key: string): string {
  const value = activeFilters.value[key];
  if (!value) return props.filters?.find(f => f.key === key)?.label ?? key;
  const filter = props.filters?.find(f => f.key === key);
  const option = filter?.options.find(o => o.value === value);
  return option?.label ?? value;
}

function isFilterActive(key: string): boolean {
  return !!activeFilters.value[key];
}
</script>

<template>
  <div class="flex items-center gap-2 mb-5 pb-4 border-b border-zinc-800/60">
    <!-- Search -->
    <div class="relative w-56">
      <Search
        :size="14"
        class="absolute left-2.5 top-1/2 -translate-y-1/2 transition-colors"
        :class="searchFocused || search ? 'text-zinc-200' : 'text-zinc-400'"
      />
      <input
        :value="search"
        data-filter-search
        type="text"
        placeholder="Search name or vibe..."
        class="w-full h-8 pl-8 pr-7 text-xs bg-zinc-800/50 border border-zinc-600 rounded-md text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-500 transition-all"
        @input="updateSearch(($event.target as HTMLInputElement).value)"
        @focus="searchFocused = true"
        @blur="searchFocused = false"
      />
      <template v-if="!search && !searchFocused">
        <span class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 font-mono border border-zinc-600 rounded px-1">/</span>
      </template>
      <button
        v-else-if="search"
        class="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors"
        @click="updateSearch('')"
      >
        <X :size="12" />
      </button>
    </div>

    <!-- Filters -->
    <template v-if="filters?.length">
      <div
        v-for="filter in filters"
        :key="filter.key"
        class="relative"
        data-dropdown
      >
        <button
          class="h-8 px-2.5 text-xs rounded-md border transition-all flex items-center gap-1"
          :class="isFilterActive(filter.key)
            ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
            : 'border-zinc-600 bg-zinc-800/50 text-zinc-300 hover:text-zinc-100 hover:border-zinc-500'"
          @click="openDropdown = openDropdown === filter.key ? null : filter.key"
        >
          <span>{{ getFilterLabel(filter.key) }}</span>
          <ChevronDown :size="12" class="text-zinc-400" />
        </button>

        <div
          v-if="openDropdown === filter.key"
          class="absolute top-full left-0 mt-1 min-w-[120px] py-1 bg-zinc-900 border border-zinc-700 rounded-md shadow-xl z-50"
        >
          <button
            class="w-full px-3 py-1.5 text-xs text-left transition-colors"
            :class="!activeFilters[filter.key]
              ? 'bg-zinc-800 text-zinc-100'
              : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'"
            @click="updateFilter(filter.key, 'all')"
          >
            All
          </button>
          <button
            v-for="opt in filter.options"
            :key="opt.value"
            class="w-full px-3 py-1.5 text-xs text-left transition-colors"
            :class="activeFilters[filter.key] === opt.value
              ? 'bg-zinc-800 text-zinc-100'
              : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'"
            @click="updateFilter(filter.key, opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </template>

    <!-- Spacer -->
    <div class="flex-1" />

    <!-- Count -->
    <span class="text-[11px] text-zinc-400 tabular-nums mr-1">
      <template v-if="filteredCount !== itemCount">{{ filteredCount }} of </template>{{ itemCount }}
    </span>

    <!-- Reset (only if filters active) -->
    <button
      v-if="hasActiveFilters"
      class="h-8 px-2 text-zinc-600 hover:text-zinc-300 transition-colors"
      title="Reset filters"
      @click="clearAll"
    >
      <RotateCcw :size="14" />
    </button>

    <!-- Sort -->
    <div class="relative" data-dropdown>
      <button
        class="h-8 px-2.5 text-xs rounded-md border border-zinc-600 bg-zinc-800/50 text-zinc-300 hover:text-zinc-100 hover:border-zinc-500 transition-all flex items-center gap-1"
        @click="openDropdown = openDropdown === 'sort' ? null : 'sort'"
      >
        <span>{{ sortOptions.find(o => o.value === sort)?.label }}</span>
        <ChevronDown :size="12" class="text-zinc-400" />
      </button>

      <div
        v-if="openDropdown === 'sort'"
        class="absolute top-full right-0 mt-1 min-w-[120px] py-1 bg-zinc-900 border border-zinc-700 rounded-md shadow-xl z-50"
      >
        <button
          v-for="opt in sortOptions"
          :key="opt.value"
          class="w-full px-3 py-1.5 text-xs text-left transition-colors"
          :class="sort === opt.value
            ? 'bg-zinc-800 text-zinc-100'
            : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'"
          @click="updateSort(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>
  </div>
</template>
