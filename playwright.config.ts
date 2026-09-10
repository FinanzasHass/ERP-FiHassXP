import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.spec.ts",
  workers: 1,
  timeout: 20000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: process.env.E2E_BROWSER_CHANNEL || "msedge",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  reporter: "list",
});
