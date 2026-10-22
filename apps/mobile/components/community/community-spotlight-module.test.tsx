// Story 6.6 owner: the City Spotlight module's states, labels and accessibility.
import React from 'react'
import type * as ReactNativeModule from 'react-native'
import { run as runAxe } from 'axe-core'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CommunityReactionSpotlightItem } from '@couture/api-client/contracts/http'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

// The focus cases switch to iOS, where focus moves through a native handle.
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
  CommunitySpotlightModule,
  spotlightCarouselMetrics,
  type CommunitySpotlightModuleProps,
} from './community-spotlight-module'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

function spotlightItem(rank: number): CommunityReactionSpotlightItem {
  return {
    id: `spot-${rank}`,
    caption: null,
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

function renderModule(overrides: Partial<CommunitySpotlightModuleProps> = {}) {
  const props: CommunitySpotlightModuleProps = {
    status: 'ready',
    level: 'region',
    label: 'Lisboa',
    items: [spotlightItem(1), spotlightItem(2)],
    hasMore: true,
    isLoadingMore: false,
    loadMoreFailed: false,
    focusRequest: null,
    onRetry: vi.fn(),
    onViewMore: vi.fn(),
    renderCard: (item) => <p data-testid={`stub-card-${item.id}`}>{item.altText}</p>,
    ...overrides,
  }
  return { ...render(<CommunitySpotlightModule {...props} />), props }
}

describe('CommunitySpotlightModule (Story 6.6)', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
  })

  it('6.6-MOB-020 names the area in a heading and labels every rank', () => {
    renderModule()
    const heading = screen.getByTestId('community-spotlight-heading')
    expect(heading.textContent).toBe('Spotlight in Lisboa')
    expect(heading.getAttribute('role')).toBe('heading')
    expect(
      screen.getByTestId('community-spotlight-rank-spot-2').getAttribute('aria-label')
    ).toBe('Rank 2, Position 2 of 2')
    expect(screen.getByTestId('stub-card-spot-1')).toBeTruthy()
  })

  it('6.6-MOB-025 is a list named by the heading that reads each look as a position of the loaded count', () => {
    // A filtered post leaves a gap in the ranks, so the position is its own count.
    renderModule({ items: [spotlightItem(1), spotlightItem(3), spotlightItem(4)] })
    const heading = screen.getByTestId('community-spotlight-heading')
    const list = screen.getByTestId('community-spotlight-list')
    expect(list.getAttribute('role')).toBe('list')
    expect(heading.id).toBeTruthy()
    expect(list.getAttribute('aria-labelledby')).toBe(heading.id)
    const entries = within(list).getAllByRole('listitem')
    expect(entries.map((entry) => entry.dataset.testid)).toEqual([
      'community-spotlight-item-spot-1',
      'community-spotlight-item-spot-3',
      'community-spotlight-item-spot-4',
    ])
    expect(
      ['spot-1', 'spot-3', 'spot-4'].map((id) =>
        screen.getByTestId(`community-spotlight-rank-${id}`).getAttribute('aria-label')
      )
    ).toEqual([
      'Rank 1, Position 1 of 3',
      'Rank 3, Position 2 of 3',
      'Rank 4, Position 3 of 3',
    ])
    // The visible badge keeps the plain rank.
    expect(screen.getByTestId('community-spotlight-rank-spot-3').textContent).toBe('#3')
  })

  it('6.6-MOB-026 lays the cards out in one horizontal row with View more as its trailing item', () => {
    renderModule({ items: [spotlightItem(1), spotlightItem(2), spotlightItem(3)] })
    const row = screen.getByTestId('community-spotlight-row')
    const list = screen.getByTestId('community-spotlight-list')
    const viewMore = screen.getByTestId('community-spotlight-view-more')
    expect(getComputedStyle(row).overflowX).toMatch(/auto|scroll/)
    expect(row.contains(list)).toBe(true)
    expect(row.contains(viewMore)).toBe(true)
    // Outside the list, so the count read with each card covers the looks alone.
    expect(list.contains(viewMore)).toBe(false)
    expect(
      list.compareDocumentPosition(viewMore) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    const { itemWidth, step } = spotlightCarouselMetrics(window.innerWidth)
    const boxes = ['spot-1', 'spot-2', 'spot-3'].map((id) =>
      screen.getByTestId(`community-spotlight-item-${id}`).getBoundingClientRect()
    )
    // One row: every card shares a top edge and starts one snap step after the last.
    expect(new Set(boxes.map((box) => box.top)).size).toBe(1)
    expect(new Set(boxes.map((box) => Math.round(box.width)))).toEqual(
      new Set([itemWidth])
    )
    expect(Math.round(boxes[1]!.left - boxes[0]!.left)).toBe(step)
    expect(Math.round(boxes[2]!.left - boxes[1]!.left)).toBe(step)
    expect(viewMore.getBoundingClientRect().left).toBeGreaterThan(boxes[2]!.left)
    expect(viewMore.getBoundingClientRect().top).toBeLessThan(boxes[2]!.bottom)
  })

  it('6.6-MOB-027 sizes an item to 85% of the window so the next card peeks, bounded on tablets', () => {
    expect(spotlightCarouselMetrics(390)).toEqual({ itemWidth: 332, step: 316 })
    expect(spotlightCarouselMetrics(320)).toEqual({ itemWidth: 272, step: 256 })
    expect(spotlightCarouselMetrics(1024)).toEqual({ itemWidth: 420, step: 404 })
    // The second card starts inside a phone window: its 16px card inset begins one
    // step in, and at least 40px of it shows.
    for (const width of [320, 375, 390, 430]) {
      const { step } = spotlightCarouselMetrics(width)
      expect(width - (step + 16), `${width}px peek`).toBeGreaterThanOrEqual(40)
    }
  })

  it('6.6-MOB-028 View more scrolls the carousel to the first new card, then focuses its rank', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    const handles = new Map<unknown, number>()
    vi.mocked(findNodeHandle).mockImplementation((node: unknown) => {
      if (!handles.has(node)) handles.set(node, 900 + handles.size)
      return handles.get(node) ?? null
    })
    const { props, rerender } = renderModule()
    const row = screen.getByTestId('community-spotlight-row')
    const scroll = vi.spyOn(row, 'scroll')
    press(screen.getByTestId('community-spotlight-view-more'))
    expect(props.onViewMore).toHaveBeenCalledTimes(1)

    const items = [1, 2, 3, 4].map(spotlightItem)
    rerender(
      <CommunitySpotlightModule
        {...props}
        items={items}
        hasMore={false}
        focusRequest={{ kind: 'appended', firstId: 'spot-3', count: 2, serial: 1 }}
      />
    )
    const rank = screen.getByTestId('community-spotlight-rank-spot-3')
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(
        handles.get(rank)
      )
    )
    const { step } = spotlightCarouselMetrics(window.innerWidth)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll).toHaveBeenCalledWith({ left: 2 * step, top: 0, behavior: 'smooth' })
    expect(scroll.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(AccessibilityInfo.setAccessibilityFocus).mock.invocationCallOrder[0]!
    )
    expect(
      vi
        .mocked(AccessibilityInfo.announceForAccessibility)
        .mock.calls.filter(([text]) => text === 'Loaded 2 more spotlight looks.')
    ).toHaveLength(1)
    expect(rank.getAttribute('aria-label')).toBe('Rank 3, Position 3 of 4')

    // A re-render with the same request neither scrolls nor announces again.
    rerender(
      <CommunitySpotlightModule
        {...props}
        items={items}
        hasMore={false}
        focusRequest={{ kind: 'appended', firstId: 'spot-3', count: 2, serial: 1 }}
        isLoadingMore={false}
      />
    )
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1)
  })

  it('6.6-MOB-029 a refreshed spotlight scrolls the carousel back to its first card', async () => {
    const { props, rerender } = renderModule()
    const scroll = vi.spyOn(screen.getByTestId('community-spotlight-row'), 'scroll')
    rerender(
      <CommunitySpotlightModule
        {...props}
        items={[spotlightItem(1)]}
        hasMore={false}
        focusRequest={{ kind: 'refreshed', firstId: 'spot-1', serial: 4 }}
      />
    )
    await waitFor(() =>
      expect(scroll).toHaveBeenCalledWith({ left: 0, top: 0, behavior: 'smooth' })
    )
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'The City Spotlight was refreshed with the latest ranking.'
    )
  })

  it('6.6-MOB-021 offers View more only while a next page exists', () => {
    const { props, rerender } = renderModule()
    press(screen.getByTestId('community-spotlight-view-more'))
    expect(props.onViewMore).toHaveBeenCalledTimes(1)
    rerender(<CommunitySpotlightModule {...props} hasMore={false} />)
    expect(screen.queryByTestId('community-spotlight-view-more')).toBeNull()
    rerender(<CommunitySpotlightModule {...props} isLoadingMore />)
    const loadingMore = screen.getByTestId('community-spotlight-loading-more')
    expect(loadingMore.textContent).toContain('Loading more looks')
    // The loading state takes View more's place at the end of the row.
    expect(screen.getByTestId('community-spotlight-row').contains(loadingMore)).toBe(true)
    expect(screen.queryByTestId('community-spotlight-view-more')).toBeNull()
  })

  it('6.6-MOB-075 a ranked level whose last card left shows the empty state only once no page remains', () => {
    const { props, rerender } = renderModule({ level: 'city', items: [], hasMore: false })
    expect(screen.getByTestId('community-spotlight-empty').textContent).toContain(
      'No spotlight near you yet'
    )
    expect(screen.queryByTestId('community-spotlight-row')).toBeNull()

    // A next page can still reach ranked looks, so View more stays in place of the empty state.
    rerender(<CommunitySpotlightModule {...props} hasMore />)
    expect(screen.queryByTestId('community-spotlight-empty')).toBeNull()
    expect(screen.getByTestId('community-spotlight-view-more')).toBeVisible()
  })

  it('6.6-MOB-022 keeps loaded cards and offers a retry when the next page fails', () => {
    const { props } = renderModule({ loadMoreFailed: true })
    expect(screen.getByTestId('stub-card-spot-2')).toBeTruthy()
    const moreError = screen.getByTestId('community-spotlight-more-error')
    expect(moreError.getAttribute('role')).toBe('alert')
    expect(screen.getByTestId('community-spotlight-row').contains(moreError)).toBe(true)
    press(screen.getByTestId('community-spotlight-more-retry'))
    expect(props.onViewMore).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['loading', 'community-spotlight-loading', 'Loading the City Spotlight'],
    [
      'disabled',
      'community-spotlight-disabled',
      'The City Spotlight is temporarily unavailable.',
    ],
    ['error', 'community-spotlight-error', 'We could not load the City Spotlight.'],
  ] as const)(
    '6.6-MOB-023 renders the %s state with its own copy',
    (status, testId, copy) => {
      renderModule({ status, label: null, items: [] })
      expect(screen.getByTestId(testId).textContent).toContain(copy)
      expect(screen.getByTestId('community-spotlight-heading').textContent).toBe(
        'City Spotlight'
      )
      expect(screen.queryByTestId('community-spotlight-list')).toBeNull()
    }
  )

  it('6.6-MOB-024 has no axe violations with ranked cards', async () => {
    const { container } = renderModule()
    const results = await runAxe(container, {
      runOnly: { type: 'tag', values: AXE_TAGS },
    })
    expect(results.passes.length, 'axe scanned an empty tree').toBeGreaterThan(0)
    expect(
      results.violations.map((violation) => violation.id),
      JSON.stringify(results.violations, null, 2)
    ).toEqual([])
  })
})
