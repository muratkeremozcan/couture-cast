// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// PR #259 review (CodeRabbit), product findings on the member-owned sections: a read denied for
// a bearer the bridge has since replaced reads again with the fresh one (Shopping and partners
// too); a denial the bridge cannot recheck (its profile check failed) is an outage the member
// can retry, and the section reads again once the bridge verifies them; the advisor's recovery
// read retries a rotated bearer like its first read; and closing the planner aborts every read
// it started, including one waiting on a recheck.
import { http, HttpResponse } from 'msw'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE } from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { settle } from '../../test-utils/request-barrier'
import type * as WebSession from '../../lib/web-session'
import type * as Commerce from '../../lib/commerce'
import { CommerceRequestError, getCommercePreferenceFromWeb } from '../../lib/commerce'
import { PALETTE_PATH, errorBody, profile } from '../../test-utils/palette-advisor-panel'
import { CommercePreferencesSection } from './commerce-preferences-section'
import { PaletteAdvisorPanel } from './palette-advisor-panel'
import { PlannerRail } from './planner-rail'

/** The bridge, driven by hand: who verification named, and each recheck a read joins. */
const session = vi.hoisted(() => ({
  identity: null as string | null,
  stored: true,
  pending: [] as {
    resolve: (token: string | undefined) => void
    reject: (error: Error) => void
  }[],
}))

vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.identity,
  hasStoredWebSession: () => session.stored,
  resolveWebSessionToken: () =>
    new Promise<string | undefined>((resolve, reject) => {
      session.pending.push({ resolve, reject })
    }),
}))

// A passthrough spy: the real read runs unless a test hands it an answer of its own.
vi.mock('../../lib/commerce', async (importOriginal) => {
  const actual = await importOriginal<typeof Commerce>()
  return {
    ...actual,
    getCommercePreferenceFromWeb: vi.fn(actual.getCommercePreferenceFromWeb),
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/settings',
}))

const DENIED = { statusCode: 401, message: 'Unauthorized', error: 'Unauthorized' }
const PLANNER_PATH = '/api/v1/commerce/premium/planner'
const WEEK = {
  data: {
    locationId: 'location-1',
    timezone: 'America/Chicago',
    anchorDate: '2026-11-19',
    daysReady: 0,
    days: [19, 20, 21, 22, 23, 24, 25].map((day) => ({
      status: 'error',
      planDate: `2026-11-${day}`,
      errorCode: 'generation_failed',
      retryable: true,
    })),
  },
}

let bearers: (string | null)[]

function renderWith(node: React.ReactNode) {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <main>{node}</main>
    </I18nextProvider>
  )
}

/** What the bridge does when it names member-1 with a new bearer. */
function publish(bearer: string) {
  act(() => {
    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, bearer)
    window.dispatchEvent(new Event('couture:session'))
  })
}

/** The bridge's profile check for the replacement bearer fails (a 503, a timeout). */
function failRecheck(index: number) {
  return act(async () => {
    session.pending[index]!.reject(new Error('Session verification is unavailable.'))
    await Promise.resolve()
  })
}

function hold() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return { gate, release }
}

beforeEach(async () => {
  bearers = []
  session.identity = 'member-1'
  session.stored = true
  session.pending = []
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1a')
  await getI18n().changeLanguage('en-US')
})

afterEach(() => {
  window.sessionStorage.clear()
})

describe('Shopping and partners reads again after a same-member rotation', () => {
  it('RECHECK-COMMERCE-WEB-01 a late 401 for the replaced bearer reads once with the fresh one', async () => {
    const old = hold()
    useMswHandlers(
      http.get('/api/v1/commerce/preferences', async ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        if (bearer === 'Bearer token-1a') {
          await old.gate
          return HttpResponse.json(DENIED, { status: 401 })
        }
        return HttpResponse.json({ data: { affiliateCtasEnabled: false } })
      })
    )
    renderWith(<CommercePreferencesSection />)
    await waitFor(() => expect(bearers).toEqual(['Bearer token-1a']))

    publish('token-1b')
    await act(async () => {
      old.release()
      await Promise.resolve()
    })

    const toggle = screen.getByTestId<HTMLInputElement>('commerce-opt-out-toggle')
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).not.toBeChecked()
    expect(screen.queryByTestId('commerce-error-message')).toBeNull()
    await settle()
    expect(bearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
  })
})

