// Story 6.14 TEA, slice 11: the complimentary states of the web settings Premium section.
//
// Same seams as subscription-section.test.tsx: real `lib/premium` through MSW, the real
// locale catalog, and only the Stripe redirect mocked. Scenario ids are the plan's
// (`cc614-complimentary-access-test-design.md`).
import { I18nextProvider } from 'react-i18next'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPLIMENTARY_ACCESS_ACTIVE_MESSAGE } from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { createCheckoutSessionFromWeb } from '../../lib/premium'
import type * as PremiumModule from '../../lib/premium'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { SubscriptionSection } from './subscription-section'
import enUS from '../../i18n/locales/en-US.json'

vi.mock('../../lib/premium', async (importOriginal) => {
  const actual = await importOriginal<typeof PremiumModule>()
  return { ...actual, redirectToExternalUrl: vi.fn() }
})

const SUBSCRIPTION_PATH = '/api/v1/commerce/subscription'
const ACCESS_PATH = '/api/v1/commerce/premium/access'
const CHECKOUT_PATH = '/api/v1/commerce/subscription/checkout-session'

const premiumCopy = enUS.commerce.premium as unknown as {
  status: Record<string, string>
  complimentaryNote: string
  errorComplimentary: string
}
const COMPLIMENTARY_STATUS = premiumCopy.status.complimentary!
const COMPLIMENTARY_NOTE = premiumCopy.complimentaryNote

type Body = Record<string, unknown>

const NONE_SUBSCRIPTION: Body = {
  status: 'none',
  store: null,
  productId: null,
  willRenew: null,
  currentPeriodEnd: null,
  syncedAt: null,
  purchasesEnabled: true,
}

const ACTIVE_STRIPE: Body = {
  status: 'active',
  store: 'stripe',
  productId: 'premium_monthly',
  willRenew: true,
  currentPeriodEnd: '2026-12-12T00:00:00.000Z',
  syncedAt: '2026-11-10T08:00:00.000Z',
  purchasesEnabled: true,
}

function handlersFor(
  subscription: Body,
  access: Body | 'fail-500' | 'fail-network' | 'unhandled'
) {
  const handlers = [
    http.get(SUBSCRIPTION_PATH, () => HttpResponse.json({ data: subscription })),
  ]
  if (access === 'fail-500')
    handlers.push(
      http.get(ACCESS_PATH, () =>
        HttpResponse.json(
          { statusCode: 500, message: 'Internal server error' },
          { status: 500 }
        )
      )
    )
  else if (access === 'fail-network')
    handlers.push(http.get(ACCESS_PATH, () => HttpResponse.error()))
  else if (access !== 'unhandled')
    handlers.push(http.get(ACCESS_PATH, () => HttpResponse.json({ data: access })))
  return handlers
}

function renderSection() {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <SubscriptionSection />
    </I18nextProvider>
  )
}

/** Waits until the subscription read has landed: the section leaves its checking state. */
async function loaded() {
  await waitFor(() =>
    expect(screen.getByTestId('premium-status-line')).not.toHaveTextContent(/^$/)
  )
}

beforeEach(async () => {
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/settings')
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
  await getI18n().changeLanguage('en-US')
})

