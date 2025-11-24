import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import type { PlaywrightTestConfig } from '@playwright/test'

const rootDir = path.resolve(__dirname, '..')
const testsDir = path.join(rootDir, 'tests')
const artifactsDir = path.join(rootDir, 'artifacts')
const reportDir = path.join(rootDir, 'playwright-report')

export const baseConfig: PlaywrightTestConfig = defineConfig({
  testDir: testsDir,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  outputDir: artifactsDir,
  reporter: [['list'], ['html', { outputFolder: reportDir, open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})

export default baseConfig
