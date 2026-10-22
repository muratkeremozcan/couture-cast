/* eslint-disable @typescript-eslint/await-thenable */
// Story 6.6 R20: the spotlight detail moves screen-reader focus to its title and
// announces the change once per open. The behavior lives in the Modal's
// `onShow`, which react-native-web fires after the slide-in animation ends, so
// this suite runs the real Modal in the browser and waits for that callback.
import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ReactNativeModule from 'react-native'
import type { CommunityReactionSpotlightItem } from '@couture/api-client/contracts/http'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      announceForAccessibility: vi.fn(),
      setAccessibilityFocus: vi.fn(),
    },
    findNodeHandle: vi.fn(),
    Platform: { ...actual.Platform, OS: 'web' },
  }
})

import { AccessibilityInfo, Platform, findNodeHandle } from 'react-native'
import i18n, { initI18n } from '@/src/lib/i18n'
import { press } from '@/src/test-utils/press'
import {
  CommunitySpotlightDetail,
  type CommunitySpotlightDetailProps,
} from '@/components/community/community-spotlight-detail'

const FOCUSED = 'Focused on the highlighted look.'
const TITLE_HANDLE = 901

function look(rank: number): CommunityReactionSpotlightItem {
  return {
    id: `spot-${rank}`,
    caption: `Spotlight caption ${rank}`,
    altText: `Spotlight look ${rank}`,
    climateBand: null,
    imageAccess: {
      url: 'https://storage.test/x.png',
      expiresAt: '2030-01-01T00:00:00.000Z',
    },
    publishedAt: '2026-10-22T10:00:00.000Z',
    createdAt: '2026-10-22T09:00:00.000Z',
    status: 'published',
    challengeId: null,
    author: { displayName: 'Style Explorer', isSelf: false },
    rank,
  }
}

function Harness(props: Partial<CommunitySpotlightDetailProps>) {
  return (
    <CommunitySpotlightDetail
      item={null}
      onClose={vi.fn()}
      renderCard={(item) => <p data-testid={`stub-card-${item.id}`}>{item.altText}</p>}
      {...props}
    />
  )
}

function focusedAnnouncements() {
  return vi
    .mocked(AccessibilityInfo.announceForAccessibility)
    .mock.calls.filter(([text]) => text === FOCUSED)
}

describe('CommunitySpotlightDetail focus and announcement (Story 6.6 R20)', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    // Only the detail's title resolves to a native handle, so a focus call that
    // lands anywhere else shows up as a different argument.
    vi.mocked(findNodeHandle).mockImplementation((node: unknown) =>
      node instanceof HTMLElement &&
      node.getAttribute('data-testid') === 'community-spotlight-detail-title'
        ? TITLE_HANDLE
        : 5
    )
  })

  it('6.6-MOB-040 opening moves focus to the detail title and announces the change once', async () => {
    await render(<Harness item={look(2)} />)

    const title = await screen.findByTestId('community-spotlight-detail-title')
    expect(title.getAttribute('role')).toBe('heading')
    expect(screen.getByTestId('community-spotlight-detail-rank').textContent).toBe(
      'Rank 2'
    )
    expect(screen.getByTestId('stub-card-spot-2')).toBeVisible()
    await waitFor(() => expect(focusedAnnouncements()).toHaveLength(1))
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(TITLE_HANDLE)
    )
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledTimes(1)
  })

  it('6.6-MOB-041 an update to the open look neither re-announces nor moves focus again', async () => {
    const view = await render(<Harness item={look(2)} />)
    await waitFor(() => expect(focusedAnnouncements()).toHaveLength(1))
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledTimes(1)
    )

    // A reaction or realtime refresh hands the sheet a new object for the same look.
    await view.rerender(<Harness item={{ ...look(2), caption: 'Updated caption' }} />)
    expect(
      (await screen.findByTestId('community-spotlight-detail-title')).textContent
    ).toBe('City Spotlight')
    expect(focusedAnnouncements()).toHaveLength(1)

    // Sentinel: a real reopen must add exactly one announcement and one focus. A
    // stray onShow from the update above would land first and make either count 3.
    await view.rerender(<Harness item={null} />)
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-detail-title')).toBeNull()
    )
    await view.rerender(<Harness item={look(3)} />)
    await waitFor(() => expect(focusedAnnouncements()).toHaveLength(2))
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledTimes(2)
    )
    expect(focusedAnnouncements()).toHaveLength(2)
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledTimes(2)
  })

  it('6.6-MOB-042 every reopen announces and focuses once more, never twice', async () => {
    const onClose = vi.fn()
    const view = await render(<Harness item={look(1)} onClose={onClose} />)
    await waitFor(() => expect(focusedAnnouncements()).toHaveLength(1))

    press(screen.getByTestId('community-spotlight-detail-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
    await view.rerender(<Harness item={null} onClose={onClose} />)
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-detail-title')).toBeNull()
    )

    await view.rerender(<Harness item={look(3)} onClose={onClose} />)
    expect(
      (await screen.findByTestId('community-spotlight-detail-rank')).textContent
    ).toBe('Rank 3')
    await waitFor(() => expect(focusedAnnouncements()).toHaveLength(2))
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledTimes(2)
    )
    expect(
      vi
        .mocked(AccessibilityInfo.setAccessibilityFocus)
        .mock.calls.every(([handle]) => handle === TITLE_HANDLE)
    ).toBe(true)
  })

  it('6.6-MOB-043 on web it announces once and never asks for a native handle', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
    await render(<Harness item={look(4)} />)

    await screen.findByTestId('community-spotlight-detail-title')
    await waitFor(() => expect(focusedAnnouncements()).toHaveLength(1))
    expect(findNodeHandle).not.toHaveBeenCalled()
    expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled()
  })

  it('6.6-MOB-044 the back control is a labelled button that closes the sheet', async () => {
    const onClose = vi.fn()
    await render(<Harness item={look(5)} onClose={onClose} />)
    const close = await screen.findByTestId('community-spotlight-detail-close')
    expect(close.getAttribute('role')).toBe('button')
    expect(close.getAttribute('aria-label')).toBe('Back')
    press(close)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
