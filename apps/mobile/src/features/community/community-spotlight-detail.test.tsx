// Learning path Step 44: Community city spotlight.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-44-community-city-spotlight
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-NAT-030, 7.11-NAT-032, 7.11-NAT-033 for the post detail
// layer (D12): its header is the app top bar with back and the title, and back, system back and a
// header swipe close it. Focus back to the card is the Community screen's (spotlight.cases.tsx).
// Codex 7.11 #10: the same layer serves a regular feed post (`community-post-detail`, no rank),
// its top bar reads the post's own title, and closing hands accessibility focus to the opener.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
// Story 6.6 R20: the spotlight detail moves screen-reader focus to its title and
// announces the change once per open. The behavior lives in the Modal's
// `onShow`, which react-native-web fires after the slide-in animation ends, so
// this suite runs the real Modal in the browser and waits for that callback.
import React from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ReactNativeModule from 'react-native'
import type * as EdgeToEdgeTestUtils from '@/src/test-utils/edge-to-edge-modal'
import type { CommunityReactionSpotlightItem } from '@couture/api-client/contracts/http'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('react-native-safe-area-context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { TEST_SAFE_AREA_INSETS } = await vi.importActual<typeof EdgeToEdgeTestUtils>(
    '@/src/test-utils/edge-to-edge-modal'
  )
  return { ...actual, useSafeAreaInsets: () => TEST_SAFE_AREA_INSETS }
})
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  const { recordModalProps } = await vi.importActual<typeof EdgeToEdgeTestUtils>(
    '@/src/test-utils/edge-to-edge-modal'
  )
  return {
    ...actual,
    Modal: recordModalProps(actual.Modal),
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
import { dragFrom } from '@/src/test-utils/layer-swipe'
import {
  CommunitySpotlightDetail,
  type CommunitySpotlightDetailProps,
} from '@/components/community/community-spotlight-detail'
import {
  EDGE_TO_EDGE_MODAL_PROPS,
  TEST_SAFE_AREA_INSETS,
  lastModalProps,
  paddingBottomOf,
  paddingTopOf,
  liveFontMarkerPlacement,
} from '@/src/test-utils/edge-to-edge-modal'
import { LAYER_SWIPE_CLOSE_PX } from '@/components/edge-to-edge-modal'

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
    // Only the detail's title (Story CC-7.11 D12: the top bar title) resolves to a native
    // handle, so a focus call that lands anywhere else shows up as a different argument.
    vi.mocked(findNodeHandle).mockImplementation((node: unknown) =>
      node instanceof HTMLElement &&
      node.getAttribute('data-testid') === 'app-top-bar-title' &&
      node.closest('[data-testid="community-spotlight-detail"]') !== null
        ? TITLE_HANDLE
        : 5
    )
  })

  it('6.6-MOB-040 opening moves focus to the detail title and announces the change once', async () => {
    await render(<Harness item={look(2)} />)

    const title = within(
      await screen.findByTestId('community-spotlight-detail')
    ).getByTestId('app-top-bar-title')
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
      within(await screen.findByTestId('community-spotlight-detail')).getByTestId(
        'app-top-bar-title'
      ).textContent
    ).toBe('City Spotlight')
    expect(focusedAnnouncements()).toHaveLength(1)

    // Sentinel: a real reopen must add exactly one announcement and one focus. A
    // stray onShow from the update above would land first and make either count 3.
    await view.rerender(<Harness item={null} />)
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-detail')).toBeNull()
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

    press(screen.getByTestId('app-top-bar-back'))
    expect(onClose).toHaveBeenCalledTimes(1)
    await view.rerender(<Harness item={null} onClose={onClose} />)
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-detail')).toBeNull()
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

    await screen.findByTestId('community-spotlight-detail')
    await waitFor(() => expect(focusedAnnouncements()).toHaveLength(1))
    expect(findNodeHandle).not.toHaveBeenCalled()
    expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled()
  })

  it('6.6-MOB-044 [7.11-NAT-030] the header is the app top bar, inside the swipe handle, whose back arrow is a labelled button that closes the layer', async () => {
    const onClose = vi.fn()
    await render(<Harness item={look(5)} onClose={onClose} />)
    const detail = await screen.findByTestId('community-spotlight-detail')
    const handle = within(detail).getByTestId('layer-swipe-handle')
    const bar = within(handle).getByTestId('app-top-bar')
    expect(handle.parentElement).toBe(detail)
    const back = within(bar).getByTestId('app-top-bar-back')
    expect(back.getAttribute('role')).toBe('button')
    expect(back.getAttribute('aria-label')).toBe('Back')
    expect(within(bar).getByTestId('app-top-bar-title')).toHaveTextContent(
      'City Spotlight'
    )
    // The back arrow replaced the old close control: it is the layer's only button here.
    expect(within(detail).getAllByRole('button')).toEqual([back])
    press(back)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('[7.11-NAT-030] system back (the Modal close request) closes the layer', async () => {
    const onClose = vi.fn()
    await render(<Harness item={look(5)} onClose={onClose} />)
    await screen.findByTestId('community-spotlight-detail')
    // react-native-web calls the Modal's onRequestClose on Escape, as Android does on back.
    fireEvent.keyUp(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('[7.11-NAT-032] [7.11-NAT-033] a swipe down on the top bar closes the layer; a short one does not', async () => {
    const onClose = vi.fn()
    await render(<Harness item={look(5)} onClose={onClose} />)
    const detail = await screen.findByTestId('community-spotlight-detail')
    const title = within(detail).getByTestId('app-top-bar-title')

    await dragFrom(title, { dy: LAYER_SWIPE_CLOSE_PX / 2 })
    expect(onClose).not.toHaveBeenCalled()

    // A drag on the body is a scroll, never a close.
    await dragFrom(within(detail).getByTestId('layer-body'), {
      dy: LAYER_SWIPE_CLOSE_PX + 40,
    })
    expect(onClose).not.toHaveBeenCalled()

    await dragFrom(title, { dy: LAYER_SWIPE_CLOSE_PX + 40 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('[Codex 7.11 #10] CommunitySpotlightDetail for any post (D12, D13)', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  it.each([
    ['its own title', 'Charcoal commute', 'Charcoal commute'],
    ['the fallback for a blank title', '   ', 'Shared look'],
    ['the fallback for no title', null, 'Shared look'],
  ] as const)(
    '[Codex 7.11 #10] [7.11-NAT-030] a feed post detail reads %s in its top bar and shows no rank',
    async (_name, title, shown) => {
      await render(
        <CommunitySpotlightDetail
          testID="community-post-detail"
          item={{ id: 'post-a', title }}
          onClose={vi.fn()}
          fallbackTitle="Shared look"
          renderCard={(post) => <p data-testid={`stub-card-${post.id}`}>{post.id}</p>}
        />
      )
      const detail = await screen.findByTestId('community-post-detail')
      expect(within(detail).getByTestId('app-top-bar-title').textContent).toBe(shown)
      expect(within(detail).getByTestId('stub-card-post-a')).toBeVisible()
      expect(within(detail).queryByTestId('community-spotlight-detail-rank')).toBeNull()
      expect(screen.queryByTestId('community-spotlight-detail')).toBeNull()
    }
  )

  it('[Codex 7.11 #10] a titled Spotlight look reads its title over the Spotlight label, with its rank', async () => {
    await render(<Harness item={{ ...look(2), title: 'Rain shell' }} />)
    const detail = await screen.findByTestId('community-spotlight-detail')
    expect(within(detail).getByTestId('app-top-bar-title').textContent).toBe('Rain shell')
    expect(
      within(detail).getByTestId('community-spotlight-detail-rank').textContent
    ).toBe('Rank 2')
  })

  it('[Codex 7.11 #10] [7.11-NAT-031] closing hands accessibility focus to the opener it was given', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    const OPENER_HANDLE = 902
    const opener = document.createElement('button')
    document.body.append(opener)
    vi.mocked(findNodeHandle).mockImplementation((node: unknown) =>
      node === opener ? OPENER_HANDLE : 5
    )
    const returnFocusRef = { current: opener }
    try {
      const view = await render(
        <Harness item={look(2)} returnFocusRef={returnFocusRef} />
      )
      await screen.findByTestId('community-spotlight-detail')
      vi.mocked(AccessibilityInfo.setAccessibilityFocus).mockClear()

      await view.rerender(<Harness item={null} returnFocusRef={returnFocusRef} />)

      await waitFor(() =>
        expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenLastCalledWith(
          OPENER_HANDLE
        )
      )
    } finally {
      opener.remove()
    }
  })
})

describe('R52 CommunitySpotlightDetail over the system bars', () => {
  // Story 6.15 review P3-1: iOS hides every view outside the accessibility modal view from the
  // XCUITest hierarchy, so the modal's live-font marker must sit inside it.
  it('puts the live-font marker inside the detail that is the accessibility modal', async () => {
    await render(<Harness item={look(1)} />)
    expect(liveFontMarkerPlacement().markerInside).toBe(true)
  })

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  // Story CC-7.11 D12: a full-height opaque layer, no longer a sheet over a scrim. The top bar
  // keeps its content under the status bar and the layer keeps it above the gesture bar.
  it('covers the status and navigation bars as an opaque full-height layer, clear of both bars', async () => {
    await render(<Harness item={look(1)} />)
    expect(lastModalProps()).toMatchObject({
      ...EDGE_TO_EDGE_MODAL_PROPS,
      transparent: false,
      visible: true,
    })
    const detail = screen.getByTestId('community-spotlight-detail')
    expect(paddingBottomOf(detail)).toBe(TEST_SAFE_AREA_INSETS.bottom)
    expect(paddingTopOf(within(detail).getByTestId('app-top-bar'))).toBe(
      TEST_SAFE_AREA_INSETS.top
    )
    expect(getComputedStyle(detail).flexGrow).toBe('1')
  })
})
