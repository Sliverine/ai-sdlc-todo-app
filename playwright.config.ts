import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://localhost:3100'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    headless: true,
    timezoneId: 'Asia/Singapore',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --hostname localhost --port 3100',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_PATH: './.test-todos.db',
      JWT_SECRET: 'playwright-test-secret-at-least-32-characters',
      RP_ID: 'localhost',
      RP_NAME: 'Todo App Tests',
      RP_ORIGIN: baseURL,
    },
  },
})
