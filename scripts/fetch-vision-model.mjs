/**
 * Stages the bundled vision runtime so first run needs no separate install
 * (docs/POSITIONING.md task: kill the manual Ollama install).
 *
 * Produces two directories that tauri.conf.json ships via `bundle.resources`:
 *   src-tauri/resources/runtime/   official Ollama layout (ollama.exe + lib/)
 *   src-tauri/resources/models/    an OLLAMA_MODELS seed with exactly the
 *                                  models named in gemma.ts VISION_MODELS
 *                                  (their manifests + only the blobs those
 *                                  manifests reference).
 *
 * Local-first: copies from this machine's existing install and ~/.ollama
 * (offline — no GB-sized downloads); downloads the portable zip only when no
 * local runtime exists, and tells you to `ollama pull` when no local model
 * exists. After staging, the runtime is executed from the staging directory
 * (`ollama.exe --version`) as a layout sanity check.
 *
 * Usage: node scripts/fetch-vision-model.mjs [--dry-run] [--clean]
 *   --dry-run  print the full plan, change nothing
 *   --clean    wipe both staging directories first, then stage again
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import https from "node:https";
import { createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const RUNTIME_DIR = path.join(REPO_ROOT, "src-tauri", "resources", "runtime");
const MODELS_DIR = path.join(REPO_ROOT, "src-tauri", "resources", "models");
const OLLAMA_ZIP_URL =
  "https://github.com/ollama/ollama/releases/latest/download/ollama-windows-amd64.zip";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const CLEAN = args.has("--clean");

const GB = 1024 ** 3;
const fmt = (bytes) => `${(bytes / GB).toFixed(2)} GB`;
const log = (...m) => console.log(...m);
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

/** Model ids come from the app itself so this script cannot drift from it. */
function visionModels() {
  const source = readFileSync(path.join(REPO_ROOT, "src", "lib", "ai", "gemma.ts"), "utf8");
  const match = source.match(/VISION_MODELS\s*=\s*\[([^\]]+)\]/);
  if (!match) fail("VISION_MODELS not found in src/lib/ai/gemma.ts");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function dirSize(target) {
  let total = 0;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    total += entry.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}

function findIn(dir, filename) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findIn(full, filename);
      if (found) return found;
    } else if (entry.name === filename) {
      return full;
    }
  }
  return undefined;
}

function findLocalRuntime() {
  const candidates = [
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe"),
    "C:\\Program Files\\Ollama\\ollama.exe",
    "C:\\Program Files (x86)\\Ollama\\ollama.exe",
  ].filter(Boolean);
  return candidates.find((exe) => existsSync(exe));
}

/** Models root: new layout is ~/.ollama/models, old layout is ~/.ollama. */
function resolveModelsRoot(ollamaHome) {
  const candidates = [path.join(ollamaHome, "models"), ollamaHome];
  return candidates.find((c) => existsSync(path.join(c, "manifests"))) ?? candidates[0];
}

/** Manifest → blob digests. Current format: one JSON object (config +
 *  layers); older Ollama wrote newline-delimited JSON per layer. */
function manifestDigests(file) {
  const raw = readFileSync(file, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return [parsed.config?.digest, ...(parsed.layers ?? []).map((l) => l.digest)].filter(Boolean);
  } catch {
    return raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line).digest)
      .filter(Boolean);
  }
}

/** One model id = one manifest file = the blob digests that manifest lists. */
function modelPlan(modelsRoot) {
  const libraryRoot = path.join(modelsRoot, "manifests", "registry.ollama.ai", "library");
  return visionModels().map((id) => {
    const cut = id.lastIndexOf(":");
    const manifest = path.join(libraryRoot, id.slice(0, cut), id.slice(cut + 1));
    if (!existsSync(manifest)) return { id, manifest: undefined, digests: [] };
    const digests = manifestDigests(manifest).map((digest) =>
      digest.replace(/^sha256:/, "sha256-"),
    );
    return { id, manifest, digests: [...new Set(digests)] };
  });
}

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (redirects === 0) return reject(new Error("too many redirects"));
          res.resume();
          return resolve(download(res.headers.location, dest, redirects - 1));
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const file = createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(dest)));
      })
      .on("error", reject);
  });
}

