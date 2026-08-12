// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
// Story 5.1 Task 6: the hero screen's half of the affiliate CTA. What the card
// draws is covered in `components/hero/outfit-recommendation-card.test.tsx`;
// what belongs here is the screen-owned behaviour: one impression per
// recommendation, and a device cache that cannot resurrect a withdrawn CTA.
/* eslint-disable @typescript-eslint/await-thenable */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type * as RitualCacheModule from '@/src/lib/ritual-cache'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: vi.fn(), push: vi.fn() }),
}))

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const mockCapture = vi.fn()
const mockGetDistinctId = vi.fn(() => 'test-user-id')
vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: mockCapture,
    getDistinctId: mockGetDistinctId,
    screen: vi.fn(),
  }),
  MobileAnalyticsDiagnosticsPanel: () => null,
}))

const { saveRitualCacheMock, realCache } = vi.hoisted(() => ({
  saveRitualCacheMock: vi.fn(),
  realCache: {} as { module?: typeof RitualCacheModule },
}))

// The write is observed, not replaced: the spy delegates to the real cache, so
// the same entry the screen persisted is the entry the screen reads back on the
// next launch. Substituting a no-op here would make every cache-read assertion
// below test a cache that was never written.
vi.mock('@/src/lib/ritual-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof RitualCacheModule>()
  realCache.module = actual
  return { ...actual, saveRitualCache: saveRitualCacheMock }
})

import TabOneScreen from '@/app/(tabs)/index'
import { server } from '@/src/test-utils/msw/server'
import { mockRitualResponse, mockShopThisLook } from '@/src/test-utils/msw/handlers'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { clearRitualMemoryCache } from '@/src/lib/ritual-cache'
import i18n, { initI18n } from '@/src/lib/i18n'

/** Seeds the device cache exactly as a previous launch would have left it. */
async function seedRitualCache(entry: {
  data: typeof mockRitualResponse
  timestamp: number
}) {
  await realCache.module?.saveRitualCache('test-user-id', 'en-US', entry)
}

/** The ritual payload with a live offer on the morning card, as the API sends it. */
const eligibleRitual = mockRitualResponse

function affiliateImpressions() {
  return mockCapture.mock.calls.filter(([event]) => event === 'affiliate_cta_shown')
}

type SaveRitualCacheCall = Parameters<typeof RitualCacheModule.saveRitualCache>

/** Asserts that nothing the screen handed to the device cache carries an offer. */
function expectNoPersistedOffers() {
  const calls = saveRitualCacheMock.mock.calls as SaveRitualCacheCall[]
  expect(calls.length).toBeGreaterThan(0)
  for (const [, , entry] of calls) {
    for (const outfit of entry.data.data.outfits) {
      expect(outfit.shopThisLook).toBeNull()
    }
  }
}

