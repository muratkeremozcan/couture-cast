import path from 'node:path'
import merge from 'lodash.merge'
import { defineConfig } from '@playwright/test'
import { baseConfig } from './base.config'
import { resolveEnvironmentConfig } from './environments'
import { VERCEL_BYPASS_STATE_PATH } from '../global-setup-vercel-bypass'

const environment = resolveEnvironmentConfig('prod')

export default defineConfig(
  merge({}, baseConfig, {
    globalSetup: path.resolve(__dirname, '..', 'global-setup-vercel-bypass.ts'),
    // Story 1.2b: specs tagged @local-lane write locations and need the local
    // weather provider double, so the production run never selects them.
    grepInvert: /@local-lane/,
    use: {
      baseURL: environment.webBaseUrl,
      // Vercel bypass cookies minted by global setup; see that file for why
      // the secret itself must not be sent from tests.
      storageState: VERCEL_BYPASS_STATE_PATH,
    },
    metadata: {
      environment: environment.name,
      baseUrl: environment.webBaseUrl,
      apiBaseUrl: environment.apiBaseUrl,
      healthEndpoint: new URL('/api/health', environment.webBaseUrl).toString(),
    },
  })
)