async function main() {
  log("Foundry vision bundle staging", DRY_RUN ? "(dry run — nothing will change)" : "");
  log("");

  if (CLEAN && !DRY_RUN) {
    rmSync(RUNTIME_DIR, { recursive: true, force: true });
    rmSync(MODELS_DIR, { recursive: true, force: true });
    log("cleaned previous staging\n");
  }

  // ── runtime: official layout, exe-relative lib/ intact ────────────────
  const stagedExe = path.join(RUNTIME_DIR, "ollama.exe");
  const localExe = findLocalRuntime();
  if (existsSync(stagedExe)) {
    log(`runtime   ✓ already staged (${fmt(dirSize(RUNTIME_DIR))})`);
  } else if (DRY_RUN) {
    log(`runtime   plan: copy from ${localExe ?? `${OLLAMA_ZIP_URL} (download)`}`);
  } else if (process.platform !== "win32") {
    fail(
      "real staging is Windows-only for now (portable zip is Windows); use --dry-run elsewhere.",
    );
  } else if (localExe) {
    const sourceRoot = path.dirname(localExe);
    mkdirSync(RUNTIME_DIR, { recursive: true });
    // Serve needs only the exe and its lib/ tree — installer stubs, the tray
    // GUI and icons stay out of the bundle.
    const KEEP = new Set(["ollama.exe", "lib"]);
    for (const entry of readdirSync(sourceRoot)) {
      if (!KEEP.has(entry)) continue;
      cpSync(path.join(sourceRoot, entry), path.join(RUNTIME_DIR, entry), {
        recursive: true,
        force: true,
      });
      log(`runtime   ← ${entry}`);
    }
  } else {
    log("runtime   no local install found — downloading the portable zip (large)…");
    const zip = path.join(os.tmpdir(), "ollama-windows.zip");
    const extract = path.join(os.tmpdir(), "ollama-extract");
    await download(OLLAMA_ZIP_URL, zip);
    rmSync(extract, { recursive: true, force: true });
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Force -Path '${zip}' -DestinationPath '${extract}'`,
    ]);
    const exe = findIn(extract, "ollama.exe");
    if (!exe) fail("portable zip did not contain ollama.exe");
    cpSync(path.dirname(exe), RUNTIME_DIR, { recursive: true, force: true });
    log("runtime   ← portable zip extracted");
  }

  // ── model seed: manifests + exactly the blobs they reference ──────────
  const ollamaHome = process.env.OLLAMA_HOME ?? path.join(os.homedir(), ".ollama");
  const modelsRoot = resolveModelsRoot(ollamaHome);
  const plan = modelPlan(modelsRoot);
  const present = plan.filter((p) => p.manifest);
  const missing = plan.filter((p) => !p.manifest);

  if (present.length === 0) {
    log("models    none of the needed models exist locally:");
    for (const p of plan) log(`            ollama pull ${p.id}`);
    fail("pull the model(s) with your existing Ollama, then re-run this script");
  }

  const blobRoot = path.join(modelsRoot, "blobs");
  const blobs = [];
  let needed = 0;
  for (const p of present) {
    log(`models    ✓ ${p.id} (${p.digests.length} layers)`);
    for (const digest of p.digests) {
      const blob = path.join(blobRoot, digest);
      if (existsSync(blob)) {
        needed += statSync(blob).size;
        blobs.push(blob);
      } else {
        log(`            ! blob missing locally: ${digest}`);
      }
    }
  }
  for (const p of missing) log(`models    ✗ ${p.id} not present locally — skipped`);
  log(`models    need ${fmt(needed)} of blobs + ${present.length} manifest(s)`);

  if (DRY_RUN) {
    log(`models    plan: copy manifests + blobs into ${MODELS_DIR}`);
  } else {
    mkdirSync(path.join(MODELS_DIR, "blobs"), { recursive: true });
    for (const blob of blobs) {
      cpSync(blob, path.join(MODELS_DIR, "blobs", path.basename(blob)), { force: true });
    }
    for (const p of present) {
      const rel = path.relative(modelsRoot, p.manifest);
      const dest = path.join(MODELS_DIR, rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      cpSync(p.manifest, dest, { force: true });
    }
    log(`models    ✓ staged (${fmt(dirSize(MODELS_DIR))})`);
  }

  // ── sanity: the staged runtime must run from the staging layout ───────
  if (!DRY_RUN && existsSync(stagedExe)) {
    try {
      const out = execFileSync(stagedExe, ["--version"], { encoding: "utf8" }).trim();
      log(`runtime   ✓ runs from staging: ${out}`);
    } catch (error) {
      fail(`staged ollama.exe does not run from the staging layout: ${error.message}`);
    }
  }

  log("");
  log("next: `bun run bootstrap:tauri` / `bun run tauri:build` ships both directories via bundle.resources.");
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
