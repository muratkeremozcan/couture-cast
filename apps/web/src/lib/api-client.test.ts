import type { Configuration } from '@couture/api-client'
import { afterEach, describe, expect, it } from 'vitest'

import { createWebApiClient } from './api-client'

describe('createWebApiClient', () => {
  const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL

  afterEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl
  })

  it('uses the public API base URL env var and include credentials by default', async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.couturecast.test/'

    const client = createWebApiClient({
      accessToken: () => 'web-token',
    })
    const configuration = (client as unknown as { configuration: Configuration })
      .configuration

    expect(configuration.basePath).toBe('https://api.couturecast.test')
    expect(configuration.credentials).toBe('include')
    expect(await configuration.accessToken?.()).toBe('web-token')
  })

  it('falls back to same-origin requests when no public base URL is configured', () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL

    const client = createWebApiClient()
    const configuration = (client as unknown as { configuration: Configuration })
      .configuration

    expect(configuration.basePath).toBe('')
    expect(configuration.credentials).toBe('include')
  })
})
