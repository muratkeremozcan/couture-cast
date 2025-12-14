import path from 'node:path'
import merge from 'lodash.merge'
import { defineConfig } from '@playwright/test'
import { log } from '@seontechnologies/playwright-utils/log'
import { baseConfig } from './base.config'
import { resolveEnvironmentConfig } from './environments'

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
      extraHTTPHeaders: environment.apiHeaders,
    },
    metadata: {
      environment: environment.name,
      baseUrl: environment.webBaseUrl,
      apiBaseUrl: environment.apiBaseUrl,
      healthEndpoint: new URL('/api/health', environment.webBaseUrl).toString(),
    },
    webServer: [
      {
        command: 'npm run start:api',
        url: environment.apiBaseUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: repoRoot,
      },
      {
        command: 'npm run start:web',
        url: environment.webBaseUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: repoRoot,
      },
    ],
  })
)
