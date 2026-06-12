import { invoke } from "@tauri-apps/api/core";
import { stat, exists } from "@tauri-apps/plugin-fs";
import { WadEntrySchema, type WadEntry, type Iwad } from "../lib/schema";
import { useLibrary } from "./useLibrary";
import { useDownload } from "./useDownload";
import { useCustomWads } from "./useCustomWads";
import { inspectGameFile, parseInfoText, type FileInspection, type Titlepic } from "../lib/wadInspect";
import { findGameFileEntries, selectPrimaryGameFile, type ZipEntryInfo } from "../lib/zipExtract";
import { basenameOf, stripExtension } from "../lib/platform";
import { kebab, makeUniqueSlug } from "../lib/slug";

/** Inner game file stream-extracted from a picked .zip at pick time. */
export interface PickedZip {
  innerName: string;
  tempPath: string;
  size: number;
}

/** Result of inspecting a user-picked file: what to import plus best-effort
 * metadata for pre-filling the form (empty string / 0 when unknown). */
export interface InspectedPick {
  pickedZip: PickedZip | null;
  inspection: FileInspection;
  title: string;
  author: string;
  year: number;
}

export interface CustomEntryFields {
  title: string;
  author: string;
  year: number;
  iwad: Iwad;
  type: WadEntry["type"];
  extraArgs: string[];
}

function validateEntry(entry: WadEntry, context: string): WadEntry {
  const parsed = WadEntrySchema.safeParse(entry);
  if (!parsed.success) {
    console.error(`[useCustomImport] ${context} failed schema:`, parsed.error.format());
    throw new Error(`Internal error: ${context} doesn't match schema. See console.`);
  }
  return parsed.data;
}

/** Encode a decoded TITLEPIC as a data: URL for the entry thumbnail. The card
 * renders <img :src> directly — no asset-protocol or CSP setup needed. Cost:
 * a ~70 KB PNG becomes ~93 KB base64 inside custom-wads.json. Acceptable for
 * the typical few-entries case. */
