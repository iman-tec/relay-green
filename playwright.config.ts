import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,           // tests share Supabase state — run sequentially
  forbidOnly: !!process.env.CI,
  retries: 1,                     // absorb supabase realtime / API jitter under load
  workers: 1,                     // single worker to avoid auth-cookie races
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: "https://10.0.1.207:3000",
    trace: "retain-on-failure",
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chromium" },
    },
  ],
});
