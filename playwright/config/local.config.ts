import path from 'node:path'
import merge from 'lodash.merge'
import { defineConfig } from '@playwright/test'
import { baseConfig } from './base.config'
import { resolveEnvironmentConfig } from '../support/config/environments'

const repoRoot = path.resolve(__dirname, '..', '..')
const environment = resolveEnvironmentConfig('local')

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
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: repoRoot,
      },
    ],
  })
)
