/**
 * The owned config for the Story 6.5 real-session specs. Only
 * `scripts/e2e-real-session/run.mjs` uses it: that script starts the isolated
 * database, the Auth proxy, the API on 4077 and the real-auth web build on 3077
 * before Playwright runs, so this config starts nothing, resets nothing and runs
 * only the real-session specs, one at a time, with no retries.
 */
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import {
  API_BASE_URL,
  RAW_DIR,
  WEB_BASE_URL,
  assertIsolatedDatabaseUrl,
  consentGrepInvert,
  realSessionConsentPolicy,
} from '../../scripts/e2e-real-session/harness.mjs'
import localConfig from './local.config'

const directory = process.env.STORY65_REAL_SESSION_DIR
if (!directory)
  throw new Error(
    'STORY65_REAL_SESSION_DIR is unset. Run the real-session specs with npm run test:pw-real-session.'
  )
const owned = JSON.parse(
  fs.readFileSync(path.join(directory, 'owned-env.json'), 'utf8')
) as Record<string, string>
// Importing the local config loaded .env.local over the environment. Put the run's
// own database, Redis and origins back before any test module reads them.
Object.assign(process.env, owned)
assertIsolatedDatabaseUrl(process.env.DATABASE_URL)

// Raw output stays outside the upload directory: run.mjs redacts it into a staging
// directory and publishes that only once redaction finished
// (scripts/e2e-real-session/artifacts.mjs). Failure messages can carry filled
// values, OTP codes included, so nothing here is ever uploaded as written.
const raw = path.join(directory, RAW_DIR)
const metadata = { environment: 'local', apiBaseUrl: API_BASE_URL, baseUrl: WEB_BASE_URL }

export default defineConfig({
  ...localConfig,
  testDir: path.resolve(__dirname, '../tests'),
  testMatch:
    /(community-real-session(-identity)?|guest-preview-real-session|google-sign-in-real-session|signed-in-landing-real-session)\.spec\.ts$/,
  webServer: undefined,
  globalSetup: undefined,
  globalTeardown: undefined,
  // GUARDIAN_CONSENT_POLICY picks the lane: the policy-off specs, or only the consent cases.
  grepInvert: consentGrepInvert(realSessionConsentPolicy()),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: path.join(raw, 'test-results'),
  // No HTML report: its step titles carry filled values, OTP codes included.
  reporter: [['list'], ['junit', { outputFile: path.join(raw, 'junit.xml') }]],
  metadata,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, metadata },
    // Owner report 2026-11-16: the signed-in landing loop was seen on iPhone Safari, so its spec
    // also runs in WebKit with the iPhone 15 descriptor (393 wide, touch, device scale 3).
    {
      name: 'webkit-iphone',
      use: { ...devices['iPhone 15'] },
      testMatch: /signed-in-landing-real-session\.spec\.ts$/,
      metadata,
    },
  ],
  use: {
    ...localConfig.use,
    baseURL: WEB_BASE_URL,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
})
