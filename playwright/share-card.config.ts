import path from 'node:path'
import { defineConfig } from '@playwright/test'
// This lane consumes only scripts/e2e-share-card's owned UUID runtime. It never
// invokes the general database reset/setup or creates a shared test account.
export default defineConfig({
  testDir: './tests',
  testMatch: 'share-card-export.spec.ts',
  workers: 1,
  fullyParallel: false,
  // A committed test.only would otherwise skip every other acceptance case on CI.
  forbidOnly: !!process.env.CI,
  timeout: 60000,
  expect: { timeout: 20000 },
  use: {
    baseURL: 'http://127.0.0.1:3088',
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: ['chromium', 'firefox', 'webkit'].map((name) => ({
    name,
    use: { browserName: name as 'chromium' | 'firefox' | 'webkit' },
  })),
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: path.resolve(
          __dirname,
          '../_bmad-output/test-artifacts/story-6-8/runtime/playwright-web-matrix.json'
        ),
      },
    ],
  ],
  outputDir: '../_bmad-output/test-artifacts/story-6-8/runtime/playwright-owned',
})
