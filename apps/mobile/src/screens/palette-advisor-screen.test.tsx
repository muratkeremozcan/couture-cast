// Learning path Step 36: Colour palette, beauty and accessory advisor.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-36-colour-palette-beauty-and-accessory-advisor
// Story 5.4 Task 8 owner: the mobile colour palette & beauty/accessory advisor screen.
//
// The mobile counterpart of `apps/web/src/app/components/palette-advisor-panel.test.tsx`.
// The network boundary stays REAL and is driven through MSW: the screen's whole job is
// turning HTTP outcomes into rendered states, and three of those states are reached only
// by a *rejected* write (403 no-consent, 403 not-entitled, 503 kill switch), so stubbing
// the lib would leave exactly the interesting half unproven.
//
// Only the native modules are mocked, and only the ones the screen genuinely touches:
// `expo-image-picker`, `expo-image-manipulator`, `expo-file-system` and `expo-crypto`
// cannot be evaluated in a browser bundle at all. `@/src/lib/commerce` is deliberately
// NOT mocked -- `palette-advisor.ts` imports `withRequestTimeout` from it, and replacing
// that with a `vi.fn()` would silently stop every request this suite is meant to make.
/*
 * `vitest-browser-react`'s `render` and this repo's `press` helper both return
 * plain values rather than promises, but every sibling screen suite awaits them
 * so the call sites read the same whichever helper is in use. Same disable, same
 * reason, as `settings-premium-theme-section.test.tsx`.
 */
/* eslint-disable @typescript-eslint/await-thenable */
import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ADVISOR_RULES,
  ADVISOR_RULES_VERSION,
  type AdvisorRecommendationCard,
  PALETTE_ANALYSIS_DISABLED_MESSAGE,
  PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE,
  PALETTE_CONSENT_REQUIRED_MESSAGE,
  PREMIUM_REQUIRED_MESSAGE,
  type PaletteAdvisorProfile,
} from '@couture/api-client/contracts/http'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const imagePicker = vi.hoisted(() => ({
  requestMediaLibraryPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  launchImageLibraryAsync: vi.fn().mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///selfie.jpg', width: 3024, height: 4032 }],
  }),
}))
vi.mock('expo-image-picker', () => imagePicker)

const imageManipulator = vi.hoisted(() => ({
  manipulateAsync: vi
    .fn()
    .mockResolvedValue({ uri: 'file:///resized.png', width: 1152, height: 1536 }),
}))
vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: imageManipulator.manipulateAsync,
  SaveFormat: { PNG: 'png' },
}))

vi.mock('expo-file-system', () => ({
  File: class {
    uri: string
    constructor(uri: string) {
      this.uri = uri
    }
    bytes() {
      return Promise.resolve(new Uint8Array([1, 2, 3, 4]))
    }
  },
  Paths: { cache: 'file:///cache/' },
}))

vi.mock('expo-crypto', () => ({
  digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  randomUUID: vi.fn(() => '11111111-1111-4111-8111-111111111111'),
}))

/*
 * `expo-web-browser` is deliberately NOT mocked, and the outbound handoff is
 * deliberately not asserted here.
 *
 * `src/lib/commerce.ts` imports it lazily precisely because it pulls in
 * `expo-modules-core`, which cannot be evaluated in a browser bundle at all.
 * Declaring a `vi.mock` for it makes Vite resolve the specifier anyway, which
 * wedges the optimizer and took three unrelated suites down with
 * "Cannot read properties of undefined (reading 'EventEmitter')" from
 * `expo-asset` -- exactly the hazard `vitest.config.ts` documents at length.
 *
 * What matters at this tier is the load-bearing half: the click is minted with
 * the right body BEFORE any navigation, so traffic the partner cannot attribute
 * is never sent. Story 5.1's own `hero-affiliate-cta.test.tsx` draws the same
 * line, and the handoff itself is shared code it already covers.
 */

