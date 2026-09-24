/**
 * Build the Foundry Windows installer as a small NSIS setup executable plus an
 * offline Foundry-AI-Payload directory.
 *
 * NSIS cannot embed the model blobs in a single installer: the staged Ollama
 * runtime and models are larger than NSIS's 2 GiB installer limit. The setup
 * executable receives a small payload installer script and the post-install
 * hook invokes it with the sidecar directory next to the setup executable.
 */
import { createHash } from "node:crypto";
import { constants, existsSync, statSync } from "node:fs";
import { access, cp, mkdir, open, readdir, rm, stat, writeFile } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const RESOURCE_ROOT = path.join(REPO_ROOT, "src-tauri", "resources");
const STAGING_ROOT = path.join(REPO_ROOT, ".tauri-payload");
// Keep Cargo's default target directory. The desktop shortcut launches
// src-tauri/target/<triple>/release/app.exe; an isolated app-only target would
// build a current executable that the existing shortcut never sees.
const TARGET_DIR = path.join(REPO_ROOT, "src-tauri", "target");
const PAYLOAD_NAME = "Foundry-AI-Payload";
const PAYLOAD_DIR = path.join(STAGING_ROOT, PAYLOAD_NAME);
const DESKTOP_BUILD_ROOT = path.join(REPO_ROOT, ".desktop-builds");
const CHUNK_SIZE = 1_500_000_000;
const COPY_BUFFER_SIZE = 8 * 1024 * 1024;

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function filesUnder(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  await visit(root);
  return files.sort();
}

function relativePayloadPath(filePath) {
  return path.relative(RESOURCE_ROOT, filePath).split(path.sep).join("/");
}

async function stageFile(filePath, nextChunkNumber) {
  const relativePath = relativePayloadPath(filePath);
  const fileStats = await stat(filePath);
  const hash = createHash("sha256");
  const source = await open(filePath, "r");
  const chunks = [];
  let offset = 0;

  try {
    while (offset < fileStats.size) {
      const chunkSize = Math.min(CHUNK_SIZE, fileStats.size - offset);
      const chunkName = `chunks/${String(nextChunkNumber.value).padStart(6, "0")}.bin`;
      const chunkPath = path.join(PAYLOAD_DIR, chunkName);
      await mkdir(path.dirname(chunkPath), { recursive: true });
      const destination = await open(chunkPath, "w");
      let remaining = chunkSize;

      try {
        while (remaining > 0) {
          const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_SIZE, remaining));
          const { bytesRead } = await source.read(buffer, 0, buffer.length, offset);
          if (bytesRead === 0) throw new Error(`Unexpected EOF while reading ${filePath}`);
          const chunk = buffer.subarray(0, bytesRead);
          hash.update(chunk);
          await destination.write(chunk);
          offset += bytesRead;
          remaining -= bytesRead;
        }
      } finally {
        await destination.close();
      }

      chunks.push(chunkName);
      nextChunkNumber.value += 1;
    }
  } finally {
    await source.close();
  }

  return {
    path: relativePath,
    size: fileStats.size,
    sha256: hash.digest("hex"),
    chunks,
  };
}

async function stagePayload() {
  const runtimeRoot = path.join(RESOURCE_ROOT, "runtime");
  const modelsRoot = path.join(RESOURCE_ROOT, "models");
  if (!(await exists(runtimeRoot)) || !(await exists(modelsRoot))) {
    throw new Error(
      "Bundled AI resources are missing. Run `bun run vision:bundle` before building the installer.",
    );
  }

  await rm(STAGING_ROOT, { recursive: true, force: true });
  await mkdir(path.join(PAYLOAD_DIR, "chunks"), { recursive: true });

  const sourceFiles = [...(await filesUnder(runtimeRoot)), ...(await filesUnder(modelsRoot))];
  const nextChunkNumber = { value: 1 };
  const manifestFiles = [];
  for (const filePath of sourceFiles) {
    manifestFiles.push(await stageFile(filePath, nextChunkNumber));
  }

  const manifest = {
    format: "foundry-ai-payload-v1",
    chunkSize: CHUNK_SIZE,
    files: manifestFiles,
  };
  await writeFile(
    path.join(PAYLOAD_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(PAYLOAD_DIR, "README.txt"),
    "Keep this directory next to Foundry setup.exe. The installer joins these files into the installed models and runtime directories. Do not rename or move individual chunk files.\n",
    "utf8",
  );

  const totalBytes = sourceFiles.reduce((sum, filePath) => sum + statSync(filePath).size, 0);
  console.log(`Staged ${PAYLOAD_NAME}: ${(totalBytes / 1024 ** 3).toFixed(2)} GiB`);
}

let activeTargetDir = TARGET_DIR;

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...extraEnv };
    env.CARGO_TARGET_DIR ??= TARGET_DIR;
    const msysUCRT64 = "C:\\msys64\\ucrt64\\bin";
    if (process.platform === "win32" && existsSync(msysUCRT64)) {
      const pathValue = `${msysUCRT64};${env.Path ?? env.PATH ?? ""}`;
      env.Path = pathValue;
      env.PATH = pathValue;
    }
    const executable = process.platform === "win32" && command === "bunx" ? "bun.exe" : command;
    const commandArgs = process.platform === "win32" && command === "bunx" ? ["x", ...args] : args;
    const child = spawn(executable, commandArgs, { cwd: REPO_ROOT, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? signal}`));
    });
  });
}

function stopProjectDesktopApps() {
  if (process.platform === "win32") {
    const rootLiteral = REPO_ROOT.replace(/'/g, "''");
    const command = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      `$root = '${rootLiteral}'`,
      "$rootPattern = [regex]::Escape($root)",
      "$processes = @(Get-CimInstance Win32_Process | Where-Object {",
      "  $_.Name -eq 'app.exe' -and $_.CommandLine -and ($_.CommandLine -match $rootPattern -or $_.CommandLine -match 'target[\\\\/].*app\\.exe')",
      "})",
      "$processes | ForEach-Object {",
      '  Write-Host "Stopping existing Foundry app $($_.ProcessId)"',
      "  & taskkill.exe /PID $($_.ProcessId) /T /F | Out-Null",
      "}",
    ].join("\n");
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    return;
  }

  const output = execFileSync("ps", ["-eo", "pid=,command="], { encoding: "utf8" });
  for (const line of output.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    const [, pid, command] = match;
    if (
      command.includes(REPO_ROOT) &&
      /target\/.*app\.exe|desktop-builds\/.*app\.exe/.test(command)
    ) {
      console.log(`Stopping existing Foundry app ${pid}: ${command}`);
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {
        // The process may have exited between ps and kill.
      }
    }
  }
}

function createBuildId() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const entropy = createHash("sha256")
    .update(`${process.pid}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 10);
  return `${timestamp}-${entropy}`;
}

