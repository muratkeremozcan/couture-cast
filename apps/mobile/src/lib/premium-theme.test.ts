// Story 5.3 Task 6: the mobile premium theme network boundary.
//
// Everything here is asserted through MSW against the real generated client, the
// way `commerce.test.ts` covers its own boundary: the failure taxonomy is only
// worth anything if the status codes really map onto it, and a hand-stubbed
// client would prove the mapping against a fiction. The section's rendering of
// these reasons is covered in `src/screens/settings-premium-theme-section.test.tsx`.
import { http, HttpResponse } from 'msw'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { premiumThemeKeySchema } from '@couture/api-client/contracts/http'

import { server } from '../test-utils/msw/server'
import { setMobileAccessTokenResolver } from './mobile-auth'
import {
  getThemeFromMobile,
  premiumThemeFailureReason,
  resolvePremiumThemeKey,
  setThemeFromMobile,
  PREMIUM_THEME_KEYS,
} from './premium-theme'

const THEME_ROUTE = '*/api/v1/commerce/premium/theme'

/** The shared error envelope: `.strict()` over `{ statusCode, message, error }`. */
const errorEnvelope = (statusCode: number, message: string) =>
  HttpResponse.json({ statusCode, message, error: 'Error' }, { status: statusCode })

describe('mobile premium theme boundary', () => {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
  })

  beforeEach(() => {
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
  })

  describe('PREMIUM_THEME_KEYS', () => {
    it('5.3-MOB-001 lists the contract enum in gallery order', () => {
      expect([...PREMIUM_THEME_KEYS]).toEqual([
        'jewel_radiance',
        'autumn_umber',
        'winter_metallic',
      ])
    })

    /**
     * `ZodEnum.options` hands out the schema's own live array, and this repository
     * contains code that mutates exactly that array by reference
     * (`preserveNullableEnumValues` pushes `null` into `_def.values`). Aliasing it
     * would let an unrelated module grow the gallery a fourth card with no palette
     * behind it, and `readonly` is erased at runtime, so only a copy prevents it.
     */
    it('5.3-MOB-002 is a copy of the contract enum, not an alias of it', () => {
      expect(PREMIUM_THEME_KEYS).not.toBe(premiumThemeKeySchema.options)
      expect(Object.isFrozen(PREMIUM_THEME_KEYS)).toBe(true)
    })
  })

  describe('resolvePremiumThemeKey', () => {
    it.each(['jewel_radiance', 'autumn_umber', 'winter_metallic'] as const)(
      '5.3-MOB-003 keeps the shipped palette %s',
      (key) => {
        expect(resolvePremiumThemeKey(key)).toBe(key)
      }
    )

    it.each([['spring_bloom'], [''], [null], [undefined], [42], [{}]])(
      '5.3-MOB-011 resolves the unrenderable value %o to Default',
      (value) => {
        expect(resolvePremiumThemeKey(value)).toBeNull()
      }
    )
  })

  describe('getThemeFromMobile', () => {
    it('5.3-MOB-004 returns the server-resolved palette, entitlement and flag together', async () => {
      server.use(
        http.get(THEME_ROUTE, () =>
          HttpResponse.json({
            data: { theme: 'autumn_umber', isEntitled: true, themesEnabled: true },
          })
        )
      )

      await expect(getThemeFromMobile()).resolves.toEqual({
        theme: 'autumn_umber',
        isEntitled: true,
        themesEnabled: true,
      })
    })

    /**
     * AC 6's first failure mode: a key from a palette this build predates. It has
     * to degrade to Default rather than fail the strict envelope parse, which would
     * land the whole section in its error state over a value the server already
     * treats as "no choice".
     */
    it('5.3-MOB-011a degrades a stale palette key to Default instead of throwing', async () => {
      server.use(
        http.get(THEME_ROUTE, () =>
          HttpResponse.json({
            data: { theme: 'spring_bloom', isEntitled: true, themesEnabled: true },
          })
        )
      )

      await expect(getThemeFromMobile()).resolves.toEqual({
        theme: null,
        isEntitled: true,
        themesEnabled: true,
      })
    })

    /**
     * Only `data.theme` is rewritten before parsing; everything else still goes
     * through `.strict()`, so a response that grew a field is still a hard failure
     * rather than something the client silently accepts.
     */
    it('5.3-MOB-005 still rejects an off-contract response body', async () => {
      server.use(
        http.get(THEME_ROUTE, () =>
          HttpResponse.json({
            data: {
              theme: null,
              isEntitled: true,
              themesEnabled: true,
              surprise: 'field',
            },
          })
        )
      )

      await expect(getThemeFromMobile()).rejects.toThrow()
      await getThemeFromMobile().catch((error: unknown) => {
        expect(premiumThemeFailureReason(error)).toBe('unknown')
      })
    })

    it.each([
      [401, 'signed_out'],
      [403, 'not_entitled'],
      [503, 'themes_disabled'],
      [500, 'unknown'],
    ] as const)('5.3-MOB-006 maps HTTP %i onto the reason %s', async (status, reason) => {
      server.use(http.get(THEME_ROUTE, () => errorEnvelope(status, 'Server said no.')))

      await getThemeFromMobile().then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect(premiumThemeFailureReason(error)).toBe(reason)
          // Developer-facing: the server's own text survives for logs and test
          // failures. The section renders a catalog string instead.
          expect((error as Error).message).toBe('Server said no.')
        }
      )
    })

    /**
     * The guard against a caller that skipped the session check. It must reject
     * before any request is issued, so a signed-out reader never produces a 401 in
     * the server's logs on every app launch.
     */
    it('5.3-MOB-007 rejects as signed_out without issuing a request when there is no token', async () => {
      restoreAccessTokenResolver?.()
      restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)

      let requested = false
      server.use(
        http.get(THEME_ROUTE, () => {
          requested = true
          return HttpResponse.json({
            data: { theme: null, isEntitled: false, themesEnabled: true },
          })
        })
      )

      await getThemeFromMobile().then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect(premiumThemeFailureReason(error)).toBe('signed_out')
        }
      )
      expect(requested).toBe(false)
    })
  })

  describe('setThemeFromMobile', () => {
    it('5.3-MOB-008 sends the chosen palette and returns the freshly resolved state', async () => {
      let received: unknown
      server.use(
        http.put(THEME_ROUTE, async ({ request }) => {
          received = await request.json()
          return HttpResponse.json({
            data: { theme: 'jewel_radiance', isEntitled: true, themesEnabled: true },
          })
        })
      )

      await expect(setThemeFromMobile('jewel_radiance')).resolves.toEqual({
        theme: 'jewel_radiance',
        isEntitled: true,
        themesEnabled: true,
      })
      expect(received).toEqual({ theme: 'jewel_radiance' })
    })

    /**
     * Reset is `theme: null` on the same route, not a DELETE: the stored row is
     * upserted to null and never removed, so "reset to Default" and "never chose"
     * stay distinguishable server-side (Decision 8).
     */
    it('5.3-MOB-009 resets to Default by sending an explicit null', async () => {
      let received: unknown
      server.use(
        http.put(THEME_ROUTE, async ({ request }) => {
          received = await request.json()
          return HttpResponse.json({
            data: { theme: null, isEntitled: true, themesEnabled: true },
          })
        })
      )

      await expect(setThemeFromMobile(null)).resolves.toEqual({
        theme: null,
        isEntitled: true,
        themesEnabled: true,
      })
      expect(received).toEqual({ theme: null })
    })

    it.each([
      [403, 'not_entitled'],
      [503, 'themes_disabled'],
    ] as const)(
      '5.3-MOB-010a maps a rejected write with HTTP %i onto the reason %s',
      async (status, reason) => {
        server.use(http.put(THEME_ROUTE, () => errorEnvelope(status, 'Write refused.')))

        await setThemeFromMobile('winter_metallic').then(
          () => expect.unreachable('the write should have rejected'),
          (error: unknown) => {
            expect(premiumThemeFailureReason(error)).toBe(reason)
          }
        )
      }
    )
  })

  describe('premiumThemeFailureReason', () => {
    it("reads 'unknown' from anything this module didn't throw", () => {
      expect(premiumThemeFailureReason(new Error('bare'))).toBe('unknown')
      expect(premiumThemeFailureReason('nope')).toBe('unknown')
    })
  })

  /**
   * TEA coverage-gate follow-up: `readServerMessage`'s own two branches and the
   * transport-failure catch-all, none of which the status-code table above
   * reaches: every case there replies with a well-formed JSON error body.
   */
  describe('malformed and transport failures', () => {
    it('falls back to a generic message when the error body is not JSON', async () => {
      server.use(
        http.get(THEME_ROUTE, () =>
          HttpResponse.text('<html>down</html>', { status: 500 })
        )
      )

      await getThemeFromMobile().then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect((error as Error).message).toBe('Unable to load your interface palette.')
        }
      )
    })

    it('falls back to a generic message when the error body has no message field', async () => {
      server.use(
        http.get(THEME_ROUTE, () =>
          HttpResponse.json({ statusCode: 500 }, { status: 500 })
        )
      )

      await getThemeFromMobile().then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect((error as Error).message).toBe('Unable to load your interface palette.')
        }
      )
    })

    /**
     * A network-level failure never reaches the generated client's status-code
     * handling: `fetch` itself rejects, with whatever `AbortSignal.reason` is in
     * play, distinct from every case above (all of which reject with a
     * `ResponseError` wrapping a real HTTP response).
     */
    it('classifies a transport failure as unknown and keeps an Error message', async () => {
      server.use(http.get(THEME_ROUTE, () => HttpResponse.error()))

      await getThemeFromMobile().then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect(premiumThemeFailureReason(error)).toBe('unknown')
          expect(typeof (error as Error).message).toBe('string')
        }
      )
    })

    /** The same catch-all path, but the rejection value itself is not an `Error`. */
    it('falls back to the caller message when the thrown value is not an Error', async () => {
      const controller = new AbortController()
      controller.abort('a plain string reason')

      await getThemeFromMobile(controller.signal).then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect(premiumThemeFailureReason(error)).toBe('unknown')
          expect((error as Error).message).toBe('Unable to load your interface palette.')
        }
      )
    })
  })
})
