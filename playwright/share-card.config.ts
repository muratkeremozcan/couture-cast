import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineConfig } from '@playwright/test'

function firefoxAppData() {
  const directory = path.join(os.tmpdir(), 'couture-cast-playwright-firefox-app-data')
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

// This lane consumes only scripts/e2e-share-card's owned UUID runtime. It never
// invokes the general database reset/setup or creates a shared test account.
export default defineConfig({
  testDir: './tests',
  testMatch: ['share-card-export.spec.ts', 'share-card-native-share.spec.ts'],
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
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        // Firefox reads its app data folder at startup even with an explicit -profile.
        // On macOS that folder is ~/Library/Application Support/Firefox, which an
        // installed Firefox owns: App Data protection denies the ad hoc signed Playwright
        // build, and it exits with "Could not find profile folder". MOZ_APP_DATA points
        // it at a folder of its own on every platform.
        launchOptions: { env: { ...process.env, MOZ_APP_DATA: firefoxAppData() } },
      },
    },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
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
