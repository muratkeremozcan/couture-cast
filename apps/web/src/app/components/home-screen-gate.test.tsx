// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 D3 and D4 test owner: Home's screen gate waits for the member's ritual and, in a
// stacked layout, for the Spotlight teaser inside the hero, and for the City Spotlight above the
// Home feed, so neither lands after the body appeared and pushes the community section down.
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md
// (7.7-CMP-005). The measured budget is 7.7-E2E-001.
import type { RitualResponse } from '@couture/api-client/contracts/http'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { signInFixtureMember } from '../../test-utils/member-session'
import {
  SPOTLIGHT_PATH,
  cityPage,
  respond,
  setupHomeTeaserSuite,
  useServedSpotlight,
} from '../../test-utils/home-spotlight-teaser'
import { screenSnapshot } from '../../lib/screen-snapshot'
import { LookbookPrismLayout } from './lookbook-prism-layout'
import { ScreenGate } from './screen-gate'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
vi.mock('../../lib/community', { spy: true })
vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

const date = '2026-11-25T12:00:00.000Z'

function memberRitual(): RitualResponse {
  return {
    data: {
      weather: {
        locationKey: 'chicago',
        latitude: 41.88,
        longitude: -87.63,
        timezone: 'America/Chicago',
        provider: 'openweather',
        providerUpdatedAt: date,
        fetchedAt: date,
        current: { temperature: 21, condition: 'clear' },
        hourly: Array.from({ length: 48 }, (_, hour) => ({
          forecastAt: new Date(Date.parse(date) + hour * 3_600_000).toISOString(),
          temperature: 21,
          feelsLike: 20,
          precipitationProbability: 0,
          precipitationAmount: 0,
          windSpeed: 4,
          windGust: null,
          condition: 'clear',
          providerWeatherCode: '800',
        })),
        alerts: [],
      },
      outfits: (['morning', 'midday', 'evening'] as const).map((scenario) => ({
        id: `${scenario}-recommendation`,
        scenario,
        garmentIds: ['jacket-id'],
        displayGarments: [{ id: 'jacket-id', category: 'outerwear' }],
        reasoningBadges: [],
        comfortNotes: `${scenario} comfort note`,
        shopThisLook: null,
      })),
      badges: [],
    },
  }
}

/** The ritual answered at once, so a test holds only the read it is about. */
function useAnsweredRitual() {
  useMswHandlers(
    http.get('/api/v1/ritual', () => HttpResponse.json(memberRitual())),
    http.get('/api/v1/locations', () => HttpResponse.json({ data: [] }))
  )
}

function renderHomeGate() {
  return render(
    <ScreenGate screen="home" reads={['ritual', 'teaser', 'spotlight']}>
      <LookbookPrismLayout />
    </ScreenGate>
  )
}

describe('7.7 Home screen gate', () => {
  setupHomeTeaserSuite()

  afterEach(() => {
    document.documentElement.removeAttribute('data-session')
    screenSnapshot.clear()
  })

  it('7.7-CMP-005 opens only after the ritual and the Spotlight teaser have settled', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signInFixtureMember()
    const ritual = Promise.withResolvers<void>()
    useMswHandlers(
      http.get('/api/v1/ritual', async () => {
        await ritual.promise
        return HttpResponse.json(memberRitual())
      }),
      http.get('/api/v1/locations', () => HttpResponse.json({ data: [] }))
    )
    const { answer } = useServedSpotlight()

    render(
      <ScreenGate screen="home" reads={['ritual', 'teaser', 'spotlight']}>
        <LookbookPrismLayout />
      </ScreenGate>
    )
    const gate = screen.getByTestId('screen-gate')
    expect(screen.getByTestId('screen-placeholder')).toBeVisible()
    expect(gate).not.toHaveAttribute('data-ready')

    // The member's outfit lands first: the teaser has not answered, so the body stays hidden.
    ritual.resolve()
    expect(await screen.findByTestId('home-live-outfit')).not.toBeVisible()
    expect(gate).not.toHaveAttribute('data-ready')
    expect(screen.queryByTestId('member-sample-outfit')).toBeNull()

    await answer(0, cityPage())
    await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
    // The teaser is already in place when the body appears.
    expect(screen.getByTestId('home-spotlight-teaser-link')).toBeVisible()
    expect(screen.getByTestId('home-live-outfit')).toBeVisible()
    expect(screen.getByTestId('screen-placeholder')).not.toBeVisible()
  })

  it('7.7-CMP-005 stays closed while the City Spotlight above the feed is unanswered, then opens', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signInFixtureMember()
    useAnsweredRitual()
    // The teaser read answers at once; the community section's own Spotlight read is held.
    const moduleRead = Promise.withResolvers<void>()
    const moduleReads: URL[] = []
    useMswHandlers(
      http.get(SPOTLIGHT_PATH, async ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('surface') === 'home_teaser')
          return respond({ status: 200, body: { data: cityPage() } })
        moduleReads.push(url)
        await moduleRead.promise
        return respond({ status: 200, body: { data: cityPage() } })
      })
    )

    renderHomeGate()
    const gate = screen.getByTestId('screen-gate')

    // Ritual and teaser are in (hidden under the placeholder); the module read is still out.
    expect(await screen.findByTestId('home-live-outfit')).not.toBeVisible()
    expect(await screen.findByTestId('home-spotlight-teaser-link')).not.toBeVisible()
    await waitFor(() => expect(moduleReads).toHaveLength(1))
    expect(gate).not.toHaveAttribute('data-ready')
    expect(screen.getByTestId('screen-placeholder')).toBeVisible()

    moduleRead.resolve()
    await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
    expect(screen.getByTestId('community-spotlight-heading')).toBeVisible()
    expect(screen.getByTestId('home-live-outfit')).toBeVisible()
    expect(screen.getByTestId('screen-placeholder')).not.toBeVisible()
  })
})
