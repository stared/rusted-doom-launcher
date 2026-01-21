import { ref } from "vue";
import { homeDir } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile, mkdir, readDir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { Command } from "@tauri-apps/plugin-shell";
import { isNotFoundError } from "../lib/errors";

const APP_NAME = "rusted-doom-launcher";
const OLD_APP_NAME = "gzdoom";

interface Settings {
  gzdoomPath: string | null;  // null = not found
  libraryPath: string;        // Never null after init
}

const GZDOOM_LOCATIONS = [
  "/Applications/UZDoom.app/Contents/MacOS/uzdoom",
  "/Applications/GZDoom.app/Contents/MacOS/gzdoom",
  "/opt/homebrew/bin/uzdoom",
  "/opt/homebrew/bin/gzdoom",
  "/usr/local/bin/uzdoom",
  "/usr/local/bin/gzdoom",
];

const KNOWN_IWADS = [
  "doom.wad", "doom2.wad", "plutonia.wad", "tnt.wad",
  "heretic.wad", "hexen.wad", "freedoom1.wad", "freedoom2.wad",
  "nerve.wad", "masterlevels.wad"
];

interface MigratedIwad {
  name: string;
  from: string;  // source directory path
}

const settings = ref<Settings>({ gzdoomPath: null, libraryPath: "" });
const migratedIwads = ref<MigratedIwad[]>([]);
const initialized = ref(false);
const isFirstRun = ref(false);
let home: string | null = null;

async function getHome(): Promise<string> {
  if (!home) home = await homeDir();
  return home;
}

async function getSettingsPath(): Promise<string> {
  const h = await getHome();
  return `${h}/Library/Application Support/${APP_NAME}/launcher-settings.json`;
}

async function getOldSettingsPath(): Promise<string> {
  const h = await getHome();
  return `${h}/Library/Application Support/${OLD_APP_NAME}/launcher-settings.json`;
}

async function findGZDoom(): Promise<string | null> {
  const h = await getHome();
  const allLocations = [
    ...GZDOOM_LOCATIONS,
    `${h}/Applications/UZDoom.app/Contents/MacOS/uzdoom`,
    `${h}/Applications/GZDoom.app/Contents/MacOS/gzdoom`,
  ];
  for (const path of allLocations) {
    try {
      if (await exists(path)) return path;
    } catch {
      // Permission denied or not found - continue
    }
  }
  return null;
}

// Find IWAD files in a directory (returns empty array on error)
async function findIwadsInDir(dir: string): Promise<string[]> {
  try {
    const entries = await readDir(dir);
    return entries
      .map(e => e.name)
      .filter((name): name is string =>
        !!name && KNOWN_IWADS.includes(name.toLowerCase())
      );
  } catch {
    return [];
  }
}

// Copy a single file (readFile + writeFile)
async function copyFile(src: string, dest: string): Promise<void> {
  const data = await readFile(src);
  await writeFile(dest, data);
}

// Populate iwads/ folder from known locations (data folder root, GZDoom folder)
async function populateIwadsFolder(libraryPath: string): Promise<MigratedIwad[]> {
  const h = await getHome();
  const iwadsDir = `${libraryPath}/iwads`;

  // Skip if iwads/ already has content
  const existing = await findIwadsInDir(iwadsDir);
  if (existing.length > 0) return [];

  // Source locations (priority order)
  const sources = [
    libraryPath,                                    // Data folder root
    `${h}/Library/Application Support/gzdoom`,     // GZDoom folder
  ];

  await mkdir(iwadsDir, { recursive: true });

  const copied: MigratedIwad[] = [];
  const copiedNames: string[] = [];
  for (const srcDir of sources) {
    const iwads = await findIwadsInDir(srcDir);
    for (const name of iwads) {
      if (copiedNames.map(n => n.toLowerCase()).includes(name.toLowerCase())) continue;
      await copyFile(`${srcDir}/${name}`, `${iwadsDir}/${name}`);
      copied.push({ name, from: srcDir });
      copiedNames.push(name);
    }
  }

  return copied;
}

// INNOEXTRACT locations to try (in order)
const INNOEXTRACT_COMMANDS = [
  { name: "innoextract", cmd: "innoextract" },
  { name: "innoextract-homebrew-arm", cmd: "/opt/homebrew/bin/innoextract" },
  { name: "innoextract-homebrew-intel", cmd: "/usr/local/bin/innoextract" },
];

// Check if innoextract is available and return the command name to use
async function findInnoextract(): Promise<string | null> {
  for (const { name, cmd } of INNOEXTRACT_COMMANDS) {
    try {
      const result = await Command.create(name, ["--version"]).execute();
      if (result.code === 0) {
        console.log(`[findInnoextract] Found innoextract at: ${cmd}`);
        return name;
      }
    } catch {
      // Try next location
    }
  }
  return null;
}

interface GOGExtractResult {
  extractedWads: string[];
  errors: string[];
}

// Copyrighted WADs that must be extracted from owned installers
// (SIGIL is free and can be downloaded separately, extras.wad is KEX-only bloat)
const GOG_IWADS_TO_EXTRACT = [
  "doom.wad",
  "doom2.wad",
  "plutonia.wad",
  "tnt.wad",
  "nerve.wad",
  "masterlevels.wad",
];

