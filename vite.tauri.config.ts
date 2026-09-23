import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Separate static SPA build for Tauri. The web build (vite.config.ts) is
// TanStack Start SSR (Nitro server + hydration) and cannot run from
// frontendDist static files — that mismatch is the white-screen cause.
// This config builds a plain client-only bundle with hash routing.
//
// NOTE: no tanstackRouter plugin here on purpose. The plugin rewrites
// createFileRoute calls so they only work inside the generated Start route
// tree (it strips the path args our manual Tauri tree relies on, which
// surfaced as "Invariant failed: duplicate __root__"). Without the plugin,
// createFileRoute behaves like plain createRoute and our manual tree works.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist-tauri",
    emptyOutDir: true,
    rollupOptions: {
      input: "tauri.html",
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router"],
  },
});
