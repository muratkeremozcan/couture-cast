// Learning path Step 15: Validate, generate, and consume the canonical contract.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-15-validate-generate-and-consume-the-canonical-contract
import { afterEach, describe, expect, it } from 'vitest'

import { loadMobileApiHealth } from './api-health'

describe('loadMobileApiHealth', () => {
  const originalExpoPublicApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = originalExpoPublicApiBaseUrl
  })

  it('loads health details through the generated mobile client', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://example.test'

    const response = await loadMobileApiHealth()

    expect(response.status).toBe('ok')
    expect(response.service).toBe('couturecast-api')
  })
})
