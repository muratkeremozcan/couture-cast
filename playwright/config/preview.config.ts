import path from 'node:path'
import merge from 'lodash.merge'
import { defineConfig } from '@playwright/test'
import { baseConfig } from './base.config'
import { resolveEnvironmentConfig } from './environments'
import { VERCEL_BYPASS_STATE_PATH } from '../global-setup-vercel-bypass'

const environment = resolveEnvironmentConfig('preview')

// The bypass cookie global setup mints is itself a credential for the protected
// deployment, and a trace records every cookie a request carries. Runs that hold
// the bypass secret keep screenshots and video and record no trace.
const holdsBypassSecret = Boolean(process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim())

export default defineConfig(
  merge({}, baseConfig, {
    globalSetup: path.resolve(__dirname, '..', 'global-setup-vercel-bypass.ts'),
    use: {
      baseURL: environment.webBaseUrl,
      // Vercel bypass cookies minted by global setup; see that file for why
      // the secret itself must not be sent from tests.
      storageState: VERCEL_BYPASS_STATE_PATH,
      ...(holdsBypassSecret ? { trace: 'off' as const } : {}),
    },
    metadata: {
      environment: environment.name,
      baseUrl: environment.webBaseUrl,
      apiBaseUrl: environment.apiBaseUrl,
      healthEndpoint: new URL('/api/health', environment.webBaseUrl).toString(),
    },
  })
)
