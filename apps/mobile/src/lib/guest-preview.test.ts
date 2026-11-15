// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16: the mobile guest preview lib. Storage adapter (D7), guarded analytics (D10),
// and the verified comfort client and next step (D8).
import { http, HttpResponse } from 'msw'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponseError } from '@couture/api-client'

const analytics = vi.hoisted(() => ({ capture: vi.fn(), reset: vi.fn() }))
vi.mock('@/src/analytics/mobile-analytics', () => ({
  mobileAnalyticsClient: {
    capture: analytics.capture,
    screen: vi.fn(),
    getDistinctId: () => 'x',
  },
  resetMobileAnalyticsIdentity: analytics.reset,
}))

import { server } from '@/src/test-utils/msw/server'
import { setMobileAccessTokenResolver, setMobileApplicationUserId } from './mobile-auth'
import {
  fileGuestPreviewAdapter,
  GUEST_PREVIEW_STORAGE_KEY,
  guestPreviewAnalytics,
  isConsentRejection,
  mobileGuestPreviewStore,
  resolveMobileNextStep,
  setMobileGuestPreviewStoreForTests,
  verifiedComfortClient,
} from './guest-preview'

let token: string | undefined
let restore: (() => void) | undefined

beforeAll(() => {
  process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
})

beforeEach(() => {
  token = undefined
  restore = setMobileAccessTokenResolver(() => token)
  setMobileApplicationUserId(null)
  globalThis.localStorage?.clear()
})

afterEach(() => {
  restore?.()
  setMobileApplicationUserId(null)
  setMobileGuestPreviewStoreForTests(undefined)
})

describe('guest preview storage (D7)', () => {
  it('keeps guest state under its own key on web runs', async () => {
    await fileGuestPreviewAdapter.write('{"x":1}')
    expect(globalThis.localStorage.getItem(GUEST_PREVIEW_STORAGE_KEY)).toBe('{"x":1}')
    expect(await fileGuestPreviewAdapter.read()).toBe('{"x":1}')
    await fileGuestPreviewAdapter.remove()
    expect(await fileGuestPreviewAdapter.read()).toBeNull()
  })

  it('hands out one store per process', () => {
    expect(mobileGuestPreviewStore()).toBe(mobileGuestPreviewStore())
  })
})

describe('guest preview analytics (D10)', () => {
  it('sends the three events with closed values and rotates the id on a signup click', () => {
    guestPreviewAnalytics.started()
    guestPreviewAnalytics.interacted('control_changed', 'wind')
    guestPreviewAnalytics.interacted('look_voted')
    guestPreviewAnalytics.signupClicked('sign_in')
    expect(analytics.capture.mock.calls.map(([event]) => event as string)).toEqual([
      'guest_preview_started',
      'guest_preview_interacted',
      'guest_preview_interacted',
      'guest_preview_signup_clicked',
    ])
    expect(analytics.capture.mock.calls[2]?.[1]).toEqual({
      platform: expect.stringMatching(/^(ios|android)$/) as string,
      catalog_version: '2026-11-15.1',
      action: 'look_voted',
    })
    expect(analytics.reset).toHaveBeenCalledOnce()
  })

  it('never throws when an event fails to parse', () => {
    expect(() => guestPreviewAnalytics.interacted('control_changed')).not.toThrow()
    expect(analytics.capture).not.toHaveBeenCalled()
  })
})

describe('verified comfort client (D8)', () => {
  it('is null without a verified member', async () => {
    expect(await verifiedComfortClient()).toBeNull()
    token = 'token-a'
    expect(await verifiedComfortClient()).toBeNull()
  })

  it('reads and writes comfort with the verified bearer and no sample ids', async () => {
    token = 'token-a'
    setMobileApplicationUserId('member-a')
    const seen: { method: string; auth: string | null; body: string }[] = []
    server.use(
      http.all('*/api/v1/personalization/comfort', async ({ request }) => {
        seen.push({
          method: request.method,
          auth: request.headers.get('authorization'),
          body: await request.text(),
        })
        return HttpResponse.json({
          data: {
            runsColdWarm: 'cold',
            windTolerance: 'low',
            precipPreparedness: 'high',
          },
        })
      })
    )
    const client = await verifiedComfortClient()
    expect(client?.memberId).toBe('member-a')
    expect(await client?.read()).toEqual({
      runsColdWarm: 'cold',
      windTolerance: 'low',
      precipPreparedness: 'high',
    })
    await client?.write({
      runsColdWarm: 'cold',
      windTolerance: 'low',
      precipPreparedness: 'high',
    })
    expect(seen.map(({ method, auth }) => [method, auth])).toEqual([
      ['GET', 'Bearer token-a'],
      ['PUT', 'Bearer token-a'],
    ])
    expect(JSON.parse(seen[1]?.body ?? '{}')).toEqual({
      runsColdWarm: 'cold',
      windTolerance: 'low',
      precipPreparedness: 'high',
    })
    expect(JSON.stringify(seen)).not.toContain('sample:')
  })

  it('classifies only a 403 as a consent rejection', () => {
    expect(
      isConsentRejection(new ResponseError(new Response(null, { status: 403 })))
    ).toBe(true)
    expect(
      isConsentRejection(new ResponseError(new Response(null, { status: 500 })))
    ).toBe(false)
    expect(isConsentRejection(new Error('403'))).toBe(false)
  })
})

describe('resolveMobileNextStep (D8)', () => {
  function answerProfile(role: string, statuses: string[]) {
    server.use(
      http.get('*/api/v1/user/profile', () =>
        HttpResponse.json({
          user: {
            id: 'member-a',
            email: 'member@example.test',
            displayName: null,
            birthdate: null,
            role,
          },
          linkedGuardians: statuses.map((status, index) => ({
            guardianId: `guardian-${index}`,
            status,
            consentGrantedAt: status === 'granted' ? '2026-11-01T00:00:00.000Z' : null,
          })),
          linkedTeens: [],
        })
      )
    )
  }

  it('asks for sign-in without a bearer', async () => {
    expect(await resolveMobileNextStep()).toBe('/signin')
  })

  it('routes an active member to onboarding and a pending teen to the teen dashboard', async () => {
    token = 'token-a'
    answerProfile('guardian', [])
    expect(await resolveMobileNextStep()).toBe('/wardrobe-onboarding')
    answerProfile('teen', ['pending'])
    expect(await resolveMobileNextStep()).toBe('/teen-dashboard')
    answerProfile('teen', ['pending', 'granted'])
    expect(await resolveMobileNextStep()).toBe('/wardrobe-onboarding')
  })

  it('falls back to onboarding when the profile cannot be read', async () => {
    token = 'token-a'
    server.use(
      http.get('*/api/v1/user/profile', () => HttpResponse.json({}, { status: 500 }))
    )
    expect(await resolveMobileNextStep()).toBe('/wardrobe-onboarding')
  })
})
