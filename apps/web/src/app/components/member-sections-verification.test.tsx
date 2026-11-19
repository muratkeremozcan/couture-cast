// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19): while a stored session is verified, each member-owned
// section says nothing about the member (no sign-in wording, no "no subscription yet") and sends
// nothing. A session check that fails (a timeout, a 503 from the profile check) is an outage:
// each section shows its load error with a retry and asks for nothing; the retry verifies the
// session again, and the section reads once when the member is named. The Locations section pins
// the same rule in locations/locations-verification-outage.test.tsx.
import type { ReactElement } from 'react'
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getI18n } from '../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import type * as WebSession from '../../lib/web-session'
import { PALETTE_PATH, profile } from '../../test-utils/palette-advisor-panel'
import { CommercePreferencesSection } from './commerce-preferences-section'
import { PaletteAdvisorPanel } from './palette-advisor-panel'
import { PlannerRail } from './planner-rail'
import { PremiumThemeSection } from './premium-theme-section'
import { SubscriptionSection } from './subscription-section'

/** Each verification a section starts, settled by the test. */
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/settings',
}))

interface OutageCase {
  name: string
  render: () => ReactElement
  /** The member-owned read the section sends once it knows the member. */
  read: string
  body: JsonBodyType
  error: string
  retry: { testId: string; name: string }
  /** Signed-out wording the section must never show during an outage. */
  signedOut: RegExp
  /** What the section shows once the read for the member lands. */
  signedIn: string
}

const CASES: OutageCase[] = [
  {
    name: 'Shopping and partners',
    render: () => <CommercePreferencesSection />,
    read: '/api/v1/commerce/preferences',
    body: { data: { affiliateCtasEnabled: true } },
    error: 'Unable to load shopping preferences.',
    retry: { testId: 'commerce-session-retry', name: 'Try again' },
    signedOut: /Sign in to change this/,
    signedIn: 'commerce-opt-out-toggle',
  },
  {
    name: 'Premium',
    render: () => <SubscriptionSection />,
    read: '/api/v1/commerce/subscription',
    body: {
      data: {
        status: 'none',
        store: null,
        productId: null,
        willRenew: null,
        currentPeriodEnd: null,
        syncedAt: null,
        purchasesEnabled: true,
      },
    },
    error: 'Unable to load subscription status.',
    retry: { testId: 'premium-session-retry', name: 'Try again' },
    signedOut: /Sign in to subscribe or manage Premium/,
    signedIn: 'premium-subscribe-monthly',
  },
  {
    name: 'Interface palettes',
    render: () => <PremiumThemeSection />,
    read: '/api/v1/commerce/premium/theme',
    body: { data: { theme: null, isEntitled: true, themesEnabled: true } },
    error: 'Unable to load your interface palette. Showing the default palette.',
    retry: { testId: 'premium-theme-session-retry', name: 'Try again' },
    signedOut: /Sign in and subscribe to Premium/,
    signedIn: 'premium-theme-gallery',
  },
  {
    name: 'Palette advisor',
    render: () => <PaletteAdvisorPanel />,
    read: PALETTE_PATH,
    body: { data: profile() },
    error: 'We could not load your palette. Try again.',
    retry: { testId: 'palette-advisor-session-retry', name: 'Try again' },
    signedOut: /Sign in and subscribe to Premium/,
    signedIn: 'palette-advisor-consent',
  },
  {
    name: 'Planner rail',
    render: () => <PlannerRail isOpen onClose={vi.fn()} variant="rail" />,
    read: '/api/v1/commerce/premium/planner',
    body: {
      data: {
        locationId: 'location-1',
        timezone: 'America/Chicago',
        anchorDate: '2026-11-19',
        daysReady: 0,
        // The contract's week is seven days; every one still generating is enough to render.
        days: [19, 20, 21, 22, 23, 24, 25].map((day) => ({
          status: 'error',
          planDate: `2026-11-${day}`,
          errorCode: 'generation_failed',
          retryable: true,
        })),
      },
    },
    error: 'Unable to load the outfit planner',
    retry: { testId: 'planner-rail-retry', name: 'Retry' },
    signedOut: /Premium feature/,
    signedIn: 'planner-days',
  },
]