async function newestReleaseExecutable(since, targetDir = activeTargetDir) {
  const candidates = [];
  async function visit(directory) {
    if (!(await exists(directory))) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase() === "app.exe") {
        const fileStats = await stat(fullPath);
        if (fileStats.mtimeMs >= since) {
          candidates.push({ path: fullPath, mtimeMs: fileStats.mtimeMs });
        }
      }
    }
  }
  await visit(targetDir);
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.path;
}

async function archiveDesktopApp(executablePath, buildId) {
  const buildRoot = DESKTOP_BUILD_ROOT;
  const versionRoot = path.join(buildRoot, buildId);
  await mkdir(versionRoot, { recursive: true });
  const archivedExecutable = path.join(versionRoot, "app.exe");
  await rm(archivedExecutable, { force: true });
  await cp(executablePath, archivedExecutable);
  await writeFile(
    path.join(buildRoot, "current.json"),
    `${JSON.stringify({ buildId, executable: path.relative(buildRoot, archivedExecutable) }, null, 2)}\n`,
    "utf8",
  );
  return archivedExecutable;
}

async function newestSetupExecutable(since) {
  const candidates = [];
  async function visit(directory) {
    if (!(await exists(directory))) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith("-setup.exe")) {
        const fileStats = await stat(fullPath);
        if (fileStats.mtimeMs >= since)
          candidates.push({ path: fullPath, mtimeMs: fileStats.mtimeMs });
      }
    }
  }
  await visit(TARGET_DIR);
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.path;
}

async function main() {
  const appOnly = process.argv.includes("--app-only");
  const launch = process.argv.includes("--launch");
  const buildId = createBuildId();
  const buildEnv = { FOUNDRY_BUILD_ID: buildId };
  if (appOnly) {
    const distDir = path.join(DESKTOP_BUILD_ROOT, buildId, "dist");
    const portableDistDir = path.relative(REPO_ROOT, distDir).split(path.sep).join("/");
    buildEnv.FOUNDRY_DIST_DIR = portableDistDir;
    buildEnv.TAURI_CONFIG = JSON.stringify({
      build: { frontendDist: `../${portableDistDir}` },
    });
    await mkdir(activeTargetDir, { recursive: true });
  }
  if (appOnly) {
    console.log("Building an isolated desktop executable...");
  } else {
    console.log("Preparing Foundry offline AI payload...");
    await stagePayload();
  }

  stopProjectDesktopApps();
  const buildStarted = Date.now() - 2000;
  console.log(
    appOnly ? "Building Tauri desktop executable..." : "Building Tauri NSIS installer...",
  );
  await run(
    "bunx",
    ["tauri", "build", ...(appOnly ? ["--no-bundle"] : ["--bundles", "nsis"])],
    buildEnv,
  );

  if (appOnly) {
    const executablePath = await newestReleaseExecutable(buildStarted);
    if (!executablePath) {
      throw new Error(`Tauri did not refresh a release executable for build ${buildId}`);
    }
    const archivedExecutable = await archiveDesktopApp(executablePath, buildId);
    console.log(`Desktop build ${buildId} archived at ${archivedExecutable}`);
    if (launch) {
      const child = spawn(archivedExecutable, [], {
        cwd: REPO_ROOT,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      console.log(`Launched ${archivedExecutable}`);
    } else {
      console.log("Desktop executable refreshed. Reopen Foundry from the desktop shortcut.");
    }
    return;
  }

  const setupPath = await newestSetupExecutable(buildStarted);
  if (!setupPath) throw new Error("Tauri did not produce a new NSIS setup executable.");
  const destination = path.join(path.dirname(setupPath), PAYLOAD_NAME);
  await rm(destination, { recursive: true, force: true });
  await cp(PAYLOAD_DIR, destination, { recursive: true, force: true });

  console.log(`Installer: ${setupPath}`);
  console.log(`Offline payload: ${destination}`);
  console.log("Keep the setup executable and Foundry-AI-Payload directory together.");
}

await main();
