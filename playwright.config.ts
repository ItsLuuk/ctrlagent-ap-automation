import { defineConfig, devices } from "playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "bun run dev:vite",
    url: "http://127.0.0.1:5173/tauri.html",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
