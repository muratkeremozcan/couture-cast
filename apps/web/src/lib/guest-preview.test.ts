// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16: the web guest preview lib. Session check (D1), storage adapter (D7),
// guarded analytics (D10), and the verified comfort client and next step (D8).
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponseError } from '@couture/api-client'
import { useMswHandlers } from '../test-utils/msw/runtime'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'

const session = vi.hoisted(() => ({
  identity: vi.fn<() => string | null>(),
  stored: vi.fn<() => boolean>(),
  token: vi.fn<() => Promise<string | undefined>>(),
}))
vi.mock('./web-session', () => ({
  webSessionIdentity: session.identity,
  hasStoredWebSession: session.stored,
  resolveWebSessionToken: session.token,
}))

const {
  GUEST_PREVIEW_STORAGE_KEY,
  guestPreviewAnalytics,
  isConsentRejection,
  localStorageGuestPreviewAdapter,
  resolveWebNextStep,
  resolveWebPreviewSession,
  verifiedComfortClient,
  webGuestPreviewStore,
  setWebGuestPreviewStoreForTests,
} = await import('./guest-preview')

beforeEach(() => {
  session.identity.mockReset().mockReturnValue(null)
  session.stored.mockReset().mockReturnValue(false)
  session.token.mockReset().mockResolvedValue(undefined)
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.__enableAnalyticsTestHook = true
  window.__capturedAnalyticsEvents = []
  window.__analyticsIdentityResets = 0
})

afterEach(() => {
  delete window.__enableAnalyticsTestHook
  setWebGuestPreviewStoreForTests(undefined)
})

describe('resolveWebPreviewSession (D1, L-RESTORE)', () => {
  it('treats a verified member or a mirrored bearer as a member', async () => {
    session.identity.mockReturnValue('member-a')
    expect(await resolveWebPreviewSession()).toBe('member')
    session.identity.mockReturnValue(null)
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-a')
    expect(await resolveWebPreviewSession()).toBe('member')
  })

  it('is a guest with no stored session', async () => {
    expect(await resolveWebPreviewSession()).toBe('guest')
    expect(session.token).not.toHaveBeenCalled()
  })

  it('verifies a stored session before choosing', async () => {
    session.stored.mockReturnValue(true)
    session.token.mockResolvedValueOnce('token')
    expect(await resolveWebPreviewSession()).toBe('member')
    session.token.mockResolvedValueOnce(undefined)
    expect(await resolveWebPreviewSession()).toBe('guest')
  })

  it('reports unavailable, never guest, when verification fails transiently', async () => {
    session.stored.mockReturnValue(true)
    session.token.mockRejectedValue(new Error('Session verification is unavailable.'))
    expect(await resolveWebPreviewSession()).toBe('unavailable')
  })
})

describe('guest preview storage (D7)', () => {
  it('keeps guest state under its own localStorage key', async () => {
    const adapter = localStorageGuestPreviewAdapter()
    await adapter.write('{"x":1}')
    expect(window.localStorage.getItem(GUEST_PREVIEW_STORAGE_KEY)).toBe('{"x":1}')
    expect(await adapter.read()).toBe('{"x":1}')
    await adapter.remove()
    expect(window.localStorage.getItem(GUEST_PREVIEW_STORAGE_KEY)).toBeNull()
  })

  it('hands out one store per page', () => {
    expect(webGuestPreviewStore()).toBe(webGuestPreviewStore())
  })
})

describe('guest preview analytics (D10)', () => {
  it('sends the three events with closed values only', () => {
    guestPreviewAnalytics.started()
    guestPreviewAnalytics.interacted('control_changed', 'wind')
    guestPreviewAnalytics.interacted('look_voted')
    guestPreviewAnalytics.signupClicked('sign_in')
    expect(window.__capturedAnalyticsEvents?.map((event) => event.event)).toEqual([
      'guest_preview_started',
      'guest_preview_interacted',
      'guest_preview_interacted',
      'guest_preview_signup_clicked',
    ])
    expect(window.__capturedAnalyticsEvents?.[2]?.properties).toEqual({
      platform: 'web',
      catalog_version: '2026-11-15.1',
      action: 'look_voted',
    })
    expect(window.__analyticsIdentityResets).toBe(1)
  })

  it('never throws when an event fails to parse', () => {
    expect(() =>
      guestPreviewAnalytics.interacted('control_changed' as never, undefined)
    ).not.toThrow()
    expect(window.__capturedAnalyticsEvents).toEqual([])
  })
})

describe('verified comfort client (D8)', () => {
  it('is null without a verified member', async () => {
    expect(await verifiedComfortClient()).toBeNull()
    session.token.mockResolvedValue('token')
    expect(await verifiedComfortClient()).toBeNull()
  })

  it('reads and writes comfort with the verified bearer', async () => {
    session.token.mockResolvedValue('token-a')
    session.identity.mockReturnValue('member-a')
    const seen: { method: string; auth: string | null; body: unknown }[] = []
    useMswHandlers(
      http.all('*/api/v1/personalization/comfort', async ({ request }) => {
        const text = await request.text()
        seen.push({
          method: request.method,
          auth: request.headers.get('authorization'),
          body: text ? (JSON.parse(text) as unknown) : null,
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
    expect(seen).toEqual([
      { method: 'GET', auth: 'Bearer token-a', body: null },
      {
        method: 'PUT',
        auth: 'Bearer token-a',
        body: { runsColdWarm: 'cold', windTolerance: 'low', precipPreparedness: 'high' },
      },
    ])
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

describe('resolveWebNextStep (D8)', () => {
  function useProfileResponse(role: string, links: { status: string }[]) {
    useMswHandlers(
      http.get('*/api/v1/user/profile', () =>
        HttpResponse.json({
          user: {
            id: 'member-a',
            email: 'member@example.test',
            displayName: null,
            birthdate: null,
            role,
          },
          linkedGuardians: links.map((link, index) => ({
            guardianId: `guardian-${index}`,
            status: link.status,
            consentGrantedAt:
              link.status === 'granted' ? '2026-11-01T00:00:00.000Z' : null,
          })),
          linkedTeens: [],
        })
      )
    )
  }

  it('sends an active member to wardrobe onboarding', async () => {
    useProfileResponse('guardian', [])
    expect(await resolveWebNextStep('token')).toBe('/wardrobe/onboarding')
  })

  // Guardian consent is off (2026-11-16): a teen with no granted guardian is a member like any
  // other, never sent to the teen dashboard's consent status.
  it.each([[[]], [[{ status: 'pending' as const }]]])(
    'sends a teen with guardian links %j to onboarding',
    async (links) => {
      useProfileResponse('teen', links)
      expect(await resolveWebNextStep('token')).toBe('/wardrobe/onboarding')
    }
  )

  it('sends a consented teen to onboarding and falls back on a failure', async () => {
    useProfileResponse('teen', [{ status: 'pending' }, { status: 'granted' }])
    expect(await resolveWebNextStep('token')).toBe('/wardrobe/onboarding')
    useMswHandlers(
      http.get('*/api/v1/user/profile', () => HttpResponse.json({}, { status: 500 }))
    )
    expect(await resolveWebNextStep('token')).toBe('/wardrobe/onboarding')
  })
})
