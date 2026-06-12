// GOG installer import: find innoextract, extract a picked installer into a
// temp dir, and collect the wanted WADs flat into the library's iwads/
// folder. Lives apart from useSettings — this is an importer, not a setting;
// it only reads the library path.

import { Command } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { getOs } from "../lib/platform";
import { GOG_WANTED_WADS } from "../lib/gogContent";
import { useLibrary } from "./useLibrary";

// innoextract locations to try (in order). Must stay in sync with the
// shell:allow-execute allowlist in src-tauri/capabilities/default.json —
// the `name` field is the capability identifier.
function getInnoextractCommands(): Array<{ name: string; cmd: string }> {
  const os = getOs();
  if (os === "mac") {
    return [
      { name: "innoextract", cmd: "innoextract" },
      { name: "innoextract-homebrew-arm", cmd: "/opt/homebrew/bin/innoextract" },
      { name: "innoextract-homebrew-intel", cmd: "/usr/local/bin/innoextract" },
    ];
  }
  if (os === "win") {
    return [
      { name: "innoextract", cmd: "innoextract" },
      { name: "innoextract-exe", cmd: "innoextract.exe" },
    ];
  }
  return [{ name: "innoextract", cmd: "innoextract" }];
}

export function innoextractInstallHint(): string {
  const os = getOs();
  if (os === "mac") return "brew install innoextract";
  if (os === "linux") return "sudo apt install innoextract (or your distro package manager)";
  return "install innoextract and add it to PATH";
}

// Check if innoextract is available and return the command name to use
async function findInnoextract(): Promise<string | null> {
  for (const { name, cmd } of getInnoextractCommands()) {
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

export interface GOGExtractResult {
  extractedWads: string[];
  errors: string[];
}

// Extract game WADs from a GOG installer using innoextract. Installers
// nest their WADs differently (doom2/DOOM2.WAD, DOOM_Data/StreamingAssets/
// doom.wad, flat at the root, …), so extraction goes to a temp dir and
// collect_known_wads flattens the wanted files into iwads/ regardless of
// the layout inside the installer.
async function extractFromGOG(
  installerPath: string,
  iwadsDir: string,
  innoextractCmd: string
): Promise<GOGExtractResult> {
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

  const tempDir = await invoke<string>("make_temp_dir");
  const includeArgs = GOG_WANTED_WADS.flatMap(wad => ["--include", wad]);
  const extractResult = await Command.create(innoextractCmd, [
    ...includeArgs,
    "--output-dir", tempDir,
    installerPath
  ]).execute();

  const errors: string[] = [];
  if (extractResult.code !== 0) {
    errors.push(extractResult.stderr);
  }

  const collected = await invoke<{ name: string; size: number }[]>("collect_known_wads", {
    srcDir: tempDir,
    destDir: iwadsDir,
    wanted: GOG_WANTED_WADS,
  });

  return {
    extractedWads: collected.map(c => c.name),
    errors,
  };
}

export function useGogImport() {
  const { iwadsDir } = useLibrary();

  async function checkInnoextract(): Promise<boolean> {
    return (await findInnoextract()) !== null;
  }

  async function importFromGOG(installerPath: string): Promise<GOGExtractResult> {
    const innoCmd = await findInnoextract();
    if (!innoCmd) {
      throw new Error(`innoextract not found. Install it with: ${innoextractInstallHint()}`);
    }
    return extractFromGOG(installerPath, iwadsDir(), innoCmd);
  }

  return { checkInnoextract, importFromGOG, innoextractInstallHint };
}
