import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/edit-screen-info', () => ({
  default: () => null,
}))

vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: vi.fn(),
  }),
}))

const { loadMobileApiHealthMock } = vi.hoisted(() => ({
  loadMobileApiHealthMock: vi.fn(),
}))

vi.mock('@/src/lib/api-health', () => ({
  loadMobileApiHealth: loadMobileApiHealthMock,
}))

import TabTwoScreen from '../../app/(tabs)/two'

describe('TabTwoScreen', () => {
  beforeEach(() => {
    loadMobileApiHealthMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders API health loaded from the generated client', async () => {
    loadMobileApiHealthMock.mockResolvedValue({
      status: 'ok',
    })

    render(<TabTwoScreen />)

    await screen.findByText('API health: ok')
  })

  it('falls back to unavailable when the API health request never resolves', async () => {
    vi.useFakeTimers()
    loadMobileApiHealthMock.mockImplementation(() => new Promise(() => undefined))

    render(<TabTwoScreen />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(screen.getByText('API health unavailable')).toBeTruthy()
  })
})
