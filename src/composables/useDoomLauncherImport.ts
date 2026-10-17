import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useLibrary } from "./useLibrary";

export interface DoomLauncherGamePreview {
  id: number;
  title: string;
  filename: string;
  author: string;
  release_date?: string;
  iwad: string;
  tags: string[];
  saves_count: number;
  stats_count: number;
  minutes_played: number;
  last_played?: string;
  comments: string;
  description: string;
  rating?: number;
  extra_params: string;
  map_count?: number;
}

export interface DoomLauncherInspection {
  db_path: string;
  detected_root: string;
  detected_save_root: string;
  total_games: number;
  total_tags: number;
  tags: string[];
  games_preview: DoomLauncherGamePreview[];
}

export interface DoomLauncherSaveFile {
  file_id: number;
  file_name: string;
  original_file_name: string;
  resolved_path?: string;
}

export interface DoomLauncherStatItem {
  stat_id: number;
  map_name: string;
  kill_count: number;
  total_kills: number;
  secret_count: number;
  total_secrets: number;
  item_count: number;
  total_items: number;
  level_time: number;
  record_time: string;
  skill?: number;
}

export interface DoomLauncherImportItem {
  game_file_id: number;
  title: string;
  slug: string;
  filename: string;
  original_db_path: string;
  resolved_path?: string;
  author: string;
  year: number;
  description: string;
  comments: string;
  iwad: string;
  game_type: string;
  tags: string[];
  rating?: number;
  extra_args: string[];
  minutes_played: number;
  last_played?: string;
  save_files: DoomLauncherSaveFile[];
  stats: DoomLauncherStatItem[];
}

export interface PathVerifyResult {
  total: number;
  matched: number;
  missing: string[];
  ready_items: DoomLauncherImportItem[];
}

export interface DoomLauncherImportOptions {
  db_path: string;
  source_root: string;
  target_root: string;
  selected_game_ids?: number[];
  import_metadata: boolean;
  import_tags: boolean;
  import_saves: boolean;
  import_stats: boolean;
  copy_to_library: boolean;
  overwrite_existing: boolean;
  /** GameFileID -> bundled catalog slug, for exact matches resolved by the UI. */
  catalog_matches?: Record<number, string>;
}

export interface ImportSummary {
  imported_games: number;
  imported_tags: number;
  imported_saves: number;
  imported_stats: number;
  skipped: number;
}

export function useDoomLauncherImport() {
  const { base } = useLibrary();

  const inspecting = ref(false);
  const verifying = ref(false);
  const importing = ref(false);
  const error = ref<string | null>(null);

  const inspection = ref<DoomLauncherInspection | null>(null);
  const verification = ref<PathVerifyResult | null>(null);
  const importSummary = ref<ImportSummary | null>(null);

  async function inspectDatabase(dbPath: string): Promise<DoomLauncherInspection | null> {
    inspecting.value = true;
    error.value = null;
    try {
      const res = await invoke<DoomLauncherInspection>("inspect_doom_launcher_db", { dbPath });
      inspection.value = res;
      return res;
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      inspecting.value = false;
    }
  }

  async function verifyFiles(
    dbPath: string,
    sourceRoot: string,
    targetRoot: string
  ): Promise<PathVerifyResult | null> {
    verifying.value = true;
    error.value = null;
    try {
      const res = await invoke<PathVerifyResult>("verify_doom_launcher_files", {
        dbPath,
        sourceRoot,
        targetRoot,
      });
      verification.value = res;
      return res;
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      verifying.value = false;
    }
  }

  async function executeImport(
    options: DoomLauncherImportOptions
  ): Promise<ImportSummary | null> {
    importing.value = true;
    error.value = null;
    try {
      const res = await invoke<ImportSummary>("execute_doom_launcher_import", {
        libraryPath: base(),
        options,
      });
      importSummary.value = res;
      return res;
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      importing.value = false;
    }
  }

  function reset() {
    inspection.value = null;
    verification.value = null;
    importSummary.value = null;
    error.value = null;
    inspecting.value = false;
    verifying.value = false;
    importing.value = false;
  }

  return {
    inspecting,
    verifying,
    importing,
    error,
    inspection,
    verification,
    importSummary,
    inspectDatabase,
    verifyFiles,
    executeImport,
    reset,
  };
}