let reads: number

function failVerification(index: number) {
  return act(async () => {
    session.pending[index]!.reject(new Error('Session verification is unavailable.'))
    await Promise.resolve()
  })
}

/** What the bridge does when a verification names the member and writes the bearer. */
function verifyMember(index: number) {
  return act(async () => {
    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'fresh-token')
    window.dispatchEvent(new Event('couture:session'))
    session.pending[index]!.resolve('fresh-token')
    await Promise.resolve()
  })
}

describe('member-owned sections treat a failed session check as an outage, never as signed out', () => {
  beforeEach(async () => {
    reads = 0
    session.identity = null
    session.stored = true
    session.pending = []
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  it.each(CASES)(
    'SESSION-OUTAGE-WEB $name shows its load error with a retry, and the retry that verifies reads once',
    async (section) => {
      useMswHandlers(
        http.get(section.read, () => {
          reads += 1
          return HttpResponse.json(section.body)
        }),
        http.get('/api/v1/commerce/premium/access', () =>
          HttpResponse.json({ statusCode: 500, message: 'down' }, { status: 500 })
        )
      )
      const { container } = render(
        <I18nextProvider i18n={getI18n()}>
          <main>{section.render()}</main>
        </I18nextProvider>
      )

      await failVerification(0)
      expect(screen.getByRole('alert')).toHaveTextContent(section.error)
      const retry = screen.getByTestId(section.retry.testId)
      expect(retry).toHaveTextContent(section.retry.name)
      expect(container.textContent).not.toMatch(section.signedOut)
      expect(reads).toBe(0)

      await userEvent.setup().click(retry)
      expect(session.pending).toHaveLength(2)
      expect(container.textContent).not.toMatch(section.signedOut)
      await verifyMember(1)

      expect(await screen.findByTestId(section.signedIn)).toBeInTheDocument()
      expect(screen.queryByTestId(section.retry.testId)).toBeNull()
      expect(container.textContent).not.toMatch(section.signedOut)
      expect(reads).toBe(1)
    }
  )
})

describe('member-owned sections say nothing about the member while the session is verified', () => {
  beforeEach(async () => {
    reads = 0
    session.identity = null
    session.stored = true
    session.pending = []
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  it.each(CASES)(
    'SESSION-CHECKING-WEB $name shows no sign-in wording, no error and sends nothing',
    (section) => {
      useMswHandlers(
        http.get(section.read, () => {
          reads += 1
          return HttpResponse.json(section.body)
        })
      )
      const { container } = render(
        <I18nextProvider i18n={getI18n()}>
          <main>{section.render()}</main>
        </I18nextProvider>
      )

      expect(session.pending).toHaveLength(1)
      expect(container.textContent).not.toMatch(section.signedOut)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByTestId(section.retry.testId)).toBeNull()
      expect(reads).toBe(0)
    }
  )

  it('SESSION-CHECKING-WEB-PREMIUM Premium does not say "no subscription yet" before it knows', () => {
    render(
      <I18nextProvider i18n={getI18n()}>
        <main>
          <SubscriptionSection />
        </main>
      </I18nextProvider>
    )

    expect(screen.getByTestId('premium-subscription-section')).toHaveAttribute(
      'aria-busy',
      'true'
    )
    expect(screen.queryByTestId('premium-status-line')).toBeNull()
    expect(screen.queryByTestId('premium-subscribe-monthly')).toBeNull()
  })
})

// Settings Codex review 1, finding 6: a billing follow-up (the activation poll's next read, the
// portal return's fallback read) is checked before it is sent, so a member who left while it
// waited never has a read sent for them with the next member's bearer.
describe('Premium checks a billing follow-up read before sending it', () => {
  const NONE_SUBSCRIPTION = CASES[1]!.body as { data: Record<string, unknown> }
  let getBearers: (string | null)[]
  let refreshBearers: (string | null)[]

  beforeEach(async () => {
    getBearers = []
    refreshBearers = []
    session.identity = 'member-1'
    session.stored = true
    session.pending = []
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1')
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  function renderPremium() {
    return render(
      <I18nextProvider i18n={getI18n()}>
        <main>
          <SubscriptionSection />
        </main>
      </I18nextProvider>
    )
  }

  /** The bridge moved to member-2; the section has not heard yet. */
  function switchMemberSilently() {
    session.identity = 'member-2'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-2')
  }

  async function settle() {
    for (let round = 0; round < 3; round += 1)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
  }

  it('SESSION-BILLING-WEB-01 the activation poll sends no next read once its member left', async () => {
    window.history.replaceState(null, '', '/settings?checkout=success')
    const realSetTimeout = window.setTimeout.bind(window)
    const pollTicks: (() => void)[] = []
    vi.spyOn(window, 'setTimeout').mockImplementation(((
      handler: () => void,
      delay?: number
    ) => {
      // The poll's 5-second interval is held for the test; every other timer runs.
      if (delay === 5_000) {
        pollTicks.push(handler)
        return 0
      }
      return realSetTimeout(handler, delay)
    }) as typeof window.setTimeout)
    useMswHandlers(
      http.post('/api/v1/commerce/subscription/refresh', ({ request }) => {
        refreshBearers.push(request.headers.get('authorization'))
        return HttpResponse.json(NONE_SUBSCRIPTION)
      }),
      http.get('/api/v1/commerce/subscription', ({ request }) => {
        getBearers.push(request.headers.get('authorization'))
        return HttpResponse.json(NONE_SUBSCRIPTION)
      })
    )
    renderPremium()
    await vi.waitFor(() => expect(pollTicks).toHaveLength(1))
    expect(refreshBearers).toEqual(['Bearer token-1'])

    switchMemberSilently()
    await act(async () => {
      pollTicks[0]!()
      await Promise.resolve()
    })
    await settle()

    expect(getBearers).toEqual([])
  })

  it("SESSION-BILLING-WEB-02 a portal return's fallback read is not sent once its member left", async () => {
    window.history.replaceState(null, '', '/settings?portal=return')
    let releaseRefresh!: () => void
    const refreshHeld = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    useMswHandlers(
      http.post('/api/v1/commerce/subscription/refresh', async ({ request }) => {
        refreshBearers.push(request.headers.get('authorization'))
        await refreshHeld
        return HttpResponse.json(
          {
            statusCode: 503,
            message: 'Ledger unavailable',
            error: 'Service Unavailable',
          },
          { status: 503 }
        )
      }),
      http.get('/api/v1/commerce/subscription', ({ request }) => {
        getBearers.push(request.headers.get('authorization'))
        return HttpResponse.json(NONE_SUBSCRIPTION)
      }),
      http.get('/api/v1/commerce/premium/access', () =>
        HttpResponse.json({ statusCode: 500, message: 'down' }, { status: 500 })
      )
    )
    renderPremium()
    await vi.waitFor(() => expect(refreshBearers).toEqual(['Bearer token-1']))

    switchMemberSilently()
    await act(async () => {
      releaseRefresh()
      await Promise.resolve()
    })
    await settle()

    expect(getBearers).toEqual([])
  })
})

// Settings Codex review 2: a denial, a billing return and a portal fallback, each kept with the
// member and the token that made them.
describe('Premium keeps reads with the member through a token rotation and a member switch', () => {
  const NONE = CASES[1]!.body as { data: Record<string, unknown> }
  const ACTIVE = {
    data: {
      ...NONE.data,
      status: 'active',
      store: 'stripe',
      productId: 'premium_monthly',
      willRenew: true,
      currentPeriodEnd: '2026-12-19T00:00:00.000Z',
      syncedAt: '2026-11-19T08:00:00.000Z',
    },
  }
  const DENIED = { statusCode: 401, message: 'Unauthorized', error: 'Unauthorized' }
  const SIGN_IN_HINT = /Sign in to subscribe or manage Premium/
  let getBearers: (string | null)[]
  let accessBearers: (string | null)[]
  let refreshCount: number

  beforeEach(async () => {
    getBearers = []
    accessBearers = []
    refreshCount = 0
    session.identity = 'member-1'
    session.stored = true
    session.pending = []
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1a')
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  function renderPremium() {
    return render(
      <I18nextProvider i18n={getI18n()}>
        <main>
          <SubscriptionSection />
        </main>
      </I18nextProvider>
    )
  }

  /** What the bridge does when it names (or clears) a member and installs their bearer. */
  function publish(identity: string | null, bearer: string | null) {
    act(() => {
      session.identity = identity
      if (bearer === null) window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
      else window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, bearer)
      window.dispatchEvent(new Event('couture:session'))
    })
  }

  async function settle() {
    for (let round = 0; round < 3; round += 1)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
  }

  /** member-1's reads: token-1a is denied, token-1b answers, member-2 has no subscription. */
  function useRotatingMemberReads(access: Record<string, unknown> = {}) {
    useMswHandlers(
      http.get('/api/v1/commerce/subscription', ({ request }) => {
        const bearer = request.headers.get('authorization')
        getBearers.push(bearer)
        if (bearer === 'Bearer token-1a')
          return HttpResponse.json(DENIED, { status: 401 })
        return HttpResponse.json(bearer === 'Bearer token-1b' ? ACTIVE : NONE)
      }),
      http.get('/api/v1/commerce/premium/access', ({ request }) => {
        accessBearers.push(request.headers.get('authorization'))
        return HttpResponse.json({ data: { premium: false, source: 'none', ...access } })
      })
    )
  }

  it('SESSION-DENIAL-WEB-01 a denial that lands before the fresh token is published waits for it, then reads once', async () => {
    useRotatingMemberReads()
    const { container } = renderPremium()

    // The old bearer is still installed, so the read joins the bridge's verification.
    await vi.waitFor(() => expect(session.pending).toHaveLength(1))
    expect(container.textContent).not.toMatch(SIGN_IN_HINT)

    publish('member-1', 'token-1b')
    await act(async () => {
      session.pending[0]!.resolve('token-1b')
      await Promise.resolve()
    })

    expect(await screen.findByTestId('premium-manage-button')).toBeInTheDocument()
    await settle()
    expect(container.textContent).not.toMatch(SIGN_IN_HINT)
    expect(getBearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
  })

  it('SESSION-DENIAL-WEB-02 a denial that lands after the fresh token is published reads once with it', async () => {
    let releaseOld!: () => void
    const old = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    useMswHandlers(
      http.get('/api/v1/commerce/subscription', async ({ request }) => {
        const bearer = request.headers.get('authorization')
        getBearers.push(bearer)
        if (bearer === 'Bearer token-1a') {
          await old
          return HttpResponse.json(DENIED, { status: 401 })
        }
        return HttpResponse.json(ACTIVE)
      }),
      http.get('/api/v1/commerce/premium/access', () =>
        HttpResponse.json({ data: { premium: false, source: 'none' } })
      )
    )
    renderPremium()
    await vi.waitFor(() => expect(getBearers).toEqual(['Bearer token-1a']))

    publish('member-1', 'token-1b')
    await act(async () => {
      releaseOld()
      await Promise.resolve()
    })

    expect(await screen.findByTestId('premium-manage-button')).toBeInTheDocument()
    expect(session.pending).toHaveLength(0)
    expect(getBearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
  })

  it('SESSION-DENIAL-WEB-03 control: a denial the bridge confirms for the current token stands', async () => {
    useRotatingMemberReads()
    renderPremium()
    await vi.waitFor(() => expect(session.pending).toHaveLength(1))

    // Verification answers with the same token: the API's denial is the member's.
    await act(async () => {
      session.pending[0]!.resolve('token-1a')
      await Promise.resolve()
    })

    expect(await screen.findByTestId('premium-signed-out-hint')).toHaveTextContent(
      SIGN_IN_HINT
    )
    expect(getBearers).toEqual(['Bearer token-1a'])
  })

  it('SESSION-ACCESS-WEB-01 a superseded denial of the access read is read again, so a complimentary member is offered nothing to buy', async () => {
    let releaseOld!: () => void
    const old = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    useMswHandlers(
      http.get('/api/v1/commerce/subscription', ({ request }) => {
        getBearers.push(request.headers.get('authorization'))
        return HttpResponse.json(NONE)
      }),
      http.get('/api/v1/commerce/premium/access', async ({ request }) => {
        const bearer = request.headers.get('authorization')
        accessBearers.push(bearer)
        if (bearer === 'Bearer token-1a') {
          await old
          return HttpResponse.json(DENIED, { status: 401 })
        }
        return HttpResponse.json({ data: { premium: true, source: 'complimentary' } })
      })
    )
    renderPremium()
    await vi.waitFor(() => expect(accessBearers).toEqual(['Bearer token-1a']))

    publish('member-1', 'token-1b')
    await act(async () => {
      releaseOld()
      await Promise.resolve()
    })

    expect(await screen.findByTestId('premium-status-line')).toHaveTextContent(
      'You have complimentary Premium access from CoutureCast.'
    )
    expect(screen.queryByTestId('premium-subscribe-monthly')).toBeNull()
    expect(accessBearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
  })

  it('SESSION-RETURN-WEB-01 a checkout return is spent when its member leaves, so the same member coming back loads normally', async () => {
    window.history.replaceState(null, '', '/settings?checkout=success')
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1b')
    useMswHandlers(
      http.post('/api/v1/commerce/subscription/refresh', () => {
        refreshCount += 1
        return HttpResponse.json(ACTIVE)
      }),
      http.get('/api/v1/commerce/subscription', ({ request }) => {
        getBearers.push(request.headers.get('authorization'))
        return HttpResponse.json(NONE)
      }),
      http.get('/api/v1/commerce/premium/access', () =>
        HttpResponse.json({ data: { premium: false, source: 'none' } })
      )
    )
    renderPremium()
    await vi.waitFor(() => expect(refreshCount).toBe(1))

    publish(null, null)
    publish('member-2', 'token-2')
    expect(await screen.findByTestId('premium-subscribe-monthly')).toBeEnabled()
    publish(null, null)
    publish('member-1', 'token-1b')
    expect(await screen.findByTestId('premium-subscribe-monthly')).toBeEnabled()
    await settle()

    expect(refreshCount).toBe(1)
    expect(getBearers).toEqual(['Bearer token-2', 'Bearer token-1b'])
    expect(
      screen.queryByText('Payment received. Activating your Premium subscription…')
    ).toBeNull()
  })

  it('SESSION-PORTAL-WEB-01 a portal return refreshes once; only its fallback read is retried after a rotation', async () => {
    window.history.replaceState(null, '', '/settings?portal=return')
    let releaseOld!: () => void
    const old = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    useMswHandlers(
      http.post('/api/v1/commerce/subscription/refresh', () => {
        refreshCount += 1
        return HttpResponse.json(
          {
            statusCode: 503,
            message: 'Ledger unavailable',
            error: 'Service Unavailable',
          },
          { status: 503 }
        )
      }),
      http.get('/api/v1/commerce/subscription', async ({ request }) => {
        const bearer = request.headers.get('authorization')
        getBearers.push(bearer)
        if (bearer === 'Bearer token-1a') {
          await old
          return HttpResponse.json(DENIED, { status: 401 })
        }
        return HttpResponse.json(ACTIVE)
      }),
      http.get('/api/v1/commerce/premium/access', () =>
        HttpResponse.json({ data: { premium: false, source: 'none' } })
      )
    )
    renderPremium()
    await vi.waitFor(() => expect(getBearers).toEqual(['Bearer token-1a']))

    publish('member-1', 'token-1b')
    await act(async () => {
      releaseOld()
      await Promise.resolve()
    })

    expect(await screen.findByTestId('premium-manage-button')).toBeInTheDocument()
    await settle()
    expect(refreshCount).toBe(1)
    expect(getBearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
  })
})