import i18n, { initI18n } from '../lib/i18n'
import { server } from '../test-utils/msw/server'
import { press } from '../test-utils/press'
import { setMobileAccessTokenResolver } from '../lib/mobile-auth'
import { PaletteAdvisorScreen } from '../features/premium/palette-advisor-screen'

const PALETTE_ROUTE = '*/api/v1/commerce/premium/palette'
const CLICKS_ROUTE = '*/api/v1/commerce/affiliate/clicks'

const FOUNDATION_WARM_MEDIUM = ADVISOR_RULES.warm.foundation.withDepth.medium
const FOUNDATION_WARM_FAMILY = ADVISOR_RULES.warm.foundation.withoutDepth

type ProfileOverrides = Partial<PaletteAdvisorProfile>

function profile(overrides: ProfileOverrides = {}): PaletteAdvisorProfile {
  return {
    profileId: 'palette-profile-1',
    isEntitled: true,
    analysisEnabled: true,
    hasConsent: false,
    analysis: null,
    recommendations: [],
    ...overrides,
  } as PaletteAdvisorProfile
}

function readyAnalysis(depth: 'medium' | null) {
  return {
    status: 'ready' as const,
    failureReason: null,
    source: depth === null ? ('wardrobe' as const) : ('selfie' as const),
    undertone: 'warm' as const,
    depth,
    confidence: 0.82,
    // The contract's own constant, not a copy of its current value: a rules
    // bump must not silently turn every ready-state fixture here into the
    // stale-palette case 5.4-MOB-023 owns.
    analysisVersion: ADVISOR_RULES_VERSION,
    analyzedAt: '2026-08-25T10:00:00.000Z',
  }
}

function card(
  entry: { itemKey: string; labelKey: string; swatchHex: string },
  overrides: Partial<AdvisorRecommendationCard> = {}
): AdvisorRecommendationCard {
  return {
    slot: 'foundation',
    itemKey: entry.itemKey,
    labelKey: entry.labelKey,
    swatchHex: entry.swatchHex,
    saved: false,
    sponsored: null,
    ...overrides,
  }
}

function servePalette(overrides: ProfileOverrides = {}) {
  server.use(
    http.get(PALETTE_ROUTE, () => HttpResponse.json({ data: profile(overrides) }))
  )
}

const errorEnvelope = (statusCode: number, message: string) =>
  HttpResponse.json({ statusCode, message, error: 'Error' }, { status: statusCode })