describe('TabOneScreen affiliate CTA', () => {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    await initI18n()
  })

  beforeEach(async () => {
    mockGetDistinctId.mockReturnValue('test-user-id')
    saveRitualCacheMock.mockReset()
    saveRitualCacheMock.mockImplementation(
      async (...args: Parameters<typeof RitualCacheModule.saveRitualCache>) =>
        realCache.module?.saveRitualCache(...args)
    )
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    clearRitualMemoryCache()
    localStorage.clear()
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
    vi.clearAllMocks()
    clearRitualMemoryCache()
    localStorage.clear()
  })

  it('5.1-MOB-HERO-01 renders the CTA from a network payload and emits one impression', async () => {
    await render(<TabOneScreen />)

    await screen.findByTestId('shop-this-look-block')

    await waitFor(() => {
      expect(affiliateImpressions()).toHaveLength(1)
    })
    expect(affiliateImpressions()[0]).toEqual([
      'affiliate_cta_shown',
      {
        partner_id: 'sample-partner',
        scenario: 'morning',
        surface: 'mobile_hero',
        locale_region: 'US',
        recommendation_id: 'morning-outfit-id',
      },
    ])
  })

  it('5.1-MOB-HERO-02 emits nothing more when the user toggles scenario away and back', async () => {
    await render(<TabOneScreen />)
    await screen.findByTestId('shop-this-look-block')
    await waitFor(() => {
      expect(affiliateImpressions()).toHaveLength(1)
    })

    fireEvent.click(screen.getByTestId('scenario-toggle-evening'))
    await waitFor(() => {
      expect(screen.queryByTestId('shop-this-look-block')).toBeNull()
    })

    fireEvent.click(screen.getByTestId('scenario-toggle-morning'))
    await screen.findByTestId('shop-this-look-block')

    // The guard keys on recommendation id, not on mount, or the same card would
    // count a fresh impression every time the user flicked between scenarios
    // and the PRD's click-through denominator would be meaningless.
    expect(affiliateImpressions()).toHaveLength(1)
  })

  it('5.1-MOB-HERO-02b counts a separate impression for each eligible recommendation', async () => {
    // The companion to HERO-02, and the one that pins the guard's shape. HERO-02
    // alone is satisfied by a plain "have I ever emitted" boolean, which would
    // silently drop the impression for every card after the first and quietly
    // deflate the PRD's click-through denominator. Two eligible cards is the
    // only arrangement that tells a Set from a boolean.
    server.use(
      http.get('*/api/v1/ritual', () =>
        HttpResponse.json({
          data: {
            ...eligibleRitual.data,
            outfits: eligibleRitual.data.outfits.map((outfit) =>
              outfit.scenario === 'evening'
                ? {
                    ...outfit,
                    shopThisLook: {
                      ...mockShopThisLook,
                      partnerId: 'second-partner',
                      partnerDisplayName: 'Second Partner',
                      offerId: 'offer-evening-outerwear',
                    },
                  }
                : outfit
            ),
          },
        })
      )
    )

    await render(<TabOneScreen />)
    await screen.findByTestId('shop-this-look-block')
    await waitFor(() => {
      expect(affiliateImpressions()).toHaveLength(1)
    })

    fireEvent.click(screen.getByTestId('scenario-toggle-evening'))

    await waitFor(() => {
      expect(affiliateImpressions()).toHaveLength(2)
    })
    expect(
      affiliateImpressions().map(
        ([, properties]) =>
          (properties as { recommendation_id: string }).recommendation_id
      )
    ).toEqual(['morning-outfit-id', 'evening-outfit-id'])
    expect(affiliateImpressions()[1]?.[1]).toMatchObject({
      partner_id: 'second-partner',
      scenario: 'evening',
    })

    // Going back to the first card still adds nothing: per recommendation, once.
    fireEvent.click(screen.getByTestId('scenario-toggle-morning'))
    await screen.findByTestId('shop-this-look-block')
    expect(affiliateImpressions()).toHaveLength(2)
  })

  it('5.1-MOB-HERO-03 renders no CTA and emits no impression on a scenario with no offer', async () => {
    await render(<TabOneScreen />)
    await screen.findByTestId('shop-this-look-block')

    fireEvent.click(screen.getByTestId('scenario-toggle-midday'))

    await waitFor(() => {
      expect(screen.queryByTestId('shop-this-look-block')).toBeNull()
    })
    expect(
      affiliateImpressions().filter(([, properties]) => properties.scenario === 'midday')
    ).toHaveLength(0)
  })

  it('5.1-MOB-HERO-04 strips the affiliate block out of every device cache write', async () => {
    await render(<TabOneScreen />)
    await screen.findByTestId('shop-this-look-block')

    await waitFor(() => {
      expect(saveRitualCacheMock).toHaveBeenCalled()
    })
    expectNoPersistedOffers()
  })

  it('5.1-MOB-HERO-05 keeps stripping on the garment-swap cache write', async () => {
    await render(<TabOneScreen />)
    await screen.findByTestId('shop-this-look-block')
    saveRitualCacheMock.mockClear()

    fireEvent.click(screen.getByTestId('garment-tile-classic-trench-coat'))
    await waitFor(() => {
      expect(screen.getByTestId('garment-swap-modal')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('swap-option-denim-jacket'))

    await waitFor(() => {
      expect(saveRitualCacheMock).toHaveBeenCalled()
    })
    // A swap rewrites a network payload, so this write can carry a block too.
    expectNoPersistedOffers()
  })

  it('5.1-MOB-HERO-06 never renders a CTA from a cache served under fifteen minutes old', async () => {
    // Written through the real cache so the entry under test is exactly what the
    // screen would have persisted, including the strip.
    await seedRitualCache({ data: eligibleRitual, timestamp: Date.now() })

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByText('Classic Trench Coat')).toBeTruthy()
    })
    expect(screen.queryByTestId('shop-this-look-block')).toBeNull()
    expect(affiliateImpressions()).toHaveLength(0)
  })

  it('5.1-MOB-HERO-07 never renders a CTA from the unbounded offline fallback', async () => {
    await seedRitualCache({
      data: eligibleRitual,
      timestamp: Date.now() - 16 * 60 * 1000,
    })
    server.use(http.get('*/api/v1/ritual', () => new HttpResponse(null, { status: 503 })))

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('stale-cache-banner')).toBeTruthy()
    })
    // This path has no age bound at all, so a CTA served from it would outlive
    // an opt-out for as long as the device stays offline.
    expect(screen.queryByTestId('shop-this-look-block')).toBeNull()
    expect(affiliateImpressions()).toHaveLength(0)
  })

  it('5.1-MOB-HERO-08 drops the CTA on the next load once the user opts out', async () => {
    await render(<TabOneScreen />)
    await screen.findByTestId('shop-this-look-block')

    // What the server sends after `affiliate_ctas_enabled` flips to false: the
    // key is still present and reads null on every scenario.
    server.use(
      http.get('*/api/v1/ritual', () =>
        HttpResponse.json({
          data: {
            ...eligibleRitual.data,
            outfits: eligibleRitual.data.outfits.map((outfit) => ({
              ...outfit,
              shopThisLook: null,
            })),
          },
        })
      )
    )

    fireEvent.click(screen.getByTestId('scenario-toggle-evening'))
    fireEvent.click(screen.getByTestId('scenario-toggle-morning'))
    await i18n.changeLanguage('tr-TR')

    await waitFor(() => {
      expect(screen.queryByTestId('shop-this-look-block')).toBeNull()
    })
  })

  it('5.1-MOB-HERO-09 reports the locale region the offer was matched on', async () => {
    await i18n.changeLanguage('es-419')

    await render(<TabOneScreen />)
    await screen.findByTestId('shop-this-look-block')

    await waitFor(() => {
      expect(affiliateImpressions()).toHaveLength(1)
    })
    // `es-419` is a UN M.49 macro-region, not a country, and the catalog is
    // keyed on exactly this string.
    expect(affiliateImpressions()[0]?.[1]).toMatchObject({ locale_region: '419' })
  })
})
