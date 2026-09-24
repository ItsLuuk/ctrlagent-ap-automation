#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, process.env["FOUNDRY_DIST_DIR"] ?? "dist-tauri");
const entry = join(outDir, "index.html");
const manifestPath = join(outDir, "build-manifest.json");

if (!existsSync(entry)) {
  throw new Error("Tauri UI build is missing dist-tauri/index.html");
}
if (!existsSync(manifestPath)) {
  throw new Error("Tauri UI build is missing dist-tauri/build-manifest.json");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const expectedBuildId = process.env["FOUNDRY_BUILD_ID"];
if (expectedBuildId && manifest.buildId !== expectedBuildId) {
  throw new Error(
    `Tauri UI build ID mismatch: expected ${expectedBuildId}, received ${manifest.buildId}`,
  );
}

const html = readFileSync(entry, "utf8");
const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((value) => value.startsWith("./assets/") || value.startsWith("assets/"));

if (assets.length === 0) {
  throw new Error("Tauri UI entrypoint does not reference any built assets");
}

for (const asset of assets) {
  const path = join(outDir, asset.replace(/^\.\//, ""));
  if (!existsSync(path)) {
    throw new Error(`Tauri UI references missing asset: ${relative(root, path)}`);
  }
}

if (!assets.some((asset) => asset.endsWith(".js"))) {
  throw new Error("Tauri UI entrypoint does not reference a JavaScript bundle");
}
if (!assets.some((asset) => asset.endsWith(".css"))) {
  throw new Error("Tauri UI entrypoint does not reference a CSS bundle");
}

const jsAssets = assets
  .filter((asset) => asset.endsWith(".js"))
  .map((asset) => readFileSync(join(outDir, asset.replace(/^\.\//, "")), "utf8"));
if (!jsAssets.some((source) => source.includes("data-tauri-build-hash"))) {
  throw new Error("Tauri UI bundle is missing the visible build identity marker");
}
if (!jsAssets.some((source) => source.includes("data-tauri-build-id"))) {
  throw new Error("Tauri UI bundle is missing the native build identity handshake");
}

console.log(
  `Tauri UI verified: ${entry} (${assets.length} assets, build ${manifest.buildId})`,
);
