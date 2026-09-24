/**
 * Bundled vision runtime bootstrap (docs/POSITIONING.md task: kill the manual
 * Ollama install as a first-run step).
 *
 * The client already speaks the Ollama protocol against `127.0.0.1:11434`
 * (see gemma.ts), so bundling means *serving that same endpoint ourselves*:
 * a copy of the official runtime layout plus a pre-seeded model directory
 * ship inside the installer (`src-tauri/resources/runtime` + `.../models`,
 * staged by `scripts/fetch-vision-model.mjs`), and Foundry starts it with
 * `OLLAMA_MODELS` pointed at the bundled weights.
 *
 * The outcome ladder, decided at boot:
 *   "webview"   — outside the Tauri shell: silent no-op (unit/e2e harness).
 *   "bundled"   — our runtime spawned and answered the health probe.
 *   "external"  — ours did not run (missing binary, or the port was already
 *                 taken by an Ollama the user installed) but something still
 *                 answers on 11434: use it, exactly as before.
 *   "fallback"  — nothing answers: on-device text recognition only, the
 *                 pre-existing Tesseract path.
 *
 * Every failure mode collapses into one of those four values — this function
 * never throws and never logs errors, because it runs during app startup.
 */
import { isTauri } from "@tauri-apps/api/core";
import { resourceDir } from "@tauri-apps/api/path";
import { Command } from "@tauri-apps/plugin-shell";
import { ollamaBase } from "./gemma";

export type VisionRuntime = "webview" | "bundled" | "external" | "fallback";

/** Scope name in src-tauri/capabilities/default.json; cmd is the staged exe. */
export const VISION_RUNTIME_COMMAND = "vision-runtime";

/** ~6s of polling: `ollama serve` binds well inside this on first run. */
const PROBE_ATTEMPTS = 20;
const PROBE_INTERVAL_MS = 300;

export type VisionRuntimeDeps = {
  isTauri: () => boolean;
  resourceDir: () => Promise<string>;
  /** Starts the bundled runtime; `closed` resolves when the process exits. */
  spawnRuntime: (modelsDir: string, runtimeCwd: string) => Promise<{ closed: Promise<void> }>;
  /** True when *something* answers the model protocol on 11434. Never throws. */
  probe: () => Promise<boolean>;
  delay: (ms: number) => Promise<void>;
};

async function realProbe(): Promise<boolean> {
  try {
    const response = await fetch(`${ollamaBase()}/api/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const realDeps: VisionRuntimeDeps = {
  isTauri,
  resourceDir,
  spawnRuntime: async (modelsDir, runtimeCwd) => {
    const command = Command.create(VISION_RUNTIME_COMMAND, ["serve"], {
      cwd: runtimeCwd,
      env: { OLLAMA_MODELS: modelsDir, OLLAMA_HOST: "127.0.0.1:11434" },
    });
    const closed = new Promise<void>((resolve) => {
      command.on("close", () => resolve());
      command.on("error", () => resolve());
    });
    await command.spawn();
    return { closed };
  },
  probe: realProbe,
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Resolves once to the runtime decision. Call exactly once per app boot. */
export async function startVisionRuntime(
  deps: VisionRuntimeDeps = realDeps,
): Promise<VisionRuntime> {
  try {
    if (!deps.isTauri()) return "webview";

    let closed: Promise<void>;
    try {
      const dir = await deps.resourceDir();
      ({ closed } = await deps.spawnRuntime(`${dir}/models`, `${dir}/runtime`));
    } catch {
      // No staged binary, no shell scope, dev build without resources…
      return (await deps.probe()) ? "external" : "fallback";
    }

    let exited = false;
    void closed.then(() => {
      exited = true;
    });

    for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt += 1) {
      if (exited) {
        // Ours died — the usual reason is the port was already taken by an
        // Ollama the user installed. Whatever answers now is not ours.
        return (await deps.probe()) ? "external" : "fallback";
      }
      if (await deps.probe()) return "bundled";
      await deps.delay(PROBE_INTERVAL_MS);
    }
    return (await deps.probe()) ? "external" : "fallback";
  } catch {
    return "fallback";
  }
}