afterEach(() => {
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('SubscriptionSection complimentary access', () => {
  it('W-COMPLIMENTARY: an unpaid complimentary member sees the complimentary status and no subscribe or portal control', async () => {
    useMswHandlers(
      ...handlersFor(NONE_SUBSCRIPTION, { premium: true, source: 'complimentary' })
    )

    renderSection()

    await waitFor(() =>
      expect(screen.getByTestId('premium-status-line')).toHaveTextContent(
        COMPLIMENTARY_STATUS
      )
    )
    expect(screen.queryByTestId('premium-subscribe-monthly')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-subscribe-annual')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-manage-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-complimentary-note')).not.toBeInTheDocument()
  })

  it('W-DISCLOSURE-HIDDEN: an unpaid complimentary member never sees the billing disclosure, not even while the access read is pending', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    useMswHandlers(
      http.get(SUBSCRIPTION_PATH, () => HttpResponse.json({ data: NONE_SUBSCRIPTION })),
      http.get(ACCESS_PATH, async () => {
        await pending
        return HttpResponse.json({ data: { premium: true, source: 'complimentary' } })
      })
    )
    // Records the disclosure if it ever renders, so a flash between renders is caught.
    let flashed = false
    const observer = new MutationObserver(() => {
      if (screen.queryByTestId('premium-disclosure')) flashed = true
    })
    observer.observe(document.body, { childList: true, subtree: true })
    try {
      renderSection()
      // The subscription read lands while the access read is still held.
      await waitFor(() =>
        expect(screen.getByTestId('premium-status-line')).toBeInTheDocument()
      )
      expect(screen.queryByTestId('premium-disclosure')).not.toBeInTheDocument()
      release()
      await waitFor(() =>
        expect(screen.getByTestId('premium-status-line')).toHaveTextContent(
          COMPLIMENTARY_STATUS
        )
      )
    } finally {
      observer.disconnect()
    }
    expect(flashed).toBe(false)
    expect(screen.queryByTestId('premium-disclosure')).not.toBeInTheDocument()
  })

  it.each([
    ['a paying grantee', ACTIVE_STRIPE, { premium: true, source: 'complimentary' }],
    ['a free member', NONE_SUBSCRIPTION, { premium: false, source: 'none' }],
    ['a free member whose access read fails', NONE_SUBSCRIPTION, 'fail-500'],
  ] as const)(
    'W-DISCLOSURE-SHOWN: %s still sees the billing disclosure once the reads settle',
    async (_label, subscription, access) => {
      useMswHandlers(
        ...handlersFor(subscription, access as Parameters<typeof handlersFor>[1])
      )

      renderSection()

      expect(await screen.findByTestId('premium-disclosure')).toHaveTextContent(
        enUS.commerce.premium.disclosure
      )
    }
  )

  it('W-BOTH: a paying complimentary member sees the complimentary note and the subscription block with its portal control', async () => {
    useMswHandlers(
      ...handlersFor(ACTIVE_STRIPE, { premium: true, source: 'complimentary' })
    )

    renderSection()

    expect(await screen.findByTestId('premium-complimentary-note')).toHaveTextContent(
      COMPLIMENTARY_NOTE
    )
    expect(screen.getByTestId('premium-status-line')).toHaveTextContent(
      /Premium is active: Premium Monthly\./
    )
    expect(screen.getByTestId('premium-manage-button')).toBeInTheDocument()
    expect(screen.queryByTestId('premium-subscribe-monthly')).not.toBeInTheDocument()
  })

  it.each(['fail-500', 'fail-network'] as const)(
    'W-ACCESS-FAIL (%s): a failed access read renders the section exactly as with no access read, with no complimentary text',
    async (failure) => {
      useMswHandlers(...handlersFor(NONE_SUBSCRIPTION, 'unhandled'))
      const baseline = renderSection()
      await waitFor(() =>
        expect(screen.getByTestId('premium-subscribe-monthly')).toBeEnabled()
      )
      const expected = baseline.container.innerHTML
      baseline.unmount()

      useMswHandlers(...handlersFor(NONE_SUBSCRIPTION, failure))
      const failed = renderSection()
      await waitFor(() =>
        expect(screen.getByTestId('premium-subscribe-monthly')).toBeEnabled()
      )

      expect(failed.container.innerHTML).toBe(expected)
      for (const text of [COMPLIMENTARY_STATUS, COMPLIMENTARY_NOTE])
        expect(failed.container.textContent).not.toContain(text)
      expect(screen.queryByTestId('premium-complimentary-note')).not.toBeInTheDocument()
      expect(screen.queryByTestId('premium-error')?.textContent ?? '').toBe('')
    }
  )

  it('W-ACCESS-FAIL (paid): a failed access read keeps a paying member on the subscription view', async () => {
    useMswHandlers(...handlersFor(ACTIVE_STRIPE, 'fail-500'))

    renderSection()

    expect(await screen.findByTestId('premium-manage-button')).toBeInTheDocument()
    expect(screen.queryByTestId('premium-complimentary-note')).not.toBeInTheDocument()
    expect(screen.getByTestId('premium-status-line')).toHaveTextContent(
      /Premium is active: Premium Monthly\./
    )
  })

  it('W-SOURCE-SUBSCRIPTION: a non-complimentary access answer changes nothing', async () => {
    useMswHandlers(...handlersFor(NONE_SUBSCRIPTION, { premium: false, source: 'none' }))

    renderSection()

    await loaded()
    await waitFor(() =>
      expect(screen.getByTestId('premium-subscribe-monthly')).toBeEnabled()
    )
    expect(screen.getByTestId('premium-status-line')).toHaveTextContent(
      /You don.t have a Premium subscription yet\./
    )
  })

  it('W-CHECKOUT-409: the complimentary 409 maps to complimentary_access, the plain 409 to already_subscribed', async () => {
    useMswHandlers(
      http.post(CHECKOUT_PATH, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            error: 'Conflict',
            message: COMPLIMENTARY_ACCESS_ACTIVE_MESSAGE,
          },
          { status: 409 }
        )
      )
    )
    await expect(createCheckoutSessionFromWeb('premium_monthly')).rejects.toMatchObject({
      reason: 'complimentary_access',
      message: COMPLIMENTARY_ACCESS_ACTIVE_MESSAGE,
    })

    useMswHandlers(
      http.post(CHECKOUT_PATH, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            error: 'Conflict',
            message: 'This account already has an active Premium subscription.',
          },
          { status: 409 }
        )
      )
    )
    await expect(createCheckoutSessionFromWeb('premium_monthly')).rejects.toMatchObject({
      reason: 'already_subscribed',
    })
    expect(premiumCopy.errorComplimentary.length).toBeGreaterThan(0)
  })
})
