// Story 6.6 owner: the City Spotlight module's states, labels and accessibility.
import React from 'react'
import { run as runAxe } from 'axe-core'
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { CommunityReactionSpotlightItem } from '@couture/api-client/contracts/http'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

import i18n, { initI18n } from '@/src/lib/i18n'
import { press } from '@/src/test-utils/press'
import {
  CommunitySpotlightModule,
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

  it('6.6-MOB-020 names the area in a heading and labels every rank', () => {
    renderModule()
    const heading = screen.getByTestId('community-spotlight-heading')
    expect(heading.textContent).toBe('Spotlight in Lisboa')
    expect(heading.getAttribute('role')).toBe('heading')
    expect(
      screen.getByTestId('community-spotlight-rank-spot-2').getAttribute('aria-label')
    ).toBe('Rank 2')
    expect(screen.getByTestId('stub-card-spot-1')).toBeTruthy()
  })

  it('6.6-MOB-021 offers View more only while a next page exists', () => {
    const { props, rerender } = renderModule()
    press(screen.getByTestId('community-spotlight-view-more'))
    expect(props.onViewMore).toHaveBeenCalledTimes(1)
    rerender(<CommunitySpotlightModule {...props} hasMore={false} />)
    expect(screen.queryByTestId('community-spotlight-view-more')).toBeNull()
    rerender(<CommunitySpotlightModule {...props} isLoadingMore />)
    expect(screen.getByTestId('community-spotlight-loading-more').textContent).toContain(
      'Loading more looks'
    )
    expect(screen.queryByTestId('community-spotlight-view-more')).toBeNull()
  })

  it('6.6-MOB-022 keeps loaded cards and offers a retry when the next page fails', () => {
    const { props } = renderModule({ loadMoreFailed: true })
    expect(screen.getByTestId('stub-card-spot-2')).toBeTruthy()
    expect(
      screen.getByTestId('community-spotlight-more-error').getAttribute('role')
    ).toBe('alert')
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
