import merge from 'lodash.merge'
import { defineConfig } from '@playwright/test'
import { baseConfig } from './base.config'
import { resolveEnvironmentConfig } from '../support/config/environments'

const environment = resolveEnvironmentConfig('stage')

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
  })
)
