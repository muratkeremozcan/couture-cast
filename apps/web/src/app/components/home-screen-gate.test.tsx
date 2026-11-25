// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 D3 and D4 test owner: Home's screen gate waits for the member's ritual and, in a
// stacked layout, for the Spotlight teaser inside the hero, and for the City Spotlight above the
// Home feed, so neither lands after the body appeared and pushes the community section down.
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md
// (7.7-CMP-005). The measured budget is 7.7-E2E-001.
// Codex review of 8327b4fb: 7.7-CMP-016 pins the city line inside the gate and the refresh
// notice that never lands above the outfit (P2-4), 7.7-CMP-017 the teaser in a return's first
// frame (P2-4), 7.7-CMP-018 a fixture bearer switch while the ritual read is out (P2-1).
// CodeRabbit round 1 on PR 292: 7.7-CMP-042 the ritual snapshot waits for the city line (#9),
// 7.7-CMP-043 an expired remembered teaser is never shown (#10). CI real-session on 61d7156e:
// 7.7-CMP-044 the hero stays outside the gate (L-10).
import type { RitualResponse, SavedLocation } from '@couture/api-client/contracts/http'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { createWeatherAlertPolledEvent } from '@couture/api-client/testing/deep-link-events'
import { http, HttpResponse } from 'msw'
import { useLayoutEffect } from 'react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/browser-persistence'
import { currentWebSessionScope } from '../../lib/use-web-session'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { signInFixtureMember } from '../../test-utils/member-session'
import {
  SPOTLIGHT_PATH,
  cityPage,
  respond,
  setupHomeTeaserSuite,
  useServedSpotlight,
} from '../../test-utils/home-spotlight-teaser'
import { HOME_TEASER_SNAPSHOT_PART, screenSnapshot } from '../../lib/screen-snapshot'
import { SPOTLIGHT_TEASER_EXPIRY_MS } from '@couture/api-client'
import Home from '../page'
import { LookbookPrismLayout } from './lookbook-prism-layout'
import { ScreenGate } from './screen-gate'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
vi.mock('../../lib/community', { spy: true })
vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

const date = '2026-11-25T12:00:00.000Z'

