// Story 5.1 Task 6: the mobile commerce network boundary.
import { http, HttpResponse } from 'msw'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { openBrowserAsyncMock } = vi.hoisted(() => ({ openBrowserAsyncMock: vi.fn() }))

vi.mock('expo-web-browser', () => ({ openBrowserAsync: openBrowserAsyncMock }))

import { server } from '../test-utils/msw/server'
import { mockAffiliateRedirectUrl, mockShopThisLook } from '../test-utils/msw/handlers'
import { setMobileAccessTokenResolver } from './mobile-auth'
import {
  GLOBAL_LOCALE_REGION,
  getCommercePreferenceFromMobile,
  mintAffiliateClickFromMobile,
  openAffiliatePartnerSite,
  resolveAffiliateLocaleRegion,
  resolveRenderableShopThisLook,
  updateCommercePreferenceFromMobile,
} from './commerce'

const baseOutfit = {
  id: 'morning-outfit-id',
  scenario: 'morning' as const,
  garmentIds: ['classic-trench-coat'],
  reasoningBadges: [],
  comfortNotes: 'Mild morning.',
}

describe('mobile commerce boundary', () => {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
  })

  beforeEach(() => {
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    openBrowserAsyncMock.mockReset()
    openBrowserAsyncMock.mockResolvedValue({ type: 'dismiss' })
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
  })

  describe('resolveAffiliateLocaleRegion', () => {
    it.each([
      ['en-US', 'US'],
      ['en-CA', 'CA'],
      ['fr-CA', 'CA'],
      ['pt-BR', 'BR'],
      // A UN M.49 macro-region, not a country code. The catalog stores exactly
      // this string, so lowercasing or dropping it would silently unmatch every
      // Latin American offer.
      ['es-419', '419'],
    ])('maps %s to %s', (locale, expected) => {
      expect(resolveAffiliateLocaleRegion(locale)).toBe(expected)
    })

    it.each(['en', 'fr', '', 'x-klingon-toolongsubtag'])(
      'falls back to the global sentinel for %s',
      (locale) => {
        // Falling back to "no region" rather than "no offers" keeps an
        // unregioned UI language on the globally published catalog rows.
        expect(resolveAffiliateLocaleRegion(locale)).toBe(GLOBAL_LOCALE_REGION)
      }
    )
  })

  describe('resolveRenderableShopThisLook', () => {
    it('returns the offer for a network-served card that carries one', () => {
      expect(
        resolveRenderableShopThisLook(
          { ...baseOutfit, shopThisLook: mockShopThisLook },
          false
        )
      ).toEqual(mockShopThisLook)
    })

    it('returns null for a cache-served card, offer or not', () => {
      expect(
        resolveRenderableShopThisLook(
          { ...baseOutfit, shopThisLook: mockShopThisLook },
          true
        )
      ).toBeNull()
    })

    it('returns null when there is no card at all', () => {
      expect(resolveRenderableShopThisLook(undefined, false)).toBeNull()
    })

    it('returns null when the server marked the card ineligible', () => {
      expect(
        resolveRenderableShopThisLook({ ...baseOutfit, shopThisLook: null }, false)
      ).toBeNull()
    })
  })

  describe('preferences', () => {
    it('reads the stored preference', async () => {
      await expect(getCommercePreferenceFromMobile()).resolves.toEqual({
        affiliateCtasEnabled: true,
      })
    })

    it('writes the preference and returns the stored state', async () => {
      let received: unknown
      server.use(
        http.put('*/api/v1/commerce/preferences', async ({ request }) => {
          received = await request.json()
          return HttpResponse.json({ data: { affiliateCtasEnabled: false } })
        })
      )

      await expect(updateCommercePreferenceFromMobile(false)).resolves.toEqual({
        affiliateCtasEnabled: false,
      })
      expect(received).toEqual({ affiliateCtasEnabled: false })
    })

    it('rejects when the preference endpoint fails', async () => {
      server.use(
        http.get(
          '*/api/v1/commerce/preferences',
          () => new HttpResponse(null, { status: 500 })
        )
      )

      await expect(getCommercePreferenceFromMobile()).rejects.toBeDefined()
    })
  })

  describe('affiliate clicks', () => {
    it('sends only the three client-owned fields and returns the redirect URL', async () => {
      let received: unknown
      server.use(
        http.post('*/api/v1/commerce/affiliate/clicks', async ({ request }) => {
          received = await request.json()
          return HttpResponse.json(
            { data: { redirectUrl: mockAffiliateRedirectUrl } },
            { status: 201 }
          )
        })
      )

      await expect(
        mintAffiliateClickFromMobile({
          offerId: 'offer-morning-outerwear',
          recommendationId: 'morning-outfit-id',
          surface: 'mobile_hero',
        })
      ).resolves.toBe(mockAffiliateRedirectUrl)
      // `scenario` and `localeRegion` are derived server-side. Sending them
      // would hand the client a way to write its own attribution record.
      expect(received).toEqual({
        offerId: 'offer-morning-outerwear',
        recommendationId: 'morning-outfit-id',
        surface: 'mobile_hero',
      })
    })

    it('returns the deduped redirect URL a 200 replay carries', async () => {
      server.use(
        http.post('*/api/v1/commerce/affiliate/clicks', () =>
          HttpResponse.json(
            { data: { redirectUrl: mockAffiliateRedirectUrl } },
            { status: 200 }
          )
        )
      )

      await expect(
        mintAffiliateClickFromMobile({
          offerId: 'offer-morning-outerwear',
          recommendationId: 'morning-outfit-id',
          surface: 'mobile_hero',
        })
      ).resolves.toBe(mockAffiliateRedirectUrl)
    })

    it.each([403, 404, 500, 503])(
      'rejects on %d so the caller cannot navigate',
      async (status) => {
        server.use(
          http.post(
            '*/api/v1/commerce/affiliate/clicks',
            () => new HttpResponse(null, { status })
          )
        )

        await expect(
          mintAffiliateClickFromMobile({
            offerId: 'offer-morning-outerwear',
            recommendationId: 'morning-outfit-id',
            surface: 'mobile_hero',
          })
        ).rejects.toBeDefined()
      }
    )

    it('rejects a response whose redirect URL is not a URL', async () => {
      server.use(
        http.post('*/api/v1/commerce/affiliate/clicks', () =>
          HttpResponse.json({ data: { redirectUrl: 'not-a-url' } }, { status: 201 })
        )
      )

      // Types are not a trust boundary; the contract schema is.
      await expect(
        mintAffiliateClickFromMobile({
          offerId: 'offer-morning-outerwear',
          recommendationId: 'morning-outfit-id',
          surface: 'mobile_hero',
        })
      ).rejects.toBeDefined()
    })
  })

  describe('browser handoff', () => {
    it('opens the minted URL in the in-app browser', async () => {
      await openAffiliatePartnerSite(mockAffiliateRedirectUrl)

      expect(openBrowserAsyncMock).toHaveBeenCalledWith(mockAffiliateRedirectUrl)
    })

    it('propagates a failed handoff so the caller can surface it', async () => {
      openBrowserAsyncMock.mockRejectedValue(new Error('no browser available'))

      await expect(openAffiliatePartnerSite(mockAffiliateRedirectUrl)).rejects.toThrow(
        'no browser available'
      )
    })
  })
})
