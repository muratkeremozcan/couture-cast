// Learning path Step 35: Premium theme switcher.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-35-premium-theme-switcher
// Story 5.3 Task 5 owner: the web premium theme client.
//
// These go through MSW rather than a mocked SDK, so the request shape, the bearer
// header, the PUT body and the contract parsing are all exercised by the same tests
// that cover the failure paths.
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../test-utils/msw/runtime'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'
import {
  applyWebThemeAttribute,
  DEFAULT_THEME_ATTRIBUTE,
  getThemeFromWeb,
  hasWebSession,
  premiumThemeFailureReason,
  PREMIUM_THEME_KEYS,
  PREMIUM_THEME_SIGNED_OUT_MESSAGE,
  PremiumThemeRequestError,
  resolvePremiumThemeKey,
  setThemeFromWeb,
} from './premium-theme'

const THEME_PATH = '/api/v1/commerce/premium/theme'

afterEach(() => {
  window.sessionStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

function signIn(token = 'test-access-token') {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, token)
}

function themeBody(overrides: Record<string, unknown> = {}) {
  return { data: { theme: null, isEntitled: true, themesEnabled: true, ...overrides } }
}

describe('PREMIUM_THEME_KEYS', () => {
  /**
   * AC 1 and Decision 1/2: exactly three palettes ship. Spring Bloom is marked future
   * in the UX spec, and "Midnight Noir"/"Aurora Dawn" are the epic's and the PRD's
   * throwaway example names with no hex value anywhere in the repository. The list is
   * derived from the contract enum, so this fails the moment a fourth is added.
   */
  it('5.3-WEB-001 offers exactly the three UX-spec palettes and no Spring Bloom', () => {
    expect([...PREMIUM_THEME_KEYS]).toEqual([
      'jewel_radiance',
      'autumn_umber',
      'winter_metallic',
    ])
    expect(PREMIUM_THEME_KEYS).not.toContain('spring_bloom')
    expect(PREMIUM_THEME_KEYS).not.toContain('midnight_noir')
    expect(PREMIUM_THEME_KEYS).not.toContain('aurora_dawn')
  })
})

describe('resolvePremiumThemeKey', () => {
  it('5.3-WEB-002 keeps a known palette key', () => {
    for (const key of PREMIUM_THEME_KEYS) {
      expect(resolvePremiumThemeKey(key)).toBe(key)
    }
  })

  /** AC 6's first failure mode: a stale key resolves to Default rather than throwing. */
  it('5.3-WEB-003 resolves an unknown or malformed value to Default', () => {
    for (const value of ['spring_bloom', 'midnight_noir', '', null, undefined, 7, {}]) {
      expect(resolvePremiumThemeKey(value)).toBeNull()
    }
  })
})

describe('applyWebThemeAttribute', () => {
  // `5.3-WEB-010` is the matrix id for AC 4 and belongs to the section test that proves
  // the attribute lands on a real selection. This is the unit beneath it, so it carries
  // its own id: one id, one test, or a failure report names two tests in two tiers.
  it('5.3-WEB-008 writes the palette onto <html> and clears it for Default', () => {
    applyWebThemeAttribute('winter_metallic')
    expect(document.documentElement.getAttribute('data-theme')).toBe('winter_metallic')

    applyWebThemeAttribute(null)
    expect(document.documentElement.getAttribute('data-theme')).toBe('')
  })

  /**
   * `[data-theme='default']` exists so a Default gallery card can opt out of an active
   * palette's inherited custom properties. `<html>` deliberately does not use it: an
   * empty attribute falls through to `:root`, which is the same set of values.
   */
  it('5.3-WEB-004 never writes the card-only Default selector onto <html>', () => {
    applyWebThemeAttribute(null)
    // Both halves, because `not.toBe('default')` alone stayed green for a removed
    // attribute, for `'DEFAULT'`, and for any other value, none of which fall through
    // to `:root` the way this test's docblock claims.
    expect(document.documentElement.getAttribute('data-theme')).toBe('')
    expect(document.documentElement.getAttribute('data-theme')).not.toBe(
      DEFAULT_THEME_ATTRIBUTE
    )
  })

  it('5.3-WEB-005 is a no-op when there is no document', () => {
    vi.stubGlobal('document', undefined)
    try {
      expect(() => applyWebThemeAttribute('jewel_radiance')).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('hasWebSession', () => {
  /** Re-exported from `commerce.ts` rather than reimplemented; this pins that. */
  it('5.3-WEB-006 reads the same session key as the sibling clients', () => {
    expect(hasWebSession()).toBe(false)
    signIn()
    expect(hasWebSession()).toBe(true)
  })
})

/**
 * The reason is what the section branches on, so it is what carries AC 7: every message
 * this module can produce is untranslated English (the server's own `PREMIUM_*` text,
 * a transport error, the signed-out guard string), and none of it may reach a reader in
 * one of the other nine locales. Anything unclassifiable reads as `unknown`, which is
 * the conservative answer: the section shows its own translated copy rather than
 * inferring entitlement or flag state from a failure it could not classify.
 */
describe('premiumThemeFailureReason', () => {
  it('5.3-WEB-007 reads unknown for anything this module did not throw', () => {
    expect(premiumThemeFailureReason(new Error('boom'))).toBe('unknown')
    expect(premiumThemeFailureReason('boom')).toBe('unknown')
    expect(premiumThemeFailureReason(undefined)).toBe('unknown')
  })

  it.each([
    [401, 'signed_out'],
    [403, 'not_entitled'],
    [503, 'themes_disabled'],
    [500, 'unknown'],
    [502, 'unknown'],
  ])('5.3-WEB-013 classifies a %i as %s', async (status, expected) => {
    signIn()
    useMswHandlers(
      http.get(THEME_PATH, () => HttpResponse.json({ statusCode: status }, { status }))
    )

    await expect(getThemeFromWeb()).rejects.toMatchObject({ reason: expected })
  })

  it('5.3-WEB-014 keeps the signed-out reason rather than re-wrapping it as unknown', async () => {
    await expect(getThemeFromWeb()).rejects.toMatchObject({ reason: 'signed_out' })
    await expect(setThemeFromWeb('jewel_radiance')).rejects.toMatchObject({
      reason: 'signed_out',
    })
  })
})

describe('getThemeFromWeb', () => {
  it('5.3-WEB-020 reads the resolved theme with a bearer token', async () => {
    signIn()
    const seen = vi.fn<(method: string, authorization: string | null) => void>()
    useMswHandlers(
      http.get(THEME_PATH, ({ request }) => {
        seen(request.method, request.headers.get('authorization'))
        return HttpResponse.json(themeBody({ theme: 'jewel_radiance' }))
      })
    )

    await expect(getThemeFromWeb()).resolves.toEqual({
      theme: 'jewel_radiance',
      isEntitled: true,
      themesEnabled: true,
    })
    expect(seen).toHaveBeenCalledWith('GET', 'Bearer test-access-token')
  })

  it('5.3-WEB-021 refuses to call the API with no session', async () => {
    await expect(getThemeFromWeb()).rejects.toThrow(PREMIUM_THEME_SIGNED_OUT_MESSAGE)
    await expect(getThemeFromWeb()).rejects.toBeInstanceOf(PremiumThemeRequestError)
  })

  /**
   * AC 6: a palette key this build does not know degrades to Default instead of
   * failing the strict envelope parse and taking the whole section into its error
   * state. The server resolves stale keys too, so this is the second of two guards.
   */
  // AC 6's matrix id `5.3-WEB-011` is the section test; this is its lib-tier sibling.
  it('5.3-WEB-009 resolves an unknown stored palette to Default without throwing', async () => {
    signIn()
    useMswHandlers(
      http.get(THEME_PATH, () => HttpResponse.json(themeBody({ theme: 'spring_bloom' })))
    )

    await expect(getThemeFromWeb()).resolves.toEqual({
      theme: null,
      isEntitled: true,
      themesEnabled: true,
    })
  })

  /** Only `theme` is made tolerant. The rest of the envelope stays `.strict()`. */
  it('5.3-WEB-022 still rejects a payload that misses a contract field', async () => {
    signIn()
    useMswHandlers(
      http.get(THEME_PATH, () => HttpResponse.json({ data: { theme: null } }))
    )

    await expect(getThemeFromWeb()).rejects.toBeInstanceOf(PremiumThemeRequestError)
  })

  it('5.3-WEB-023 rejects an envelope carrying an unexpected property', async () => {
    signIn()
    useMswHandlers(
      http.get(THEME_PATH, () =>
        HttpResponse.json(themeBody({ surprise: 'extra-property' }))
      )
    )

    await expect(getThemeFromWeb()).rejects.toBeInstanceOf(PremiumThemeRequestError)
  })

  it('5.3-WEB-024 surfaces the server message on a failed read', async () => {
    signIn()
    useMswHandlers(
      http.get(THEME_PATH, () =>
        HttpResponse.json(
          {
            statusCode: 500,
            message: 'Unable to reach the palette service.',
            error: 'Internal Server Error',
          },
          { status: 500 }
        )
      )
    )

    await expect(getThemeFromWeb()).rejects.toThrow(
      'Unable to reach the palette service.'
    )
  })

  it('5.3-WEB-025 falls back when the failure body carries no usable message', async () => {
    signIn()
    useMswHandlers(
      http.get(THEME_PATH, () => HttpResponse.json({ statusCode: 500 }, { status: 500 }))
    )

    await expect(getThemeFromWeb()).rejects.toThrow(
      'Unable to load your interface palette.'
    )
  })

  /** A proxy or gateway erroring with HTML is a real failure mode, not a hypothetical. */
  it('5.3-WEB-026 falls back when the failure body is not JSON at all', async () => {
    signIn()
    useMswHandlers(
      http.get(
        THEME_PATH,
        () => new HttpResponse('<html>502 Bad Gateway</html>', { status: 502 })
      )
    )

    await expect(getThemeFromWeb()).rejects.toThrow(
      'Unable to load your interface palette.'
    )
  })

  /**
   * The stale-key tolerance is scoped to `data.theme` and nothing else: a body with no
   * envelope, or an envelope with no `theme`, is passed through untouched and fails the
   * strict parse. Without this the tolerance could quietly paper over a contract break.
   */
  it.each([
    ['no data envelope', { notData: true }],
    [
      'a data envelope with no theme',
      { data: { isEntitled: true, themesEnabled: true } },
    ],
  ])('5.3-WEB-027 still rejects %s', async (_label, body) => {
    signIn()
    useMswHandlers(http.get(THEME_PATH, () => HttpResponse.json(body)))

    await expect(getThemeFromWeb()).rejects.toBeInstanceOf(PremiumThemeRequestError)
  })
})

describe('setThemeFromWeb', () => {
  it('5.3-WEB-030 sends exactly the contract body and returns the resolved state', async () => {
    signIn()
    const bodies: unknown[] = []
    useMswHandlers(
      http.put(THEME_PATH, async ({ request }) => {
        bodies.push(await request.clone().json())
        return HttpResponse.json(themeBody({ theme: 'autumn_umber' }))
      })
    )

    await expect(setThemeFromWeb('autumn_umber')).resolves.toEqual({
      theme: 'autumn_umber',
      isEntitled: true,
      themesEnabled: true,
    })
    expect(bodies).toEqual([{ theme: 'autumn_umber' }])
  })

  /**
   * Decision 8: reset is `{ theme: null }`, an upsert. The client must not express it
   * as an omitted field or a DELETE, either of which the server reads differently.
   */
  it('5.3-WEB-031 resets to Default with an explicit null, not an omitted field', async () => {
    signIn()
    const bodies: unknown[] = []
    const methods: string[] = []
    useMswHandlers(
      http.put(THEME_PATH, async ({ request }) => {
        methods.push(request.method)
        bodies.push(await request.clone().json())
        return HttpResponse.json(themeBody({ theme: null }))
      })
    )

    await expect(setThemeFromWeb(null)).resolves.toMatchObject({ theme: null })
    expect(methods).toEqual(['PUT'])
    expect(bodies).toEqual([{ theme: null }])
  })

  it('5.3-WEB-032 refuses to write with no session', async () => {
    await expect(setThemeFromWeb('jewel_radiance')).rejects.toThrow(
      PREMIUM_THEME_SIGNED_OUT_MESSAGE
    )
  })

  /**
   * The server's own message still wins over the local fallback, because it is the most
   * useful text for a log line or a failing assertion. It is developer-facing only: both
   * of these strings are untranslated English, so the section renders the reason's
   * catalog copy instead (AC 7). The reason is asserted alongside the message here so
   * the two cannot drift apart.
   */
  it('5.3-WEB-033 surfaces the guard 403 and the kill-switch 503 messages verbatim', async () => {
    signIn()
    useMswHandlers(
      http.put(THEME_PATH, () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'A Premium subscription is required for this feature.',
            error: 'Forbidden',
          },
          { status: 403 }
        )
      )
    )
    await expect(setThemeFromWeb('jewel_radiance')).rejects.toMatchObject({
      message: 'A Premium subscription is required for this feature.',
      reason: 'not_entitled',
    })

    useMswHandlers(
      http.put(THEME_PATH, () =>
        HttpResponse.json(
          {
            statusCode: 503,
            message: 'Premium themes are temporarily unavailable.',
            error: 'Service Unavailable',
          },
          { status: 503 }
        )
      )
    )
    await expect(setThemeFromWeb('jewel_radiance')).rejects.toMatchObject({
      message: 'Premium themes are temporarily unavailable.',
      reason: 'themes_disabled',
    })
  })

  it('5.3-WEB-034 falls back when a failed write carries no message', async () => {
    signIn()
    useMswHandlers(
      http.put(THEME_PATH, () => HttpResponse.json({ statusCode: 500 }, { status: 500 }))
    )

    await expect(setThemeFromWeb('winter_metallic')).rejects.toThrow(
      'Unable to save your interface palette.'
    )
  })
})