function titlepicToDataUrl(titlepic: Titlepic | null): string {
  if (!titlepic) return "";
  const bytes = titlepic.png;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:image/png;base64,${btoa(bin)}`;
}

export function useCustomImport() {
  const { base, wadFile } = useLibrary();
  const { registerSyntheticDownload } = useDownload();
  const { customWads, addCustomWad, updateCustomWad } = useCustomWads();

  /**
   * Inspect a picked .wad/.pk3/.zip. For a .zip the inner game file is
   * stream-extracted to a temp file so the same on-disk inspection path
   * covers all picks. Throws on IWADs and unreadable files.
   */
  async function inspectPick(picked: string): Promise<InspectedPick> {
    const sourceBasename = basenameOf(picked);
    const sourceExt = sourceBasename.toLowerCase().split(".").pop() ?? "";

    let innerName = sourceBasename;
    let innerPath = picked;
    let pickedZip: PickedZip | null = null;
    let zipSidecarText = "";

    if (sourceExt === "zip") {
      const entries = await invoke<ZipEntryInfo[]>("list_zip_entries", { zipPath: picked });
      const gameFiles = findGameFileEntries(entries);  // throws if none
      const { primary } = selectPrimaryGameFile(gameFiles);
      innerName = primary.name;
      innerPath = await invoke<string>("extract_zip_entry_to_temp", {
        zipPath: picked,
        entryPath: primary.path,
      });
      pickedZip = { innerName, tempPath: innerPath, size: primary.size };

      // Read any .txt carrying idgames-template fields (Title:/Authors:).
      // We scan all entries since "Beautiful Doom" style PK3s nest the .txt
      // inside a single folder.
      for (const entry of entries) {
        if (!entry.path.toLowerCase().endsWith(".txt")) continue;
        const buf = await invoke<ArrayBuffer>("read_zip_entry", {
          zipPath: picked,
          entryPath: entry.path,
        });
        const text = new TextDecoder().decode(new Uint8Array(buf));
        if (/^\s*Title\s*:/im.test(text) || /^\s*Authors?\s*:/im.test(text)) {
          zipSidecarText = text;
          break;
        }
      }
    }

    const inspection = await inspectGameFile(innerName, innerPath);
    if (inspection.isIwad) {
      throw new Error("This file is an IWAD (base game). Base games are managed in Settings, not added as custom mods.");
    }

    // Idgames-format metadata sources, in priority order:
    //   1. .txt at the root of the picked .zip (richest, 100% on idgames bundles)
    //   2. sibling .txt next to a bare .wad/.pk3 (when user kept the .txt after extracting)
    //   3. .txt at root of a .pk3 (Beautiful Doom etc.)
    //   The inspector already covers (3) inside inspection.author/inspection.year.
    let title = "";
    let author = inspection.author;
    let year = inspection.year;

    if (zipSidecarText) {
      const parsed = parseInfoText(zipSidecarText);
      if (parsed.author) author = parsed.author;
      if (parsed.year) year = parsed.year;
      if (parsed.title) title = parsed.title;
    } else if (sourceExt !== "zip") {
      try {
        const sibling = await invoke<string>("read_sibling_text", { sourcePath: picked });
        if (sibling) {
          const parsed = parseInfoText(sibling);
          if (!author && parsed.author) author = parsed.author;
          if (!year && parsed.year) year = parsed.year;
          if (parsed.title) title = parsed.title;
        }
      } catch (e) {
        console.warn("[useCustomImport] sibling .txt scan failed:", e);
      }
    }

    if (!title) title = inspection.firstMapTitle || stripExtension(innerName);

    return { pickedZip, inspection, title, author, year };
  }

  /**
   * Import a picked file as a new custom entry. Three modes, branching on
   * copyToLibrary + zip-pick:
   *   A) copy=on,  bare .wad/.pk3 → fs::copy via import_custom_wad
   *   B) copy=on,  .zip          → copy the pick-time temp extraction
   *   C) copy=off, bare or zip   → reference the picked path in place;
   *                                 nothing lands in the library folder.
   *
   * When copy=off the launcher uses externalPath on the synthetic download
   * record and never deletes the file on Remove. The picked .zip is fine
   * to pass to GZDoom as -file (GZDoom can load archives directly).
   */
  async function importCustomWad(opts: {
    sourcePath: string;
    pickedZip: PickedZip | null;
    copyToLibrary: boolean;
    fields: CustomEntryFields;
    titlepic: Titlepic | null;
  }): Promise<WadEntry> {
    const { sourcePath, pickedZip, copyToLibrary, fields, titlepic } = opts;

    const libraryRoot = base();
    if (!libraryRoot) {
      throw new Error("Library path is not set. Configure it in Settings first.");
    }

    const sourceFilename = pickedZip ? pickedZip.innerName : basenameOf(sourcePath);
    const targetPath = wadFile(sourceFilename);
    const sourceIsTarget = !pickedZip && sourcePath === targetPath;

    let actualSize: number;
    let externalPath = "";
    let externalFilename = "";

    if (!copyToLibrary) {
      // External reference: pick the path GZDoom will actually launch with.
      // For a .zip pick we point at the zip itself (no inner extraction);
      // for a bare .wad/.pk3 we point at it directly.
      externalPath = sourcePath;
      externalFilename = basenameOf(sourcePath);
      try {
        const st = await stat(sourcePath);
        actualSize = st.size;
      } catch {
        actualSize = pickedZip?.size ?? 0;
      }
    } else if (pickedZip) {
      if (!sourceIsTarget && await exists(targetPath)) {
        throw new Error(`A file named "${sourceFilename}" already exists in the library. Rename it or remove it before importing.`);
      }
      actualSize = await invoke<number>("import_custom_wad", {
        sourcePath: pickedZip.tempPath,
        targetPath,
      });
    } else if (sourceIsTarget) {
      const st = await stat(targetPath);
      actualSize = st.size;
    } else {
      if (await exists(targetPath)) {
        throw new Error(`A file named "${sourceFilename}" already exists in the library. Rename it or remove it before importing.`);
      }
      actualSize = await invoke<number>("import_custom_wad", {
        sourcePath,
        targetPath,
      });
    }

    const baseSlug = kebab(fields.title.trim());
    if (baseSlug.length === 0) throw new Error("Title must contain at least one letter or number.");
    const slug = makeUniqueSlug(baseSlug, new Set(customWads.value.map(w => w.slug)));

    const entry = validateEntry({
      slug,
      title: fields.title.trim(),
      authors: [{ name: fields.author.trim() || "User import" }],
      year: fields.year,
      description: "User-imported mod.",
      iwad: fields.iwad,
      type: fields.type,
      sourcePort: "gzdoom",
      requires: [],
      downloads: [],
      thumbnail: titlepicToDataUrl(titlepic),
      screenshots: [],
      youtubeVideos: [],
      awards: [],
      tags: [],
      difficulty: "unknown",
      urls: [],
      notes: "",
      extraArgs: fields.extraArgs,
      _schemaVersion: 1,
      _source: "custom",
    }, "imported entry");

    const recordedFilename = externalFilename || sourceFilename;
    await registerSyntheticDownload(slug, {
      filename: recordedFilename,
      wadFilename: recordedFilename,
      size: actualSize,
      externalPath,
    });
    await addCustomWad(entry);

    return entry;
  }

  /** Edit path: keep slug + file + _source; refresh user-editable fields. */
  async function updateCustomEntry(existing: WadEntry, fields: CustomEntryFields): Promise<WadEntry> {
    const entry = validateEntry({
      ...existing,
      title: fields.title.trim(),
      authors: [{ name: fields.author.trim() || "User import" }],
      year: fields.year,
      iwad: fields.iwad,
      type: fields.type,
      extraArgs: fields.extraArgs,
    }, "edited entry");
    await updateCustomWad(entry);
    return entry;
  }

  return { inspectPick, importCustomWad, updateCustomEntry };
}
