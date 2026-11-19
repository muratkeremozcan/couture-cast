// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19), same root cause as the owner's /settings report on
// production 8b0fed06: the Home planner rail asked once, on mount, whether this tab held the
// verified bearer. A new tab or a reload gets it only after the session bridge verifies the stored
// session, so an entitled member saw the locked "Get Premium" panel and the rail never looked
// again. It now follows the session: still checking (no locked panel, no read) while verification
// is pending, one read per member with that member's bearer, and nothing of one member kept for
// the next. The /settings browser proof is playwright/tests/settings-sections-real-session.spec.ts.
import { http, HttpResponse } from 'msw'
import { act, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getI18n } from '../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import type * as WebSession from '../../lib/web-session'
import { PREMIUM_REQUIRED_MESSAGE } from '@couture/api-client/contracts/http'
import { PlannerRail } from './planner-rail'

/** The session bridge's state, driven by hand: who verification named, and its pending answer. */
const session = vi.hoisted(() => ({
  identity: null as string | null,
  stored: false,
  verify: null as null | ((token: string | undefined) => void),
}))

vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.identity,
  hasStoredWebSession: () => session.stored,
  resolveWebSessionToken: () =>
    new Promise<string | undefined>((resolve) => {
      session.verify = resolve
    }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/settings',
}))

/** What the session bridge does when verification names (or clears) the member. */
function publish(change: { identity: string | null; bearer: string | null }) {
  act(() => {
    session.identity = change.identity
    if (change.bearer === null)
      window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    else window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, change.bearer)
    window.dispatchEvent(new Event('couture:session'))
  })
}

async function finishVerification(token: string | undefined) {
  await act(async () => {
    session.verify?.(token)
    await Promise.resolve()
  })
}

/** Lets every pending read answer and React apply it, without a timer. */
async function settle() {
  for (let round = 0; round < 3; round += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

/** Every member-owned read's bearer, in order. */
let bearers: (string | null)[]

function renderSection() {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <main>
        <PlannerRail isOpen onClose={vi.fn()} variant="rail" />
      </main>
    </I18nextProvider>
  )
}

function resetSession() {
  bearers = []
  session.identity = null
  session.stored = false
  session.verify = null
}

const PLANNER_PATH = '/api/v1/commerce/premium/planner'
const DATES = [
  '2026-11-19',
  '2026-11-20',
  '2026-11-21',
  '2026-11-22',
  '2026-11-23',
  '2026-11-24',
  '2026-11-25',
]
/** An entitled member's week, every day still generating: enough to render the rail. */
const WEEK = {
  data: {
    locationId: 'location-1',
    timezone: 'America/Chicago',
    anchorDate: DATES[0],
    daysReady: 0,
    days: DATES.map((planDate) => ({
      status: 'error',
      planDate,
      errorCode: 'generation_failed',
      retryable: true,
    })),
  },
}

const locked = () => screen.queryByTestId('planner-rail-locked')
const days = () => screen.queryByTestId('planner-days')

describe('PlannerRail follows the web session', () => {
  beforeEach(async () => {
    resetSession()
    useMswHandlers(
      // member-1 is entitled; member-2 is signed in without Premium.
      http.get(PLANNER_PATH, ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        if (bearer === 'Bearer token-1') return HttpResponse.json(WEEK)
        return HttpResponse.json(
          { statusCode: 403, message: PREMIUM_REQUIRED_MESSAGE, error: 'Forbidden' },
          { status: 403 }
        )
      })
    )
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  it('PLANNER-SESSION-WEB-01 a new tab keeps checking through verification, then reads once with the fresh bearer', async () => {
    session.stored = true
    renderSection()
    await settle()

    expect(locked()).toBeNull()
    expect(bearers).toEqual([])

    publish({ identity: 'member-1', bearer: 'token-1' })
    expect(await screen.findByTestId('planner-days')).toBeInTheDocument()
    expect(locked()).toBeNull()

    await finishVerification('token-1')
    publish({ identity: 'member-1', bearer: 'token-1' })
    await settle()
    expect(bearers).toEqual(['Bearer token-1'])
  })

  it('PLANNER-SESSION-WEB-02 a reload with a stale bearer reads only with the fresh one', async () => {
    session.stored = true
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'stale-token')
    renderSection()
    await settle()
    expect(locked()).toBeNull()
    expect(bearers).toEqual([])

    publish({ identity: null, bearer: null })
    await settle()
    expect(locked()).toBeNull()

    publish({ identity: 'member-1', bearer: 'token-1' })
    expect(await screen.findByTestId('planner-days')).toBeInTheDocument()
    await settle()
    expect(bearers).toEqual(['Bearer token-1'])
  })

  it('PLANNER-SESSION-WEB-03 locks only once verification ends without a member', async () => {
    session.stored = true
    renderSection()
    await settle()
    expect(locked()).toBeNull()

    session.stored = false
    await finishVerification(undefined)
    publish({ identity: null, bearer: null })

    expect(await screen.findByTestId('planner-rail-locked')).toBeInTheDocument()
    expect(bearers).toEqual([])
  })

  it("PLANNER-SESSION-WEB-04 the next member never sees the last member's week, and sign-out keeps none", async () => {
    session.stored = true
    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1')
    renderSection()
    expect(await screen.findByTestId('planner-days')).toBeInTheDocument()

    publish({ identity: null, bearer: null })
    publish({ identity: 'member-2', bearer: 'token-2' })
    expect(await screen.findByTestId('planner-rail-locked')).toBeInTheDocument()
    expect(days()).toBeNull()
    await settle()
    expect(bearers).toEqual(['Bearer token-1', 'Bearer token-2'])

    session.stored = false
    publish({ identity: null, bearer: null })
    await settle()
    expect(locked()).toBeInTheDocument()
    expect(days()).toBeNull()
    expect(bearers).toHaveLength(2)
  })

  // Settings Codex review 1, finding 4: a denial of member-1's superseded token is not a sign-out.
  it('PLANNER-SESSION-WEB-05 a late 401 for the old token after a same-member rotation reads again with the fresh one', async () => {
    let releaseOld!: () => void
    const old = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    useMswHandlers(
      http.get(PLANNER_PATH, async ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        if (bearer === 'Bearer token-1a') {
          await old
          return HttpResponse.json(
            { statusCode: 401, message: 'Unauthorized', error: 'Unauthorized' },
            { status: 401 }
          )
        }
        return HttpResponse.json(WEEK)
      })
    )
    session.stored = true
    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1a')
    renderSection()
    await waitFor(() => expect(bearers).toEqual(['Bearer token-1a']))

    publish({ identity: 'member-1', bearer: 'token-1b' })
    await act(async () => {
      releaseOld()
      await Promise.resolve()
    })

    expect(await screen.findByTestId('planner-days')).toBeInTheDocument()
    expect(locked()).toBeNull()
    expect(bearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
  })
})
