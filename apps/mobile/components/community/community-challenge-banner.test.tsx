// Learning path Step 38: Community feed by climate band.
// Story 6.1 Task 8 owner: the weekly challenge banner.
import React from 'react'
import { run as runAxe } from 'axe-core'
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { EmbeddedCommunityChallenge } from '@couture/api-client/contracts/http'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

import enUS from '@/assets/locales/en-US.json'
import i18n, { initI18n } from '@/src/lib/i18n'
import { press } from '@/src/test-utils/press'
import { CommunityChallengeBanner } from './community-challenge-banner'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

function challenge(
  overrides: Partial<EmbeddedCommunityChallenge> = {}
): EmbeddedCommunityChallenge {
  return {
    id: 'challenge-autumn',
    slug: 'autumn-layers',
    climateBand: 'temperate_dry',
    title: 'Autumn Layers Challenge',
    body: 'Style your favourite transitional layering pieces for temperate weather.',
    startsAt: '2026-08-31T00:00:00.000Z',
    endsAt: '2026-09-07T00:00:00.000Z',
    timeZone: 'Europe/Istanbul',
    ...overrides,
  }
}

function renderBanner(overrides: Partial<EmbeddedCommunityChallenge> = {}) {
  const onParticipate = vi.fn()
  const utils = render(
    <CommunityChallengeBanner
      challenge={challenge(overrides)}
      onParticipate={onParticipate}
    />
  )
  return { ...utils, onParticipate }
}

describe('CommunityChallengeBanner (Story 6.1)', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  it('6.1-MOB-047 renders the editorial copy the server sent, with the eyebrow', () => {
    renderBanner()

    const banner = screen.getByTestId('community-challenge-banner')
    expect(banner.textContent).toContain(enUS.community.challenge.eyebrow)
    expect(screen.getByTestId('community-challenge-title').textContent).toBe(
      challenge().title
    )
    expect(screen.getByTestId('community-challenge-body').textContent).toBe(
      challenge().body
    )
  })

  it('6.1-MOB-048 labels the band from the one catalogue lookup, both restricted and not', () => {
    const { rerender, onParticipate } = renderBanner()
    // One lookup keyed off the contract's own band values; no Title-Casing here.
    expect(screen.getByTestId('community-challenge-banner').textContent).toContain(
      enUS.community.band.temperate_dry
    )

    rerender(
      <CommunityChallengeBanner
        challenge={challenge({ climateBand: null })}
        onParticipate={onParticipate}
      />
    )
    expect(screen.getByTestId('community-challenge-banner').textContent).toContain(
      enUS.community.challenge.allClimates
    )
  })

  it('6.1-MOB-049 names the challenge in the CTA label and reports the tap', () => {
    const { onParticipate } = renderBanner()

    const cta = screen.getByTestId('community-challenge-cta')
    expect(cta.textContent).toBe(enUS.community.challenge.participate)
    expect(cta.getAttribute('aria-label')).toBe(`Participate in ${challenge().title}`)

    press(cta)
    expect(onParticipate).toHaveBeenCalledTimes(1)
  })

  it('6.1-MOB-050 has no axe violations', async () => {
    const { container } = renderBanner()

    const results = await runAxe(container, {
      runOnly: { type: 'tag', values: AXE_TAGS },
    })

    // Anchors the scan the same way 6.1-MOB-041 does: `violations` is empty for a
    // clean tree and for no tree at all, and `passes` is what separates them.
    expect(results.passes.length, 'axe scanned an empty tree').toBeGreaterThan(0)

    expect(
      results.violations.map((violation) => violation.id),
      JSON.stringify(results.violations, null, 2)
    ).toEqual([])
  })
})
