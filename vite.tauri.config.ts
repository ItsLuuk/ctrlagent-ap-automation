import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Foundry is a single desktop application. This config builds the client-only
// bundle embedded by Tauri; the desktop router is declared explicitly in
// src/tauri/router.tsx and uses hash history for static-file deep links.
const buildCommit =
  process.env["VITE_TAURI_COMMIT"] ??
  process.env["GIT_COMMIT"] ??
  (() => {
    try {
      return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return "working-tree";
    }
  })();
const buildHash =
  process.env["VITE_TAURI_BUILD_HASH"] ??
  createHash("sha256").update(`${buildCommit}:${Date.now()}`).digest("hex").slice(0, 12);
const buildId =
  process.env["FOUNDRY_BUILD_ID"] ?? `${buildCommit}-${Date.now().toString(36)}-${buildHash}`;
const builtAt = new Date().toISOString();

/**
 * Tauri's WebView can miss a module update even when Vite sees the file change.
 * A full document reload is cheap in development and makes the window follow
 * the source tree instead of depending on HMR surviving a Windows webview.
 */
function forceFullReloadOnSourceChange(): Plugin {
  return {
    name: "foundry-full-reload",
    configureServer(server) {
      const root = server.config.root.replace(/\\/g, "/");
      const reload = (file: string) => {
        const normalized = file.replace(/\\/g, "/");
        if (!normalized.startsWith(`${root}/`) || normalized.includes("/node_modules/")) return;
        server.ws.send({ type: "full-reload", path: "*" });
      };
      server.watcher.on("change", reload);
      server.watcher.on("add", reload);
      server.watcher.on("unlink", reload);
    },
  };
}

export default defineConfig({
  base: "./",
  define: {
    "import.meta.env.VITE_TAURI_BUILD_HASH": JSON.stringify(buildHash),
    "import.meta.env.VITE_TAURI_BUILD_ID": JSON.stringify(buildId),
    "import.meta.env.VITE_TAURI_COMMIT": JSON.stringify(buildCommit),
  },
  build: {
    outDir: process.env["FOUNDRY_DIST_DIR"] ?? "dist-tauri",
    emptyOutDir: true,
    rollupOptions: {
      input: "tauri.html",
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Windows/webview2 can miss native filesystem notifications. Polling keeps
    // Tauri HMR deterministic when the source tree changes.
    watch: {
      usePolling: true,
      interval: 300,
    },
    hmr: {
      host: "127.0.0.1",
      port: 5173,
    },
    // Tauri WebView2 can cache the dev document and its module graph even
    // after Vite emits HMR updates. Never allow a stale frontend to survive
    // a source change; packaged builds are unaffected.
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  },
  plugins: [
    forceFullReloadOnSourceChange(),
    react(),
    tailwindcss(),
    tsconfigPaths(),
    {
      name: "foundry-build-manifest",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "build-manifest.json",
          source: `${JSON.stringify(
            { schemaVersion: 1, buildId, buildHash, buildCommit, builtAt },
            null,
            2,
          )}\n`,
        });
      },
    },
  ],
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router"],
  },
});