function memberRitual(comfort = 'comfort note'): RitualResponse {
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
        comfortNotes: `${scenario} ${comfort}`,
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

const chicagoHome: SavedLocation = {
  id: 'saved-home',
  label: 'Chicago home',
  locationKey: 'chicago',
  latitude: 41.88,
  longitude: -87.63,
  timezone: 'America/Chicago',
  city: 'Chicago',
  region: 'Illinois',
  country: 'US',
  isPrimary: true,
  sortOrder: 0,
  createdAt: date,
  updatedAt: date,
}

/** Home's gate reads, as `app/page.tsx` lists them (the deep link is answered at once here). */
const HOME_READS = ['ritual', 'teaser', 'spotlight', 'deeplink']

/** What the first commit of a mount holds, read in a layout effect before any paint. */
function FirstCommitProbe({ seen }: { seen: string[] }) {
  useLayoutEffect(() => {
    for (const id of ['home-live-outfit', 'home-spotlight-teaser-link'])
      if (document.querySelector(`[data-testid="${id}"]`)) seen.push(id)
  }, [seen])
  return null
}

function renderHomeGate(seen?: string[]) {
  return render(
    <ScreenGate screen="home" reads={HOME_READS}>
      <LookbookPrismLayout />
      {seen && <FirstCommitProbe seen={seen} />}
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

    renderHomeGate()
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

  it('7.7-CMP-016 waits for the city line, so the outfit header is complete when the body appears', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signInFixtureMember()
    const locations = Promise.withResolvers<void>()
    useMswHandlers(
      http.get('/api/v1/ritual', () => HttpResponse.json(memberRitual())),
      http.get('/api/v1/locations', async () => {
        await locations.promise
        return HttpResponse.json({ data: [chicagoHome] })
      })
    )
    const { answer } = useServedSpotlight()
    renderHomeGate()
    const gate = screen.getByTestId('screen-gate')
    await answer(0, cityPage())

    // The outfit is in, its city line is not: the body stays hidden.
    expect(await screen.findByTestId('home-live-outfit')).not.toBeVisible()
    expect(gate).not.toHaveAttribute('data-ready')

    locations.resolve()
    await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
    expect(
      within(screen.getByTestId('home-live-outfit')).getByText('Chicago home')
    ).toBeVisible()
  })

  it('7.7-CMP-016 a refresh that fails on a return keeps the outfit and lays its notice over it, inserting nothing above', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signInFixtureMember()
    let refreshFails = false
    useMswHandlers(
      http.get('/api/v1/ritual', () =>
        refreshFails
          ? HttpResponse.json({ message: 'Unavailable' }, { status: 503 })
          : HttpResponse.json(memberRitual())
      ),
      http.get('/api/v1/locations', () => HttpResponse.json({ data: [chicagoHome] }))
    )
    const { answer } = useServedSpotlight()
    const firstVisit = renderHomeGate()
    await answer(0, cityPage())
    await waitFor(() =>
      expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
    )
    firstVisit.unmount()

    refreshFails = true
    renderHomeGate()
    const outfit = screen.getByTestId('home-live-outfit')
    expect(outfit).toBeVisible()

    const notice = await screen.findByTestId('home-outfit-refresh-failed')
    expect(within(notice).getByTestId('home-outfit-retry')).toBeVisible()
    // Nothing was inserted before the outfit: the notice is an overlay after it.
    expect(outfit.previousElementSibling).toBeNull()
    expect(
      outfit.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(within(outfit).getByText('Chicago home')).toBeVisible()
  })

  it('7.7-CMP-017 a return to Home has the remembered teaser in its first frame', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signInFixtureMember()
    useAnsweredRitual()
    const { answer, teaserReads } = useServedSpotlight()
    const firstVisit = renderHomeGate()
    await answer(0, cityPage())
    await waitFor(() =>
      expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
    )
    expect(screen.getByTestId('home-spotlight-teaser-link')).toBeVisible()
    firstVisit.unmount()

    // The return: the teaser's own read is left unanswered.
    const firstCommit: string[] = []
    renderHomeGate(firstCommit)

    expect(firstCommit).toEqual(['home-live-outfit', 'home-spotlight-teaser-link'])
    expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
    expect(screen.getByTestId('home-spotlight-teaser-link')).toBeVisible()
    await waitFor(() => expect(teaserReads.length).toBeGreaterThan(1))
    expect(screen.getByTestId('home-spotlight-teaser-link')).toBeVisible()
  })

  it('7.7-CMP-018 a ritual read sent with one fixture bearer never lands for the next, on screen or in the snapshot', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signInFixtureMember('test-token-a')
    const heldForA = Promise.withResolvers<void>()
    const bearers: (string | null)[] = []
    useMswHandlers(
      http.get('/api/v1/ritual', async ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        if (bearer === 'Bearer test-token-a') {
          await heldForA.promise
          return HttpResponse.json(memberRitual('fixture A'))
        }
        return HttpResponse.json(memberRitual('fixture B'))
      }),
      http.get('/api/v1/locations', () => HttpResponse.json({ data: [] }))
    )
    const { answer } = useServedSpotlight()
    renderHomeGate()
    await waitFor(() => expect(bearers).toEqual(['Bearer test-token-a']))

    // The tab switches fixture members while A's read is still out (one owner, two bearers).
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-b')
    await act(async () => {
      heldForA.resolve()
      await heldForA.promise
    })
    await answer(0, cityPage())

    expect(await screen.findByText('morning fixture B')).toBeInTheDocument()
    expect(screen.queryByText('morning fixture A')).toBeNull()
    expect(bearers).toEqual(['Bearer test-token-a', 'Bearer test-token-b'])
    await waitFor(() =>
      expect(
        screenSnapshot.recall<{ ritual: { outfits: { comfortNotes: string }[] } }>(
          currentWebSessionScope(),
          'home',
          'ritual'
        )?.ritual.outfits[0]?.comfortNotes
      ).toBe('morning fixture B')
    )
  })

  it('7.7-CMP-021 a severe-alert deep link takes focus once the gate opens, not while it hides the alert (CodeRabbit r1 #8)', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signInFixtureMember()
    window.history.replaceState(
      null,
      '',
      '/?source=notification&type=severe_weather&alertId=alert-777'
    )
    onTestFinished(() => window.history.replaceState(null, '', '/'))
    const ritual = Promise.withResolvers<void>()
    useMswHandlers(
      http.get('/api/v1/ritual', async () => {
        await ritual.promise
        return HttpResponse.json(memberRitual())
      }),
      http.get('/api/v1/locations', () => HttpResponse.json({ data: [] })),
      http.get('/api/v1/events/poll', () =>
        HttpResponse.json({
          events: [createWeatherAlertPolledEvent('alert-777', 'user-1')],
          nextSince: '2026-11-25T12:00:00.000Z',
        })
      )
    )
    const { answer } = useServedSpotlight()

    renderHomeGate()
    const gate = screen.getByTestId('screen-gate')
    // The alert resolved behind the closed gate: it is in place but hidden, and not focused.
    const alert = await screen.findByTestId('severe-weather-alert-focused')
    expect(alert).not.toBeVisible()
    expect(gate).not.toHaveAttribute('data-ready')
    expect(alert).not.toHaveFocus()

    ritual.resolve()
    await answer(0, cityPage())
    await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
    // Readiness alone moves the focus: the alert id never changed.
    await waitFor(() => expect(alert).toHaveFocus())
    expect(alert).toBeVisible()
  })

  it('7.7-CMP-042 the ritual snapshot waits for the city line, so a return never starts from an outfit without it (CodeRabbit r1 #9)', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signInFixtureMember()
    const locations = Promise.withResolvers<void>()
    useMswHandlers(
      http.get('/api/v1/ritual', () => HttpResponse.json(memberRitual())),
      http.get('/api/v1/locations', async () => {
        await locations.promise
        return HttpResponse.json({ data: [chicagoHome] })
      })
    )
    const { answer } = useServedSpotlight()
    renderHomeGate()
    await answer(0, cityPage())
    const keptRitual = () =>
      screenSnapshot.recall<{ city: string | undefined }>(
        currentWebSessionScope(),
        'home',
        'ritual'
      )

    // The outfit is in and its city line is not: nothing is kept for a return yet.
    expect(await screen.findByTestId('home-live-outfit')).not.toBeVisible()
    expect(keptRitual()).toBeUndefined()

    await act(async () => {
      locations.resolve()
      await locations.promise
    })
    await waitFor(() => expect(keptRitual()?.city).toBe('Chicago home'))
  })

  it('7.7-CMP-043 a return never shows a remembered teaser past its expiry, and the fresh read brings it back (CodeRabbit r1 #10)', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signInFixtureMember()
    useAnsweredRitual()
    const { answer } = useServedSpotlight()
    const firstVisit = renderHomeGate()
    await answer(0, cityPage())
    await waitFor(() =>
      expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
    )
    expect(screen.getByTestId('home-spotlight-teaser-link')).toBeVisible()
    firstVisit.unmount()

    // The remembered teaser was read longer ago than a teaser lives.
    const scope = currentWebSessionScope()
    const kept = screenSnapshot.recall<{
      memberId: string
      value: { completedAt: number }
    }>(scope, 'home', HOME_TEASER_SNAPSHOT_PART)!
    screenSnapshot.remember(scope, 'home', HOME_TEASER_SNAPSHOT_PART, {
      ...kept,
      value: { ...kept.value, completedAt: Date.now() - SPOTLIGHT_TEASER_EXPIRY_MS - 1 },
    })
    const firstCommit: string[] = []
    renderHomeGate(firstCommit)

    expect(firstCommit).toEqual(['home-live-outfit'])
    expect(screen.queryByTestId('home-spotlight-teaser-link')).toBeNull()

    await answer(1, cityPage())
    expect(await screen.findByTestId('home-spotlight-teaser-link')).toBeVisible()
  })

  it('7.7-CMP-044 the hero stays outside the Home gate, so a session being verified shows it while the body waits (real-session L-10)', () => {
    document.documentElement.setAttribute('data-session', 'pending')
    signInFixtureMember()
    const ritual = Promise.withResolvers<void>()
    onTestFinished(() => ritual.resolve())
    useMswHandlers(
      http.get('/api/v1/ritual', async () => {
        await ritual.promise
        return HttpResponse.json(memberRitual())
      }),
      http.get('/api/v1/locations', () => HttpResponse.json({ data: [] }))
    )
    useServedSpotlight()
    render(<Home />)

    const gate = screen.getByTestId('screen-gate')
    expect(gate).not.toHaveAttribute('data-ready')
    expect(screen.getByTestId('screen-placeholder')).toBeVisible()
    expect(screen.getByTestId('lookbook-prism-container')).not.toBeVisible()
    // The hero reads nothing: it is there at once, so the page never waits on a verification
    // that could time out into the signed-out landing.
    const hero = screen.getByTestId('hero-section')
    expect(gate.contains(hero)).toBe(false)
    expect(screen.getByTestId('hero-headline')).toBeVisible()
    expect(screen.getByTestId('cta-primary')).toBeVisible()
    // The hero follows the placeholder, which holds the viewport, so the body appearing above it
    // moves nothing on screen.
    expect(
      screen.getByTestId('screen-placeholder').compareDocumentPosition(hero) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByTestId('screen-placeholder')).toHaveClass('min-h-screen')
  })
})
