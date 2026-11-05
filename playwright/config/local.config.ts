import path from 'node:path'
import merge from 'lodash.merge'
import { defineConfig } from '@playwright/test'
import { log } from '@seontechnologies/playwright-utils/log'
import { baseConfig } from './base.config'
import { resolveEnvironmentConfig } from './environments'
import { e2eStackLauncherPath } from '../../scripts/e2e-stack-pid.mjs'

const repoRoot = path.resolve(__dirname, '..', '..')
const environment = resolveEnvironmentConfig('local')

// IMPORTANT: the setup for logging to files needs to be uniform between test files
// best place to put it is in a config file
const SILENT = process.env.SILENT === 'true'
const DISABLE_FILE_LOGS = process.env.DISABLE_FILE_LOGS === 'true' || SILENT
const DISABLE_CONSOLE_LOGS = process.env.DISABLE_CONSOLE_LOGS === 'true' || SILENT

// ORGANIZED LOGS
log.configure({
  // Set console directly to false rather than using object format
  console: {
    enabled: !DISABLE_CONSOLE_LOGS,
  }, // This should disable console logs completely
  format: {
    maxLineLength: 4000, // Set your desired maximum line length
  },
  // debug < info < step < success < warning < error
  // level: 'step', // show all logs, or limit them
  fileLogging: {
    enabled: !DISABLE_FILE_LOGS,
    defaultTestFolder: 'before-hooks', // all hooks go to the default folder
    forceConsolidated: false, // Explicitly disable consolidation
    outputDir: 'playwright-logs/',
  },
})

export default defineConfig(
  merge({}, baseConfig, {
    use: {
      baseURL: environment.webBaseUrl,
    },
    metadata: {
      environment: environment.name,
      baseUrl: environment.webBaseUrl,
      apiBaseUrl: environment.apiBaseUrl,
      healthEndpoint: new URL('/api/health', environment.webBaseUrl).toString(),
    },
    webServer: {
      // The absolute launcher path, so the global teardown can find it on this
      // process's command line before it signals it (Story 6.2b, CX8b).
      command: `node ${JSON.stringify(e2eStackLauncherPath(repoRoot))} --with-web`,
      url: environment.webBaseUrl,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: repoRoot,
      // Only overrides belong here. Playwright already starts the web server
      // with the runner's environment underneath these keys, and it serializes
      // this object verbatim into every blob report, so spreading process.env
      // here published the whole CI environment, secrets included.
      env: {
        API_BASE_URL: environment.apiBaseUrl,
        PUBLIC_API_URL: environment.apiBaseUrl,
        REUSE_EXISTING_WEB_SERVER: process.env.CI ? 'false' : 'true',
        WEB_E2E_BASE_URL: environment.webBaseUrl,
        POSTHOG_API_KEY: '',
        TEST_ENV: 'local',
      },
    },
  })
)
