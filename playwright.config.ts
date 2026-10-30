import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const origin = "http://localhost:3100";

export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: origin,
    timezoneId: "Asia/Singapore",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname localhost --port 3100",
    url: `${origin}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ORIGIN: origin,
      RP_ID: "localhost",
      RP_NAME: "Todo E2E",
      JWT_SECRET: randomBytes(48).toString("base64url"),
      DATABASE_PATH: resolve(".e2e-todos.db"),
    },
  },
});
