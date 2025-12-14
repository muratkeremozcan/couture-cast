import merge from 'lodash.merge'
import { defineConfig } from '@playwright/test'
import { baseConfig } from './base.config'
import { resolveEnvironmentConfig } from './environments'

const environment = resolveEnvironmentConfig('dev')

// NOTE: In CI, "dev" is typically a Vercel Preview deployment URL passed via `DEV_WEB_E2E_BASE_URL`.
export default defineConfig(
  merge({}, baseConfig, {
    // Dev targets Vercel Preview for the web app. API endpoints are not deployed to a dev domain yet.
    testIgnore: ['**/api/**'],
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
  })
)
