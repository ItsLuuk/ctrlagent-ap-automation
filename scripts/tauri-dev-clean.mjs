#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";

const root = process.cwd();
const skipLaunch = process.argv.includes("--no-launch");

function stopStaleWindowsProcesses() {
  const rootLiteral = root.replace(/'/g, "''");
  const command = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$root = '${rootLiteral}'`,
    "$rootPattern = [regex]::Escape($root)",
    "$processes = @(Get-CimInstance Win32_Process | Where-Object {",
    "  $_.ProcessId -ne $PID -and $_.CommandLine -and (",
    "    ($_.CommandLine -match 'vite\\.tauri\\.config\\.ts') -or",
    "    ($_.Name -eq 'tauri.exe' -and $_.CommandLine -match '\\sdev(?:\\s|$)') -or",
    "    ($_.CommandLine -match 'bootstrap-tauri-dev\\.ps1') -or",
    "    ($_.Name -eq 'app.exe' -and ($_.CommandLine -match $rootPattern -or $_.CommandLine -match 'target[\\\\/].*app\\.exe'))",
    "  )",
    "})",
    "$pids = @($processes | ForEach-Object { $_.ProcessId })",
    "$pids += @(Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess })",
    "$pids | Sort-Object -Unique | ForEach-Object {",
    "  $processId = $_",
    "  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue",
    "  if ($process) {",
    '    Write-Host "Stopping stale Tauri process $processId`: $($process.ProcessName)"',
    "    & taskkill.exe /PID $processId /T /F | Out-Null",
    "  }",
    "}",
  ].join("\n");

  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    cwd: root,
    stdio: "inherit",
  });
}

function stopStaleUnixProcesses() {
  const output = execFileSync("ps", ["-eo", "pid=,command="], { encoding: "utf8" });
  for (const line of output.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    const [, pid, command] = match;
    const isProjectRuntime = /(vite\.tauri\.config\.ts|tauri\s+dev|tauri:dev(?:\s|$))/.test(
      command,
    );
    const isProjectApp = /target\/.*app\.exe/.test(command);
    if (Number(pid) === process.pid || (!isProjectRuntime && !isProjectApp)) continue;
    console.log(`Stopping stale Tauri process ${pid}: ${command}`);
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // The process may have exited between ps and kill.
    }
  }
}

console.log("Cleaning stale Tauri development processes…");
if (process.platform === "win32") stopStaleWindowsProcesses();
else stopStaleUnixProcesses();

console.log("Starting Tauri with a fresh Vite dev server…");
if (skipLaunch) {
  console.log("Stale processes cleared; launch skipped (--no-launch).");
  process.exit(0);
}

console.log("Launching the current Tauri development app…");
const env = { ...process.env };
if (process.platform === "win32" && existsSync("C:\\msys64\\ucrt64\\bin")) {
  const toolPath = "C:\\msys64\\ucrt64\\bin";
  const currentPath = env.Path ?? env.PATH ?? "";
  env.Path = `${toolPath};${currentPath}`;
  env.PATH = env.Path;
}
const child = spawn(process.platform === "win32" ? "bun.exe" : "bun", ["run", "tauri:dev"], {
  cwd: root,
  env,
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
