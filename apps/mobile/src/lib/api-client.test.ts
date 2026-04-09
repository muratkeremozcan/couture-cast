import type { Configuration } from '@couture/api-client'
import { afterEach, describe, expect, it } from 'vitest'

import { createMobileApiClient } from './api-client'

describe('createMobileApiClient', () => {
  const originalExpoPublicApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL
  const originalApiBaseUrl = process.env.API_BASE_URL

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = originalExpoPublicApiBaseUrl
    process.env.API_BASE_URL = originalApiBaseUrl
  })

  it('uses the configured mobile API base URL and forwards bearer auth providers', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://mobile-api.couturecast.test/'

    const client = createMobileApiClient({
      accessToken: () => 'mobile-token',
    })
    const configuration = (client as unknown as { configuration: Configuration })
      .configuration

    expect(configuration.basePath).toBe('https://mobile-api.couturecast.test')
    expect(await configuration.accessToken?.()).toBe('mobile-token')
  })

  it('falls back to API_BASE_URL when the Expo public base URL is unset', async () => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL
    process.env.API_BASE_URL = 'https://fallback-api.couturecast.test/'

    const client = createMobileApiClient({
      accessToken: () => 'mobile-token',
    })
    const configuration = (client as unknown as { configuration: Configuration })
      .configuration

    expect(configuration.basePath).toBe('https://fallback-api.couturecast.test')
    expect(await configuration.accessToken?.()).toBe('mobile-token')
  })

  it('throws when no mobile API base URL is configured', () => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL
    delete process.env.API_BASE_URL

    expect(() => createMobileApiClient()).toThrow(/mobile api base url/i)
  })
})