// Extract IWADs from a GOG installer using innoextract
async function extractFromGOG(
  installerPath: string,
  iwadsDir: string,
  innoextractCmd: string
): Promise<GOGExtractResult> {
  // Ensure iwads directory exists
  await mkdir(iwadsDir, { recursive: true });

  // List contents first to verify it's a valid Inno Setup installer
  const listResult = await Command.create(innoextractCmd, ["--list", installerPath]).execute();
  if (listResult.code !== 0) {
    throw new Error(`Not a valid Inno Setup installer: ${listResult.stderr}`);
  }

  // Check if it contains WAD files
  const hasWads = listResult.stdout.toLowerCase().includes(".wad");
  if (!hasWads) {
    throw new Error("This installer doesn't appear to contain any WAD files");
  }

  // Extract only copyrighted IWADs (skip extras.wad and freely available sigil)
  const includeArgs = GOG_IWADS_TO_EXTRACT.flatMap(wad => ["--include", wad]);
  const extractResult = await Command.create(innoextractCmd, [
    ...includeArgs,
    "--output-dir", iwadsDir,
    "--flatten",
    installerPath
  ]).execute();

  const errors: string[] = [];
  if (extractResult.code !== 0) {
    errors.push(extractResult.stderr);
  }

  // Check which WADs were actually extracted by checking if files exist
  const extractedWads: string[] = [];
  for (const wad of GOG_IWADS_TO_EXTRACT) {
    try {
      if (await exists(`${iwadsDir}/${wad}`)) {
        extractedWads.push(wad);
      }
    } catch {
      // File doesn't exist
    }
  }

  return {
    extractedWads,
    errors,
  };
}

export function useSettings() {
  async function initSettings(): Promise<void> {
    if (initialized.value) return;

    const h = await getHome();
    const newConfigDir = `${h}/Library/Application Support/${APP_NAME}`;
    const newDefaultLibrary = newConfigDir;  // New users get new folder

    const newPath = await getSettingsPath();
    const oldPath = await getOldSettingsPath();
    let needsMigration = false;
    let settingsExist = false;

    // 1. Try new location first
    try {
      if (await exists(newPath)) {
        settingsExist = true;
        const content = await readTextFile(newPath);
        const parsed = JSON.parse(content);
        if (parsed.gzdoomPath) settings.value.gzdoomPath = parsed.gzdoomPath;
        if (parsed.libraryPath) settings.value.libraryPath = parsed.libraryPath;
      }
    } catch (e) {
      if (!isNotFoundError(e)) console.error("Failed to read new settings:", e);
    }

    // 2. Try old location (only if new didn't exist)
    if (!settingsExist) {
      try {
        if (await exists(oldPath)) {
          settingsExist = true;
          const content = await readTextFile(oldPath);
          const parsed = JSON.parse(content);
          if (parsed.gzdoomPath) settings.value.gzdoomPath = parsed.gzdoomPath;
          if (parsed.libraryPath) settings.value.libraryPath = parsed.libraryPath;
          needsMigration = true;
        }
      } catch (e) {
        if (!isNotFoundError(e)) console.error("Failed to read old settings:", e);
      }
    }

    isFirstRun.value = !settingsExist;
    let needsSave = needsMigration;

    // 3. Fill defaults for missing values
    if (!settings.value.libraryPath) {
      settings.value.libraryPath = newDefaultLibrary;
      needsSave = true;
    }
    if (!settings.value.gzdoomPath) {
      const found = await findGZDoom();
      if (found) {
        settings.value.gzdoomPath = found;
        needsSave = true;
      }
    }

    // 4. Save to new location (always save on first run to ensure settings persist)
    if (needsSave || !settingsExist) {
      try {
        if (!(await exists(newConfigDir))) {
          await mkdir(newConfigDir, { recursive: true });
        }
        await saveSettings();
        console.log("[initSettings] Saved settings to", newPath);
      } catch (e) {
        console.error("[initSettings] Failed to save settings:", e);
      }
    }

    // 5. Migrate IWADs to iwads/ subfolder
    try {
      const copied = await populateIwadsFolder(settings.value.libraryPath);
      migratedIwads.value = copied;
    } catch (e) {
      console.error("Failed to migrate IWADs:", e);
    }

    initialized.value = true;
  }

  async function saveSettings(): Promise<void> {
    const path = await getSettingsPath();
    await writeTextFile(path, JSON.stringify(settings.value, null, 2));
  }

  async function setGZDoomPath(path: string | null): Promise<void> {
    settings.value.gzdoomPath = path;
    await saveSettings();
  }

  async function setLibraryPath(path: string): Promise<void> {
    settings.value.libraryPath = path;
    await saveSettings();
  }

  async function importFromGOG(installerPath: string): Promise<GOGExtractResult> {
    const innoCmd = await findInnoextract();
    if (!innoCmd) {
      throw new Error("innoextract not found. Install it with: brew install innoextract");
    }
    const iwadsDir = `${settings.value.libraryPath}/iwads`;
    return extractFromGOG(installerPath, iwadsDir, innoCmd);
  }

  async function checkInnoextract(): Promise<boolean> {
    const cmd = await findInnoextract();
    return cmd !== null;
  }

  return {
    settings,
    isFirstRun,
    migratedIwads,
    initSettings,
    setGZDoomPath,
    setLibraryPath,
    checkInnoextract,
    importFromGOG,
  };
}
