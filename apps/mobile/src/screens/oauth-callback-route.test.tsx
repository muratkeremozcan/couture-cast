// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 TEA sign-off: M-CALLBACK-COLD and U-CALLBACK-ROUTES (D5, D6). A cold start through
// the callback link completes the one exchange with the link's own query and routes by outcome:
// member to the D6 destination, no account to the finish step carrying from=preview, anything
// else back to /signin with a closed `google=<kind>` value its door renders (finding 2 ruling).
// Plan: _bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md
import { waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n, { initI18n } from '../lib/i18n'

const flow = vi.hoisted(() => ({
  complete: vi.fn(),
  review: vi.fn<(fromPreview: boolean) => Promise<boolean>>(),
  params: {} as Record<string, string>,
  router: { back: vi.fn(), replace: vi.fn(), push: vi.fn() },
}))
vi.mock('@/src/lib/native-session', () => ({ completeNativeOAuth: flow.complete }))
vi.mock('@/src/lib/post-signin-destination', () => ({
  continuesToPreviewReview: flow.review,
}))
vi.mock('expo-router', () => ({
  router: flow.router,
  useLocalSearchParams: () => flow.params,
}))
vi.mock('expo-localization', () => ({
  getCalendars: () => [{ timeZone: 'America/Chicago' }],
  getLocales: () => [{ languageTag: 'en-US' }],
}))
import OAuthCallbackRoute from '../../app/auth/callback'

/** A string or object href reduced to its path and query, so either form passes. */
function routed(href: unknown): { pathname: string; params: Record<string, string> } {
  if (typeof href === 'string') {
    const url = new URL(href, 'app://route')
    return { pathname: url.pathname, params: Object.fromEntries(url.searchParams) }
  }
  const { pathname, params } = href as {
    pathname: string
    params?: Record<string, string>
  }
  return { pathname, params: { ...params } }
}

async function cold(params: Record<string, string>) {
  flow.params = params
  await render(<OAuthCallbackRoute />)
  await waitFor(() => expect(flow.router.replace).toHaveBeenCalledTimes(1))
  return routed(flow.router.replace.mock.calls[0]![0])
}

beforeAll(async () => {
  await initI18n()
  await i18n.changeLanguage('en-US')
})
beforeEach(() => {
  flow.complete.mockReset()
  flow.review.mockReset().mockResolvedValue(false)
  flow.router.replace.mockReset()
  flow.router.push.mockReset()
  flow.router.back.mockReset()
})

describe('M-CALLBACK-COLD: the callback route after a cold start', () => {
  it('completes the exchange once with the link query and sends no_account to the finish step', async () => {
    flow.complete.mockResolvedValue({ kind: 'no_account' })
    expect(await cold({ code: 'cold-code', from: 'preview' })).toEqual({
      pathname: '/signup-finish',
      params: { from: 'preview' },
    })
    expect(flow.complete.mock.calls).toEqual([
      ['couturecast://auth/callback?code=cold-code&from=preview'],
    ])
  })

  it('drops parameters outside the callback set before completing', async () => {
    flow.complete.mockResolvedValue({ kind: 'no_account' })
    await cold({ code: 'cold-code', state: 'x', access_token: 'leak' })
    expect(flow.complete.mock.calls).toEqual([
      ['couturecast://auth/callback?code=cold-code'],
    ])
  })

  it('sends a member from the preview with an intent to the review', async () => {
    flow.complete.mockResolvedValue({ kind: 'member' })
    flow.review.mockResolvedValue(true)
    expect(await cold({ code: 'cold-member', from: 'preview' })).toEqual({
      pathname: '/preview-continue',
      params: {},
    })
    expect(flow.review).toHaveBeenCalledWith(true)
  })

  it('sends any other member Home through the guest-state rule', async () => {
    flow.complete.mockResolvedValue({ kind: 'member' })
    expect(await cold({ code: 'cold-plain', from: 'preview2' })).toEqual({
      pathname: '/',
      params: {},
    })
    expect(flow.review).toHaveBeenCalledWith(false)
  })

  // Finding 2 ruling: the route passes the outcome to /signin.
  it.each(['refused', 'cancelled', 'unavailable'] as const)(
    'sends %s back to /signin with google=<kind>, keeping from=preview',
    async (kind) => {
      flow.complete.mockResolvedValue({ kind })
      expect(await cold({ error: 'access_denied', from: 'preview' })).toEqual({
        pathname: '/signin',
        params: { from: 'preview', google: kind },
      })
    }
  )

  it('a TEA-11 refusal without the preview reaches /signin as google=refused only', async () => {
    flow.complete.mockResolvedValue({ kind: 'refused' })
    expect(
      await cold({
        error: 'access_denied',
        error_code: 'provider_email_needs_verification',
      })
    ).toEqual({ pathname: '/signin', params: { google: 'refused' } })
  })
})
