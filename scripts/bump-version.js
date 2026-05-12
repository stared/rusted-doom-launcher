#!/usr/bin/env node
// Sync the project version across the files that have to carry it explicitly.
//
//   package.json          — source of truth
//   src-tauri/Cargo.toml  — must match (Cargo can't read it from elsewhere)
//   src-tauri/Cargo.lock  — must match (rebuilds otherwise warn)
//
// tauri.conf.json points at "../package.json" so it never drifts.
//
// Usage:  pnpm bump-version 0.3.1

import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[a-z0-9]+(\.\d+)?)?$/.test(version)) {
  console.error("usage: pnpm bump-version <semver>   e.g. 0.3.1 or 0.4.0-alpha.1");
  process.exit(1);
}

// 1. package.json
const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const prev = pkg.version;
pkg.version = version;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");

// 2. src-tauri/Cargo.toml — replace only the [package] version line, not deps.
const cargoRe = /^(\[package\][\s\S]*?\nversion = ")[^"]+(")/m;
const cargo = readFileSync("src-tauri/Cargo.toml", "utf-8");
if (!cargoRe.test(cargo)) {
  console.error("Could not find [package].version in src-tauri/Cargo.toml");
  process.exit(1);
}
writeFileSync("src-tauri/Cargo.toml", cargo.replace(cargoRe, `$1${version}$2`));

// 3. src-tauri/Cargo.lock — bump our own crate's entry only.
const lockRe = /(name = "rusted-doom-launcher"\nversion = ")[^"]+(")/;
const lockPath = "src-tauri/Cargo.lock";
const lock = readFileSync(lockPath, "utf-8");
if (!lockRe.test(lock)) {
  console.warn("Note: rusted-doom-launcher entry not found in Cargo.lock; run `cargo check` to regenerate.");
} else {
  writeFileSync(lockPath, lock.replace(lockRe, `$1${version}$2`));
}

console.log(`Bumped ${prev} -> ${version} in package.json, Cargo.toml, Cargo.lock.`);
console.log("tauri.conf.json reads from package.json so no change needed there.");
console.log("");
console.log("Next steps:");
console.log(`  git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock`);
console.log(`  git commit -m "release v${version}"`);
console.log(`  git tag v${version}`);
console.log(`  git push origin main v${version}`);
