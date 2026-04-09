import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/edit-screen-info', () => ({
  default: () => null,
}))

vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: vi.fn(),
  }),
}))

import TabTwoScreen from './two'

describe('TabTwoScreen', () => {
  const originalExpoPublicApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = originalExpoPublicApiBaseUrl
  })

  it('renders API health loaded from the generated client', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://example.test'

    render(<TabTwoScreen />)

    expect((await screen.findByText('API health: ok')).textContent).toBe('API health: ok')
  })
})
