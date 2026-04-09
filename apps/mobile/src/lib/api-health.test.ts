import { afterEach, describe, expect, it } from 'vitest'

import { loadMobileApiHealth } from './api-health'

describe('loadMobileApiHealth', () => {
  const originalExpoPublicApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = originalExpoPublicApiBaseUrl
  })

  it('loads health details through the generated mobile client', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://example.test'

    const response = await loadMobileApiHealth()

    expect(response.status).toBe('ok')
    expect(response.service).toBe('couturecast-api')
  })
})
