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
