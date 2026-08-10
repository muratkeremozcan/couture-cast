import type * as ReactNativeModule from 'react-native'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AccessibilityInfo, Platform } from 'react-native'
import type { AccessibilityAnnouncementEvent } from '@couture/utils'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

/** Held on a plain object so assertions never reference an unbound method. */
const accessibilityInfo = vi.hoisted(() => ({
  announceForAccessibility: vi.fn<(message: string) => void>(),
  announceForAccessibilityWithOptions:
    vi.fn<(message: string, options: { queue: boolean }) => void>(),
}))

/**
 * `Platform.OS` is redefined per test, so `Platform` has to be a plain object
 * rather than the frozen react-native-web export.
 */
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    AccessibilityInfo: { ...actual.AccessibilityInfo, ...accessibilityInfo },
    Platform: { ...actual.Platform, OS: 'web' },
  }
})

import i18n, { initI18n } from '@/src/lib/i18n'
import {
  AccessibilityAnnouncerProvider,
  useAccessibilityAnnouncer,
} from './use-accessibility-announcer'

type Announce = (event: AccessibilityAnnouncementEvent, details: string) => void

let announce: Announce

function CaptureAnnounce() {
  announce = useAccessibilityAnnouncer().announce
  return null
}

function renderAnnouncer() {
  render(
    <AccessibilityAnnouncerProvider>
      <CaptureAnnounce />
    </AccessibilityAnnouncerProvider>
  )
}

function liveRegionText() {
  return document.getElementById('a11y-live-announcer')?.textContent ?? null
}

describe('AccessibilityAnnouncerProvider', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
  })

  it('prefixes a refresh announcement with its localized lead-in', async () => {
    renderAnnouncer()

    act(() => announce('refresh', 'Sunny and mild'))

    await waitFor(() => {
      expect(liveRegionText()).toBe('Daily guidance updated: Sunny and mild')
    })
  })

  /** A detail-free swap still has to say something, not trail a bare colon. */
  it('announces a swap with no details as the lead-in alone', async () => {
    renderAnnouncer()

    act(() => announce('swap', '   '))

    await waitFor(() => {
      expect(liveRegionText()).toBe('Garment swapped')
    })
  })

  it('interpolates the chip name into a chip-change announcement', async () => {
    renderAnnouncer()

    act(() => announce('chip_change', 'Community'))

    await waitFor(() => {
      expect(liveRegionText()).toBe('Showing Community recommendations')
    })
  })

  it('marks a severe-weather alert as an assertive live region', async () => {
    renderAnnouncer()

    act(() => announce('alert', 'Flood warning'))

    await waitFor(() => {
      expect(liveRegionText()).toBe('Severe weather alert: Flood warning')
    })
    expect(document.getElementById('a11y-live-announcer')).toHaveAttribute(
      'aria-live',
      'assertive'
    )
  })

  it('announces feedback politely and verbatim', async () => {
    renderAnnouncer()

    act(() => announce('feedback', 'Height: 55'))

    await waitFor(() => {
      expect(liveRegionText()).toBe('Height: 55')
    })
    expect(document.getElementById('a11y-live-announcer')).toHaveAttribute(
      'aria-live',
      'polite'
    )
  })

  /** A future event kind must still reach the user rather than announce nothing. */
  it('passes an unrecognised event kind through unchanged', async () => {
    renderAnnouncer()

    act(() =>
      announce('surprise' as AccessibilityAnnouncementEvent, 'Something happened')
    )

    await waitFor(() => {
      expect(liveRegionText()).toBe('Something happened')
    })
  })

  it('says nothing when there is nothing to say', async () => {
    renderAnnouncer()

    act(() => announce('feedback', '   '))

    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(document.getElementById('a11y-live-announcer')).toBeNull()
  })

  /**
   * Errors are assertive and interrupt the reader. A polite message arriving in
   * the same debounce window must not steal that slot.
   */
  it('drops a polite announcement queued behind a pending assertive one', async () => {
    renderAnnouncer()

    act(() => {
      announce('error', 'Save failed')
      announce('feedback', 'Saved')
    })

    await waitFor(() => {
      expect(liveRegionText()).toBe('Save failed')
    })
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(liveRegionText()).toBe('Save failed')
  })

  it('keeps the newest announcement when two arrive in the same window', async () => {
    renderAnnouncer()

    act(() => {
      announce('feedback', 'First')
      announce('feedback', 'Second')
    })

    await waitFor(() => {
      expect(liveRegionText()).toBe('Second')
    })
  })

  describe('native announcements', () => {
    it('routes to the plain Android announcement API', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
      renderAnnouncer()

      act(() => announce('feedback', 'Saved'))

      await waitFor(() => {
        expect(accessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Saved')
      })
      // The DOM live region is web-only; on native the OS owns the announcement.
      expect(document.getElementById('a11y-live-announcer')).toBeNull()
    })

    /** VoiceOver queues polite announcements and interrupts for assertive ones. */
    it.each([
      ['feedback' as const, 'Saved', true],
      ['error' as const, 'Save failed', false],
    ])('queues a %s announcement on iOS as queue=%s', async (event, details, queue) => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
      renderAnnouncer()

      act(() => announce(event, details))

      await waitFor(() => {
        expect(
          accessibilityInfo.announceForAccessibilityWithOptions
        ).toHaveBeenCalledWith(details, { queue })
      })
      expect(accessibilityInfo.announceForAccessibility).not.toHaveBeenCalled()
    })

    it('falls back to the plain API on an iOS build without the options variant', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
      Object.defineProperty(AccessibilityInfo, 'announceForAccessibilityWithOptions', {
        value: undefined,
        configurable: true,
      })
      renderAnnouncer()

      act(() => announce('feedback', 'Saved'))

      await waitFor(() => {
        expect(accessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Saved')
      })
      Object.defineProperty(AccessibilityInfo, 'announceForAccessibilityWithOptions', {
        value: accessibilityInfo.announceForAccessibilityWithOptions,
        configurable: true,
      })
    })
  })
})