describe('PaletteAdvisorScreen (Story 5.4)', () => {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    imagePicker.requestMediaLibraryPermissionsAsync.mockClear()
    imagePicker.launchImageLibraryAsync.mockClear()
    imageManipulator.manipulateAsync.mockClear()
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
  })

  it('5.4-MOB-010 renders the signed-out locked panel with no session', async () => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)
    await render(<PaletteAdvisorScreen />)

    const locked = await screen.findByTestId('palette-advisor-locked')
    expect(locked.textContent).toContain('Sign in and subscribe to Premium')
    expect(screen.queryByTestId('palette-advisor-consent')).toBeNull()
  })

  it('5.4-MOB-011 renders the not-entitled locked panel for a signed-in reader', async () => {
    servePalette({ isEntitled: false })
    await render(<PaletteAdvisorScreen />)

    const locked = await screen.findByTestId('palette-advisor-locked')
    expect(locked.textContent).toContain('Subscribe to Premium from Settings')
    expect(screen.queryByTestId('palette-advisor-consent')).toBeNull()
  })

  it('5.4-MOB-012 explains and disables the controls when the kill switch is off', async () => {
    servePalette({ analysisEnabled: false })
    await render(<PaletteAdvisorScreen />)

    await screen.findByTestId('palette-advisor-unavailable')
    const grant = screen.getByTestId('palette-advisor-consent-grant')
    expect(grant.getAttribute('aria-disabled')).toBe('true')
  })

  it('5.4-MOB-013 hides the sources until consent is granted, then reveals both', async () => {
    servePalette()
    let sentBody: unknown = null
    server.use(
      http.post(`${PALETTE_ROUTE}/consent`, async ({ request }) => {
        sentBody = await request.json()
        return HttpResponse.json({ data: profile({ hasConsent: true }) })
      })
    )
    await render(<PaletteAdvisorScreen />)

    await screen.findByTestId('palette-advisor-consent-grant')
    expect(screen.queryByTestId('palette-advisor-sources')).toBeNull()

    await press(screen.getByTestId('palette-advisor-consent-grant'))

    await screen.findByTestId('palette-advisor-sources')
    expect(sentBody).toEqual({ granted: true })
    expect(screen.getByTestId('palette-advisor-source-wardrobe')).toBeTruthy()
    expect(screen.getByTestId('palette-advisor-source-selfie')).toBeTruthy()
  })

  it('5.4-MOB-014 confirms before withdrawing consent, then erases through DELETE', async () => {
    servePalette({ hasConsent: true, analysis: readyAnalysis(null) })
    let deleted = false
    server.use(
      http.delete(PALETTE_ROUTE, () => {
        deleted = true
        return HttpResponse.json({ data: profile({ hasConsent: false, analysis: null }) })
      })
    )
    await render(<PaletteAdvisorScreen />)

    await press(await screen.findByTestId('palette-advisor-consent-revoke'))
    expect(deleted).toBe(false)
    expect(screen.getByTestId('palette-advisor-erase-confirm')).toBeTruthy()

    await press(screen.getByTestId('palette-advisor-erase-confirm-yes'))

    await waitFor(() => expect(deleted).toBe(true))
    await screen.findByTestId('palette-advisor-consent-grant')
  })

  it('5.4-MOB-015 starts a wardrobe analysis without an upload', async () => {
    servePalette({ hasConsent: true })
    let sentBody: unknown = null
    server.use(
      http.post(`${PALETTE_ROUTE}/analyze`, async ({ request }) => {
        sentBody = await request.json()
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
          }),
        })
      })
    )
    await render(<PaletteAdvisorScreen />)

    await press(await screen.findByTestId('palette-advisor-source-wardrobe'))

    await waitFor(() =>
      expect(screen.getByTestId('palette-advisor-status').textContent).toContain(
        'Analyzing your palette'
      )
    )
    expect(sentBody).toEqual({ source: 'wardrobe' })
    expect(imagePicker.launchImageLibraryAsync).not.toHaveBeenCalled()
  })

  /**
   * AC 3. The whole selfie lifecycle, with only the native picker replaced: the
   * allocate declaration, the raw-byte PUT, and the commit that shares one idempotency
   * key with the allocate.
   */
  it('5.4-MOB-016 uploads a selfie through allocate, bytes and commit on one key', async () => {
    servePalette({ hasConsent: true })
    const seen: Record<string, unknown> = {}
    server.use(
      http.post(`${PALETTE_ROUTE}/selfie/upload-url`, async ({ request }) => {
        // Body BEFORE key, here and in the commit handler below, and the order
        // is load-bearing rather than stylistic. The assertions gate on
        // `waitFor(() => expect(seen.commitKey).toBeTruthy())`; a key recorded
        // synchronously from the headers is set one microtask before
        // `await request.json()` resolves, so the gate could open while
        // `seen.commitBody` was still undefined. Locally that microtask always
        // won the race and this passed; on a loaded CI runner it lost, and the
        // suite failed with "expected undefined to deeply equal
        // { uploadSessionId: 'session-1' }". Recording the body first makes the
        // key's truthiness mean the whole request was captured.
        seen.declaration = await request.json()
        seen.allocateKey = request.headers.get('idempotency-key')
        return HttpResponse.json({
          data: {
            uploadSessionId: 'session-1',
            uploadUrl: `${window.location.origin}/api/v1/commerce/premium/palette/selfie/uploads/session-1`,
            uploadToken: 'upload-token',
            requiredHeaders: { 'content-type': 'image/png' },
            expiresAt: '2026-08-25T10:15:00.000Z',
          },
        })
      }),
      http.put(`${PALETTE_ROUTE}/selfie/uploads/session-1`, ({ request }) => {
        seen.bytesToken = request.headers.get('x-upload-token')
        seen.bytesType = request.headers.get('content-type')
        return new HttpResponse(null, { status: 204 })
      }),
      http.post(`${PALETTE_ROUTE}/selfie/commit`, async ({ request }) => {
        seen.commitBody = await request.json()
        seen.commitKey = request.headers.get('idempotency-key')
        return HttpResponse.json({
          data: profile({
            hasConsent: true,
            analysis: {
              status: 'processing',
              failureReason: null,
              source: 'selfie',
              undertone: null,
              depth: null,
              confidence: null,
              analysisVersion: null,
              analyzedAt: null,
            },
          }),
        })
      })
    )
    await render(<PaletteAdvisorScreen />)

    await press(await screen.findByTestId('palette-advisor-source-selfie'))

    await waitFor(() => expect(seen.commitKey).toBeTruthy())
    expect(seen.allocateKey).toBe(seen.commitKey)
    expect(seen.commitBody).toEqual({ uploadSessionId: 'session-1' })
    expect(seen.bytesToken).toBe('upload-token')
    // PNG, not JPEG: JPEG's 4:2:0 chroma subsampling discards exactly the Cb/Cr
    // channels the server's skin-chroma gate reads.
    expect(seen.bytesType).toBe('image/png')
    expect(seen.declaration).toMatchObject({
      mimeType: 'image/png',
      widthPx: 1152,
      heightPx: 1536,
    })
    expect(imagePicker.requestMediaLibraryPermissionsAsync).toHaveBeenCalled()
  })

  it('5.4-MOB-017 does nothing when the picker is cancelled', async () => {
    servePalette({ hasConsent: true })
    imagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: true,
      assets: null,
    })
    await render(<PaletteAdvisorScreen />)

    await press(await screen.findByTestId('palette-advisor-source-selfie'))

    await waitFor(() =>
      expect(imagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1)
    )
    expect(imageManipulator.manipulateAsync).not.toHaveBeenCalled()
    expect(screen.queryByTestId('palette-advisor-error')).toBeNull()
  })

  it('5.4-MOB-018 labels a depth-less palette and explains the degraded foundation', async () => {
    servePalette({
      hasConsent: true,
      analysis: readyAnalysis(null),
      recommendations: [card(FOUNDATION_WARM_FAMILY)],
    })
    await render(<PaletteAdvisorScreen />)

    expect((await screen.findByTestId('palette-advisor-depth')).textContent).toContain(
      'Not measured'
    )
    expect(
      screen.getByTestId('palette-advisor-foundation-depth-unknown').textContent
    ).toContain('a shade family rather than an exact match')
    expect(screen.getByTestId('palette-advisor-undertone').textContent).toContain('Warm')
    expect(screen.getByTestId('palette-advisor-confidence').textContent).toContain('82%')
  })

  it('5.4-MOB-019 renders localized failure copy, never a server string', async () => {
    servePalette({
      hasConsent: true,
      analysis: {
        status: 'failed',
        failureReason: 'no_face',
        source: 'selfie',
        undertone: null,
        depth: null,
        confidence: null,
        analysisVersion: null,
        analyzedAt: null,
      },
    })
    await render(<PaletteAdvisorScreen />)

    expect((await screen.findByTestId('palette-advisor-failure')).textContent).toContain(
      'could not find enough skin tone'
    )
  })

  it('5.4-MOB-020 renders shade names from their locale keys', async () => {
    servePalette({
      hasConsent: true,
      analysis: readyAnalysis('medium'),
      recommendations: [card(FOUNDATION_WARM_MEDIUM)],
    })
    await render(<PaletteAdvisorScreen />)

    expect(
      (
        await screen.findByTestId(
          `palette-advisor-label-${FOUNDATION_WARM_MEDIUM.itemKey}`
        )
      ).textContent
    ).toContain('Honey beige')
  })

  it('5.4-MOB-021 renders the sponsored disclosure before its CTA and mints the click', async () => {
    const key = FOUNDATION_WARM_MEDIUM.itemKey
    servePalette({
      hasConsent: true,
      analysis: readyAnalysis('medium'),
      recommendations: [
        card(FOUNDATION_WARM_MEDIUM, {
          sponsored: {
            partnerId: 'lumen-beauty',
            partnerDisplayName: 'Lumen Beauty',
            offerId: 'offer-foundation-1',
            offerTitle: 'Lumen Skin Tint',
          },
        }),
      ],
    })
    let clickBody: unknown = null
    server.use(
      http.post(CLICKS_ROUTE, async ({ request }) => {
        clickBody = await request.json()
        return HttpResponse.json({
          data: { redirectUrl: 'https://partner.example/offer?click=abc' },
        })
      })
    )
    await render(<PaletteAdvisorScreen />)

    const disclosure = await screen.findByTestId(
      `palette-advisor-sponsored-disclosure-${key}`
    )
    const cta = screen.getByTestId(`palette-advisor-sponsored-cta-${key}`)
    expect(disclosure.textContent).toContain('CoutureCast earns a commission')
    expect(
      disclosure.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    await press(cta)

    await waitFor(() =>
      expect(clickBody).toEqual({
        offerId: 'offer-foundation-1',
        recommendationId: 'palette-profile-1',
        surface: 'palette_advisor',
        platform: 'mobile',
      })
    )
  })

  it('5.4-MOB-022 removes a dismissed card and restores it with undo', async () => {
    const key = FOUNDATION_WARM_MEDIUM.itemKey
    const bodies: unknown[] = []
    let dismissed = false
    const body = () =>
      HttpResponse.json({
        data: profile({
          hasConsent: true,
          analysis: readyAnalysis('medium'),
          recommendations: dismissed ? [] : [card(FOUNDATION_WARM_MEDIUM)],
        }),
      })
    server.use(
      http.get(PALETTE_ROUTE, body),
      http.put(`${PALETTE_ROUTE}/recommendations`, async ({ request }) => {
        const sent = await request.json()
        bodies.push(sent)
        dismissed = (sent as { action: string | null }).action === 'dismissed'
        return body()
      })
    )
    await render(<PaletteAdvisorScreen />)

    await press(await screen.findByTestId(`palette-advisor-dismiss-${key}`))

    await waitFor(() =>
      expect(screen.queryByTestId(`palette-advisor-card-${key}`)).toBeNull()
    )
    expect(bodies[0]).toEqual({ itemKey: key, slot: 'foundation', action: 'dismissed' })

    // The undo control is disabled while any write is in flight, and the busy flag
    // clears one state update after the card list does. Pressing before that lands is a
    // no-op, so wait for the control to be live rather than for the list alone.
    await waitFor(() =>
      expect(
        screen.getByTestId('palette-advisor-undo-dismiss').getAttribute('aria-disabled')
      ).not.toBe('true')
    )
    await press(screen.getByTestId('palette-advisor-undo-dismiss'))

    await screen.findByTestId(`palette-advisor-card-${key}`)
    expect(bodies[1]).toEqual({ itemKey: key, slot: 'foundation', action: null })
  })

  /**
   * A `ready` analysis stamped with a version this build has replaced.
   *
   * THE ORIGINAL FRAMING OF THIS TEST WAS HALF WRONG and the correction is
   * worth keeping. It read the empty card list as the consequence of the
   * retired version -- "every stored `item_key` resolves to nothing" -- but
   * `PaletteAdvisorService.resolveRecommendations` builds its cards from the
   * CURRENT `ADVISOR_RULES` keyed on the stored undertone and depth, and never
   * consults `analysis_version` at all. A version bump therefore yields cards,
   * not an empty list; the empty list here is simply what the fixture serves,
   * and it stays because rendering nothing must not crash the surface either.
   *
   * What the retired version genuinely costs the reader is the palette above
   * the cards: an undertone, a depth and a confidence derived under rules this
   * build has retired, presented as though they were current. That is what the
   * note asserted below exists to say.
   */
  it('5.4-MOB-023 explains a ready palette from a retired analysis version', async () => {
    servePalette({
      hasConsent: true,
      analysis: { ...readyAnalysis('medium'), analysisVersion: 'palette-advisor-v99' },
      recommendations: [],
    })
    await render(<PaletteAdvisorScreen />)

    await screen.findByTestId('palette-advisor-result')
    expect(screen.getByTestId('palette-advisor-stale-version').textContent).toContain(
      'came from an earlier version'
    )
    expect(screen.getByTestId('palette-advisor-recommendations').textContent).toBe('')
    expect(screen.queryByTestId('palette-advisor-error')).toBeNull()
    // The affordance the note points at. Nothing else can refresh the palette:
    // Decision 8 purged the selfie when the last analysis terminated.
    expect(screen.getByTestId('palette-advisor-source-wardrobe')).toBeTruthy()
  })

  it('5.4-MOB-031 leaves the stale note off a current palette', async () => {
    servePalette({
      hasConsent: true,
      analysis: readyAnalysis('medium'),
      recommendations: [card(FOUNDATION_WARM_MEDIUM)],
    })
    await render(<PaletteAdvisorScreen />)

    await screen.findByTestId('palette-advisor-result')
    expect(screen.queryByTestId('palette-advisor-stale-version')).toBeNull()
  })

  describe('rejected writes re-resolve the screen', () => {
    it('5.4-MOB-024 falls back to the consent gate on a 403 consent-required', async () => {
      servePalette({
        hasConsent: true,
        analysis: readyAnalysis('medium'),
        recommendations: [card(FOUNDATION_WARM_MEDIUM)],
      })
      server.use(
        http.put(`${PALETTE_ROUTE}/recommendations`, () =>
          errorEnvelope(403, PALETTE_CONSENT_REQUIRED_MESSAGE)
        )
      )
      await render(<PaletteAdvisorScreen />)

      await press(
        await screen.findByTestId(
          `palette-advisor-save-${FOUNDATION_WARM_MEDIUM.itemKey}`
        )
      )

      await screen.findByTestId('palette-advisor-consent-grant')
      expect(document.body.textContent).not.toContain(PALETTE_CONSENT_REQUIRED_MESSAGE)
    })

    it('5.4-MOB-025 falls back to the locked panel on a 403 premium-required', async () => {
      servePalette({
        hasConsent: true,
        analysis: readyAnalysis('medium'),
        recommendations: [card(FOUNDATION_WARM_MEDIUM)],
      })
      server.use(
        http.put(`${PALETTE_ROUTE}/recommendations`, () =>
          errorEnvelope(403, PREMIUM_REQUIRED_MESSAGE)
        )
      )
      await render(<PaletteAdvisorScreen />)

      await press(
        await screen.findByTestId(
          `palette-advisor-save-${FOUNDATION_WARM_MEDIUM.itemKey}`
        )
      )

      await screen.findByTestId('palette-advisor-locked')
      expect(document.body.textContent).not.toContain(PREMIUM_REQUIRED_MESSAGE)
    })

    /**
     * The three write-path doors the four reason states above leave untouched.
     * `applyWriteFailure` argues in its own docblock that a rejected write must
     * re-resolve the screen rather than print a line, and coverage put the
     * `signed_out` case, the `in_progress` case and the generic fallback all at
     * zero -- the same gap the web panel had, on the surface where a session can
     * also expire while the app sits in the background.
     */
    it('5.4-MOB-027 drops to the signed-out state when a write is refused as signed out', async () => {
      servePalette({
        hasConsent: true,
        analysis: readyAnalysis('medium'),
        recommendations: [card(FOUNDATION_WARM_MEDIUM)],
      })
      server.use(
        http.put(`${PALETTE_ROUTE}/recommendations`, () =>
          errorEnvelope(401, 'Unauthorized')
        )
      )
      await render(<PaletteAdvisorScreen />)

      await press(
        await screen.findByTestId(
          `palette-advisor-save-${FOUNDATION_WARM_MEDIUM.itemKey}`
        )
      )

      await screen.findByTestId('palette-advisor-locked')
      expect(
        screen.queryByTestId('palette-advisor-recommendations')
      ).not.toBeInTheDocument()
    })

    it('5.4-MOB-028 re-reads the server rather than erroring when an analysis is already running', async () => {
      let getCount = 0
      server.use(
        http.get(PALETTE_ROUTE, () => {
          getCount += 1
          return HttpResponse.json({
            data: profile(
              getCount === 1
                ? { hasConsent: true }
                : {
                    hasConsent: true,
                    analysis: {
                      status: 'processing' as const,
                      failureReason: null,
                      source: 'wardrobe' as const,
                      undertone: null,
                      depth: null,
                      confidence: null,
                      analysisVersion: null,
                      analyzedAt: null,
                    },
                  }
            ),
          })
        }),
        http.post(`${PALETTE_ROUTE}/analyze`, () =>
          errorEnvelope(409, PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE)
        )
      )
      await render(<PaletteAdvisorScreen />)

      await press(await screen.findByTestId('palette-advisor-source-wardrobe'))

      await waitFor(() => expect(getCount).toBeGreaterThan(1))
      expect(screen.queryByTestId('palette-advisor-error')).not.toBeInTheDocument()
      expect(document.body.textContent).not.toContain(
        PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE
      )
    })

    it('5.4-MOB-029 shows the translated fallback line for an unclassified write failure', async () => {
      servePalette({
        hasConsent: true,
        analysis: readyAnalysis('medium'),
        recommendations: [card(FOUNDATION_WARM_MEDIUM)],
      })
      server.use(
        http.put(`${PALETTE_ROUTE}/recommendations`, () =>
          errorEnvelope(500, 'Internal server error')
        )
      )
      await render(<PaletteAdvisorScreen />)

      await press(
        await screen.findByTestId(
          `palette-advisor-save-${FOUNDATION_WARM_MEDIUM.itemKey}`
        )
      )

      const error = await screen.findByTestId('palette-advisor-error')
      expect(error.textContent).not.toContain('Internal server error')
      // A generic failure is not evidence that entitlement lapsed or consent
      // was revoked, so the surface is left exactly as it was.
      expect(screen.getByTestId('palette-advisor-recommendations')).toBeInTheDocument()
    })

    it('5.4-MOB-030 shows the load-failure state when the first read fails, without leaking the server string', async () => {
      server.use(
        http.get(PALETTE_ROUTE, () => errorEnvelope(500, 'Internal server error'))
      )
      await render(<PaletteAdvisorScreen />)

      const error = await screen.findByTestId('palette-advisor-error')
      expect(error.textContent).not.toContain('Internal server error')
      expect(screen.queryByTestId('palette-advisor-sources')).not.toBeInTheDocument()
    })

    it('5.4-MOB-026 shows the kill-switch note on a 503', async () => {
      servePalette({ hasConsent: true })
      server.use(
        http.post(`${PALETTE_ROUTE}/analyze`, () =>
          errorEnvelope(503, PALETTE_ANALYSIS_DISABLED_MESSAGE)
        )
      )
      await render(<PaletteAdvisorScreen />)

      await press(await screen.findByTestId('palette-advisor-source-wardrobe'))

      await screen.findByTestId('palette-advisor-unavailable')
      expect(document.body.textContent).not.toContain(PALETTE_ANALYSIS_DISABLED_MESSAGE)
    })
  })
})
