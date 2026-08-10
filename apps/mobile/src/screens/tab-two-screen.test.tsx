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

const {
  analyticsCaptureMock,
  analyticsDistinctIdMock,
  loadMobileApiHealthMock,
  updatePreferredLocaleMock,
} = vi.hoisted(() => ({
  analyticsCaptureMock: vi.fn(),
  analyticsDistinctIdMock: vi.fn(() => 'test-user-id'),
  loadMobileApiHealthMock: vi.fn(),
  updatePreferredLocaleMock: vi.fn(),
}))

vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: analyticsCaptureMock,
    getDistinctId: analyticsDistinctIdMock,
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
import { setMobileAnalyticsDiagnosticsEnabled } from '../analytics/mobile-analytics-diagnostics'
import SettingsScreen from '../../app/(tabs)/settings'

const SETTINGS_STORAGE_KEY = 'couture-cast-settings.json'

describe('SettingsScreen', () => {
  beforeAll(async () => {
    await initI18n()
  })

  beforeEach(async () => {
    localStorage.clear()
    analyticsCaptureMock.mockReset()
    analyticsDistinctIdMock.mockReturnValue('test-user-id')
    loadMobileApiHealthMock.mockReset()
    loadMobileApiHealthMock.mockResolvedValue({ status: 'ok' })
    updatePreferredLocaleMock.mockReset()
    updatePreferredLocaleMock.mockResolvedValue({ success: true })
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    vi.useRealTimers()
    setMobileAnalyticsDiagnosticsEnabled(false)
  })

  it('renders API health loaded from the generated client', async () => {
    loadMobileApiHealthMock.mockResolvedValue({
      status: 'ok',
    })

    await render(<SettingsScreen />)

    await screen.findByText('API health: ok')
  })

  it('falls back to unavailable when the API health request never resolves', async () => {
    vi.useFakeTimers()
    loadMobileApiHealthMock.mockImplementation(() => new Promise(() => undefined))

    await render(<SettingsScreen />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(screen.getByText('API health unavailable')).toBeTruthy()
  })

  it('persists, profiles, tracks, and renders a selected locale', async () => {
    await render(<SettingsScreen />)

    fireEvent.click(screen.getByTestId('locale-btn-tr-TR'))

    await screen.findByText('Dil')
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

  it('surfaces persistence failures without syncing an unpersisted locale', async () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => {
        throw new Error('storage unavailable')
      })

    try {
      await render(<SettingsScreen />)

      fireEvent.click(screen.getByTestId('locale-btn-tr-TR'))

      await screen.findByText('Unable to change language. Please try again.')
      expect(updatePreferredLocaleMock).not.toHaveBeenCalled()
      expect(i18n.resolvedLanguage).toBe('en-US')
    } finally {
      setItemSpy.mockRestore()
    }
  })

  it('retries a locale sync that was left pending by an earlier session', async () => {
    // A locale change that could not reach the profile API is stored with
    // localeSyncPending so the next launch finishes it; without this the
    // user's profile silently keeps the old language forever.
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ locale: 'tr-TR', localeSyncPending: true })
    )

    await render(<SettingsScreen />)

    await waitFor(() => {
      expect(updatePreferredLocaleMock).toHaveBeenCalledWith('tr-TR')
    })
    expect(await getSavedSettings()).toEqual({
      locale: 'tr-TR',
      localeSyncPending: false,
    })
  })

  it('keeps the pending flag and explains the delay when the startup retry fails', async () => {
    updatePreferredLocaleMock.mockRejectedValue(new Error('profile service down'))
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ locale: 'tr-TR', localeSyncPending: true })
    )

    await render(<SettingsScreen />)

    await screen.findByText(
      'Language changed on this device. Profile sync will retry later.'
    )
    // Still pending, so a later launch tries again rather than dropping it.
    expect(await getSavedSettings()).toEqual({
      locale: 'tr-TR',
      localeSyncPending: true,
    })
  })

  it('applies a language change locally even when the profile sync is rejected', async () => {
    updatePreferredLocaleMock.mockRejectedValue(new Error('profile service down'))

    await render(<SettingsScreen />)

    fireEvent.click(screen.getByTestId('locale-btn-tr-TR'))

    await screen.findByText('Dil')
    await waitFor(async () => {
      // The language is applied and the sync stays queued; asserting on the
      // stored state keeps this independent of the now-Turkish alert copy.
      expect(await getSavedSettings()).toEqual({
        locale: 'tr-TR',
        localeSyncPending: true,
      })
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(i18n.resolvedLanguage).toBe('tr-TR')
  })

  it('falls back to unavailable when the API health request is rejected', async () => {
    loadMobileApiHealthMock.mockRejectedValue(new Error('health endpoint down'))

    await render(<SettingsScreen />)

    await screen.findByText('API health unavailable')
  })

  it('records a weather alert from the diagnostics action when diagnostics are on', async () => {
    // The diagnostics button is the only in-app way to prove the
    // alert_received analytics contract without a real push notification.
    setMobileAnalyticsDiagnosticsEnabled(true)

    await render(<SettingsScreen />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Record weather alert analytics' })
    )

    expect(analyticsCaptureMock).toHaveBeenCalledWith(
      'alert_received',
      expect.objectContaining({
        user_id: 'test-user-id',
        alert_type: 'weather_alert',
      })
    )
  })

  it('attributes analytics to an anonymous id when the session has no distinct id', async () => {
    // A first-run device has no analytics identity yet; events still have to
    // carry a stable user_id or they cannot be funnelled at all.
    analyticsDistinctIdMock.mockReturnValue('')
    setMobileAnalyticsDiagnosticsEnabled(true)

    await render(<SettingsScreen />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Record weather alert analytics' })
    )
    expect(analyticsCaptureMock).toHaveBeenCalledWith(
      'alert_received',
      expect.objectContaining({ user_id: 'mobile-anonymous-user' })
    )

    fireEvent.click(screen.getByTestId('locale-btn-tr-TR'))
    await waitFor(() => {
      expect(analyticsCaptureMock).toHaveBeenCalledWith(
        'locale_switched',
        expect.objectContaining({ user_id: 'mobile-anonymous-user' })
      )
    })
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

      const { container, unmount } = await render(<SettingsScreen />)

      const allElements = container.querySelectorAll('*')
      allElements.forEach((el: Element) => {
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