describe('the advisor keeps a failed recheck retryable', () => {
  /** token-1a is denied; token-1b reads the entitled member's panel. */
  function useRotatingAdvisor() {
    useMswHandlers(
      http.get(PALETTE_PATH, ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        if (bearer === 'Bearer token-1a')
          return HttpResponse.json(DENIED, { status: 401 })
        return HttpResponse.json({ data: profile({ isEntitled: true }) })
      })
    )
  }

  it('RECHECK-ADVISOR-WEB-01 a denial whose recheck fails offers a retry, never the signed-out panel, and reads once the member verifies', async () => {
    useRotatingAdvisor()
    renderWith(<PaletteAdvisorPanel />)
    await waitFor(() => expect(session.pending).toHaveLength(1))

    await failRecheck(0)
    expect(await screen.findByTestId('palette-advisor-error')).toHaveTextContent(
      'We could not load your palette. Try again.'
    )
    expect(await screen.findByTestId('palette-advisor-session-retry')).toHaveTextContent(
      'Try again'
    )
    expect(screen.queryByTestId('palette-advisor-locked')).toBeNull()

    // The bridge verifies member-1's replacement bearer later: the panel reads again.
    publish('token-1b')
    expect(await screen.findByTestId('palette-advisor-consent')).toBeInTheDocument()
    expect(screen.queryByTestId('palette-advisor-session-retry')).toBeNull()
    await settle()
    expect(bearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
  })

  it('RECHECK-ADVISOR-WEB-02 the retry reads again, and a recheck that fails again stays retryable', async () => {
    useRotatingAdvisor()
    renderWith(<PaletteAdvisorPanel />)
    await waitFor(() => expect(session.pending).toHaveLength(1))
    await failRecheck(0)

    await userEvent
      .setup()
      .click(await screen.findByTestId('palette-advisor-session-retry'))
    await waitFor(() => expect(session.pending).toHaveLength(2))
    await failRecheck(1)

    expect(await screen.findByTestId('palette-advisor-session-retry')).toBeInTheDocument()
    expect(screen.queryByTestId('palette-advisor-locked')).toBeNull()
    await settle()
    expect(bearers).toEqual(['Bearer token-1a', 'Bearer token-1a'])
  })

  it('RECHECK-ADVISOR-WEB-03 the recovery read after a running analysis retries a rotated bearer', async () => {
    const recovery = hold()
    let reads = 0
    useMswHandlers(
      http.get(PALETTE_PATH, async ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        reads += 1
        if (reads === 1) return HttpResponse.json({ data: profile({ hasConsent: true }) })
        if (bearer === 'Bearer token-1a') {
          await recovery.gate
          return HttpResponse.json(DENIED, { status: 401 })
        }
        return HttpResponse.json({
          data: profile({
            hasConsent: true,
            analysis: {
              status: 'processing',
              failureReason: null,
              source: 'wardrobe',
              undertone: null,
              depth: null,
              confidence: null,
              analysisVersion: null,
              analyzedAt: null,
            },
          } as Parameters<typeof profile>[0]),
        })
      }),
      http.post(`${PALETTE_PATH}/analyze`, () =>
        errorBody(409, PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE, 'Conflict')
      )
    )
    renderWith(<PaletteAdvisorPanel />)
    fireEvent.click(await screen.findByTestId('palette-advisor-source-wardrobe'))
    await waitFor(() => expect(bearers).toEqual(['Bearer token-1a', 'Bearer token-1a']))

    publish('token-1b')
    await act(async () => {
      recovery.release()
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(screen.getByTestId('palette-advisor-status')).toHaveTextContent(
        'Analyzing your palette…'
      )
    )
    await settle()
    expect(bearers).toEqual(['Bearer token-1a', 'Bearer token-1a', 'Bearer token-1b'])
  })
})

