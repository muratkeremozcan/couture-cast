// Step 22 step 7 owner: verify Settings screen layout boundaries in headless Chromium in apps/mobile/src/screens/tab-two-screen.test.tsx
/* eslint-disable @typescript-eslint/await-thenable */
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

vi.mock('@/components/edit-screen-info', () => ({
  default: () => null,
}))

const { analyticsCaptureMock, loadMobileApiHealthMock, updatePreferredLocaleMock } =
  vi.hoisted(() => ({
    analyticsCaptureMock: vi.fn(),
    loadMobileApiHealthMock: vi.fn(),
    updatePreferredLocaleMock: vi.fn(),
  }))

vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: analyticsCaptureMock,
    getDistinctId: () => 'test-user-id',
  }),
}))

vi.mock('@/src/lib/api-health', () => ({
  loadMobileApiHealth: loadMobileApiHealthMock,
}))

vi.mock('@/src/lib/user', () => ({
  updatePreferredLocaleFromMobile: updatePreferredLocaleMock,
}))

import i18n, { initI18n } from '../lib/i18n'
import { getSavedSettings } from '../lib/settings-storage'
import TabTwoScreen from '../../app/(tabs)/two'

describe('TabTwoScreen', () => {
  beforeAll(async () => {
    await initI18n()
  })

  beforeEach(async () => {
    localStorage.clear()
    analyticsCaptureMock.mockReset()
    loadMobileApiHealthMock.mockReset()
    loadMobileApiHealthMock.mockResolvedValue({ status: 'ok' })
    updatePreferredLocaleMock.mockReset()
    updatePreferredLocaleMock.mockResolvedValue({ success: true })
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders API health loaded from the generated client', async () => {
    loadMobileApiHealthMock.mockResolvedValue({
      status: 'ok',
    })

    await render(<TabTwoScreen />)

    await screen.findByText('API health: ok')
  })

  it('falls back to unavailable when the API health request never resolves', async () => {
    vi.useFakeTimers()
    loadMobileApiHealthMock.mockImplementation(() => new Promise(() => undefined))

    await render(<TabTwoScreen />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(screen.getByText('API health unavailable')).toBeTruthy()
  })

  it('persists, profiles, tracks, and renders a selected locale', async () => {
    await render(<TabTwoScreen />)

    fireEvent.click(screen.getByTestId('locale-btn-tr-TR'))

    await screen.findByText('Ayarlar')
    await waitFor(() => {
      expect(updatePreferredLocaleMock).toHaveBeenCalledWith('tr-TR')
    })
    expect(await getSavedSettings()).toEqual({
      locale: 'tr-TR',
      localeSyncPending: false,
    })
    expect(analyticsCaptureMock).toHaveBeenCalledWith(
      'locale_switched',
      expect.objectContaining({
        user_id: 'test-user-id',
        from_locale: 'en-US',
        to_locale: 'tr-TR',
      })
    )
  })

  it('does not cause layout overflow or text truncation in any locale', async () => {
    loadMobileApiHealthMock.mockResolvedValue({ status: 'ok' })

    const expectedLocales = [
      'en-US',
      'en-CA',
      'es-419',
      'fr-CA',
      'fr-FR',
      'tr-TR',
      'de-DE',
      'it-IT',
      'pt-BR',
      'pt-PT',
    ]

    for (const locale of expectedLocales) {
      await act(async () => {
        await i18n.changeLanguage(locale)
      })

      const { unmount } = await render(<TabTwoScreen />)

      const allElements = document.querySelectorAll('*')
      allElements.forEach((el) => {
        if (el.children.length === 0 && el.textContent && el.textContent.trim()) {
          const scrollWidth = el.scrollWidth
          const clientWidth = el.clientWidth
          expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2)
        }
      })

      unmount()
    }
  })
})