describe('the planner keeps a failed recheck retryable and closes every read', () => {
  it('RECHECK-PLANNER-WEB-01 a denial whose recheck fails shows the retry panel, never the lock, and reads once the member verifies', async () => {
    useMswHandlers(
      http.get(PLANNER_PATH, ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        if (bearer === 'Bearer token-1a')
          return HttpResponse.json(DENIED, { status: 401 })
        return HttpResponse.json(WEEK)
      })
    )
    renderWith(<PlannerRail isOpen onClose={vi.fn()} variant="rail" />)
    await waitFor(() => expect(session.pending).toHaveLength(1))

    await failRecheck(0)
    expect(await screen.findByTestId('planner-rail-error')).toBeInTheDocument()
    expect(await screen.findByTestId('planner-rail-retry')).toBeInTheDocument()
    expect(screen.queryByTestId('plan-free-preview')).toBeNull()

    publish('token-1b')
    expect(await screen.findByTestId('planner-days')).toBeInTheDocument()
    await settle()
    expect(bearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
  })

  it('RECHECK-PLANNER-WEB-02 closing the rail aborts every read, so one waiting on a recheck sends nothing after', async () => {
    const third = hold()
    let reads = 0
    useMswHandlers(
      http.get(PLANNER_PATH, async ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        reads += 1
        if (reads === 1) return HttpResponse.json(WEEK)
        if (reads === 2) return HttpResponse.json(DENIED, { status: 401 })
        await third.gate
        return HttpResponse.json(WEEK)
      })
    )
    const onClose = vi.fn()
    const view = renderWith(<PlannerRail isOpen onClose={onClose} variant="rail" />)
    expect(await screen.findByTestId('planner-days')).toBeInTheDocument()

    // Two overlapping focus refreshes: the first is denied and waits on the recheck.
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(session.pending).toHaveLength(1))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(reads).toBe(3))

    view.rerender(
      <I18nextProvider i18n={getI18n()}>
        <main>
          <PlannerRail isOpen={false} onClose={onClose} variant="rail" />
        </main>
      </I18nextProvider>
    )

    // The bridge now installs member-1's replacement bearer and the recheck succeeds.
    publish('token-1b')
    await act(async () => {
      session.pending[0]!.resolve('token-1b')
      await Promise.resolve()
    })
    await act(async () => {
      third.release()
      await Promise.resolve()
    })
    await settle()

    expect(bearers).not.toContain('Bearer token-1b')
    expect(reads).toBe(3)
  })
})

// PR #259 review round 2 (CodeRabbit), Shopping and partners: a cancelled read starts no
// recheck, a failed recheck stays retryable, and a denial the bridge confirms is signed out.
describe('Shopping and partners after a denial', () => {
  /** token-1a is denied; token-1b reads member-1's preference. */
  function useDeniedPreference() {
    useMswHandlers(
      http.get('/api/v1/commerce/preferences', ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        if (bearer === 'Bearer token-1a')
          return HttpResponse.json(DENIED, { status: 401 })
        return HttpResponse.json({ data: { affiliateCtasEnabled: false } })
      })
    )
  }

  it('RECHECK-COMMERCE-WEB-02 a denial whose recheck fails offers a retry and reads once the member verifies', async () => {
    useDeniedPreference()
    renderWith(<CommercePreferencesSection />)
    await waitFor(() => expect(session.pending).toHaveLength(1))

    await failRecheck(0)
    expect(screen.getByTestId('commerce-error-message')).toHaveTextContent(
      'Unable to load shopping preferences.'
    )
    expect(screen.getByTestId('commerce-session-retry')).toHaveTextContent('Try again')
    expect(screen.queryByTestId('commerce-signed-out-hint')).toBeNull()

    publish('token-1b')
    const toggle = screen.getByTestId<HTMLInputElement>('commerce-opt-out-toggle')
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(screen.queryByTestId('commerce-error-message')).toBeNull()
    expect(screen.queryByTestId('commerce-session-retry')).toBeNull()
    expect(bearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
  })

  it('RECHECK-COMMERCE-WEB-03 a denial the bridge confirms for the current bearer shows the sign-in hint', async () => {
    useDeniedPreference()
    renderWith(<CommercePreferencesSection />)
    await waitFor(() => expect(session.pending).toHaveLength(1))

    await act(async () => {
      session.pending[0]!.resolve('token-1a')
      await Promise.resolve()
    })

    expect(await screen.findByTestId('commerce-signed-out-hint')).toHaveTextContent(
      'Sign in to change this'
    )
    expect(screen.queryByTestId('commerce-error-message')).toBeNull()
    expect(bearers).toEqual(['Bearer token-1a'])
  })

  it('RECHECK-COMMERCE-WEB-04 a denial surfacing after the section closed starts no recheck', async () => {
    let rejectRead!: (error: unknown) => void
    vi.mocked(getCommercePreferenceFromWeb).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRead = reject
        })
    )
    const view = renderWith(<CommercePreferencesSection />)
    await waitFor(() => expect(getCommercePreferenceFromWeb).toHaveBeenCalledTimes(1))

    // Settings closes while the 401's body is still being read; the denial surfaces after.
    view.unmount()
    await act(async () => {
      rejectRead(new CommerceRequestError('Unauthorized', 401))
      await Promise.resolve()
    })
    await settle()

    expect(session.pending).toHaveLength(0)
  })
})
