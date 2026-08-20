import { http, HttpResponse } from 'msw'

const MOCK_FORECAST_START_MS = Date.parse('2026-07-24T17:00:00.000Z')

const generateMockHourly = () => {
  const hourly = []
  for (let i = 0; i < 48; i++) {
    hourly.push({
      forecastAt: new Date(MOCK_FORECAST_START_MS + i * 3600000).toISOString(),
      temperature: 20 + Math.sin(i / 4) * 5,
      feelsLike: 20 + Math.sin(i / 4) * 5,
      precipitationProbability: 0.1,
      precipitationAmount: 0,
      windSpeed: 5,
      windGust: null,
      condition: 'clear' as const,
      providerWeatherCode: '1000',
    })
  }
  return hourly
}

/**
 * Story 5.1: the affiliate block the morning card is eligible for. Only the
 * morning outfit carries one, so the same default fixture exercises both the
 * eligible render and the `shopThisLook: null` render, and a scenario toggle
 * moves between them.
 */
export const mockShopThisLook = {
  partnerId: 'sample-partner',
  partnerDisplayName: 'Sample Partner',
  offerId: 'offer-morning-outerwear',
  offerTitle: 'Rain-ready trench coats',
  garmentCategory: 'outerwear' as const,
}

export const mockAffiliateRedirectUrl =
  'https://partner.couturecast.test/go?token=mock-click-token'

/**
 * Story 5.2: subscription fixtures for both variants of the wire union. The
 * default handler serves `none`; suites that need an entitled state override
 * per test with `server.use(...)`.
 */
export const mockSubscriptionNone = {
  data: {
    status: 'none' as const,
    store: null,
    productId: null,
    willRenew: null,
    currentPeriodEnd: null,
    syncedAt: null,
    purchasesEnabled: true,
  },
}

export const mockSubscriptionActive = {
  data: {
    status: 'active' as const,
    store: 'app_store' as const,
    productId: 'premium_monthly',
    willRenew: true,
    currentPeriodEnd: '2026-09-12T00:00:00.000Z',
    syncedAt: '2026-08-12T00:00:00.000Z',
    purchasesEnabled: true,
  },
}

/**
 * Story 5.3: premium theme fixtures. The default handler serves the state a
 * non-entitled reader gets — Default palette, gallery locked — because that is
 * what every suite that does not care about palettes should see. Suites that
 * need an entitled reader override per test with `server.use(...)`.
 */
export const mockPremiumThemeLocked = {
  data: {
    theme: null,
    isEntitled: false,
    themesEnabled: true,
  },
}

export const mockPremiumThemeEntitled = {
  data: {
    theme: null,
    isEntitled: true,
    themesEnabled: true,
  },
}

export const mockRitualResponse = {
  data: {
    weather: {
      locationKey: 'test-location-key',
      latitude: 37.7749,
      longitude: -122.4194,
      timezone: 'America/Los_Angeles',
      provider: 'openweather' as const,
      providerUpdatedAt: '2026-07-22T00:00:00.000Z',
      fetchedAt: '2026-07-22T00:00:00.000Z',
      current: {
        temperature: 21,
        condition: 'clear' as const,
      },
      hourly: generateMockHourly(),
      alerts: [],
    },
    outfits: [
      {
        id: 'morning-outfit-id',
        scenario: 'morning' as const,
        garmentIds: ['classic-trench-coat', 'navy-chinos'],
        reasoningBadges: [
          {
            key: 'breeze-guard',
            label: 'Breeze Guard',
            bullets: [
              'Wind gusts up to 15mph are expected.',
              'Layering with a trench coat adds wind protection.',
            ],
          },
        ],
        comfortNotes: 'Mild morning with gentle winds. Trench coat recommended.',
        shopThisLook: mockShopThisLook,
      },
      {
        id: 'midday-outfit-id',
        scenario: 'midday' as const,
        garmentIds: ['casual-tee', 'navy-chinos'],
        reasoningBadges: [],
        comfortNotes: 'Warm and sunny midday. Light tee is perfect.',
        shopThisLook: null,
      },
      {
        id: 'evening-outfit-id',
        scenario: 'evening' as const,
        garmentIds: ['crewneck-sweater', 'navy-chinos'],
        reasoningBadges: [],
        comfortNotes: 'Cool evening ahead. Sweater recommended.',
        shopThisLook: null,
      },
    ],
    badges: ['breeze-guard'],
  },
}

const localizedOutfits: Record<string, typeof mockRitualResponse.data.outfits> = {
  'tr-TR': [
    {
      id: 'morning-outfit-id',
      scenario: 'morning',
      garmentIds: ['classic-trench-coat', 'navy-chinos'],
      reasoningBadges: [
        {
          key: 'breeze-guard',
          label: 'Rüzgarlık',
          bullets: [
            '15mph hıza ulaşan rüzgar bekleniyor.',
            'Trençkot giymek rüzgardan koruma sağlayacaktır.',
          ],
        },
      ],
      comfortNotes: 'Hafif rüzgarlı serin sabah. Trençkot önerilir.',
      shopThisLook: mockShopThisLook,
    },
    {
      id: 'midday-outfit-id',
      scenario: 'midday',
      garmentIds: ['casual-tee', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Sıcak ve güneşli öğle vakti. Hafif tişört mükemmeldir.',
      shopThisLook: null,
    },
    {
      id: 'evening-outfit-id',
      scenario: 'evening',
      garmentIds: ['crewneck-sweater', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Serin akşam. Kazak önerilir.',
      shopThisLook: null,
    },
  ],
  'es-419': [
    {
      id: 'morning-outfit-id',
      scenario: 'morning',
      garmentIds: ['classic-trench-coat', 'navy-chinos'],
      reasoningBadges: [
        {
          key: 'breeze-guard',
          label: 'Cortaviento',
          bullets: [
            'Se esperan ráfagas de viento de hasta 15 mph.',
            'Capa cortaviento recomendada para protegerse del viento.',
          ],
        },
      ],
      comfortNotes: 'Mañana templada con vientos suaves. Gabardina recomendada.',
      shopThisLook: mockShopThisLook,
    },
    {
      id: 'midday-outfit-id',
      scenario: 'midday',
      garmentIds: ['casual-tee', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Mediodía cálido y soleado. Camiseta ligera es perfecta.',
      shopThisLook: null,
    },
    {
      id: 'evening-outfit-id',
      scenario: 'evening',
      garmentIds: ['crewneck-sweater', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Noche fresca por delante. Suéter recomendado.',
      shopThisLook: null,
    },
  ],
  'fr-CA': [
    {
      id: 'morning-outfit-id',
      scenario: 'morning',
      garmentIds: ['classic-trench-coat', 'navy-chinos'],
      reasoningBadges: [
        {
          key: 'breeze-guard',
          label: 'Coupe-vent',
          bullets: [
            'Des rafales de vent allant jusqu’à 15 mph sont attendues.',
            'Un imperméable apporte une protection contre le vent.',
          ],
        },
      ],
      comfortNotes: 'Matinée douce avec vent léger. Imperméable recommandé.',
      shopThisLook: mockShopThisLook,
    },
    {
      id: 'midday-outfit-id',
      scenario: 'midday',
      garmentIds: ['casual-tee', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Midi chaud et ensoleillé. Un T-shirt léger est parfait.',
      shopThisLook: null,
    },
    {
      id: 'evening-outfit-id',
      scenario: 'evening',
      garmentIds: ['crewneck-sweater', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Soirée fraîche à venir. Chandail recommandé.',
      shopThisLook: null,
    },
  ],
  'de-DE': [
    {
      id: 'morning-outfit-id',
      scenario: 'morning',
      garmentIds: ['classic-trench-coat', 'navy-chinos'],
      reasoningBadges: [
        {
          key: 'breeze-guard',
          label: 'Windschutz',
          bullets: [
            'Windböen von bis zu 15 mph werden erwartet.',
            'Das Tragen eines Trenchcoats bietet Windschutz.',
          ],
        },
      ],
      comfortNotes: 'Milder Morgen mit leichtem Wind. Trenchcoat empfohlen.',
      shopThisLook: mockShopThisLook,
    },
    {
      id: 'midday-outfit-id',
      scenario: 'midday',
      garmentIds: ['casual-tee', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Warmer und sonniger Mittag. Ein leichtes T-Shirt ist perfekt.',
      shopThisLook: null,
    },
    {
      id: 'evening-outfit-id',
      scenario: 'evening',
      garmentIds: ['crewneck-sweater', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Kühler Abend steht bevor. Pullover empfohlen.',
      shopThisLook: null,
    },
  ],
  'it-IT': [
    {
      id: 'morning-outfit-id',
      scenario: 'morning',
      garmentIds: ['classic-trench-coat', 'navy-chinos'],
      reasoningBadges: [
        {
          key: 'breeze-guard',
          label: 'Strato antivento',
          bullets: [
            'Previste raffiche di vento fino a 15 mph.',
            'Uno strato aggiuntivo con un trench offre protezione dal vento.',
          ],
        },
      ],
      comfortNotes: 'Mattina mite con vento leggero. Consigliato trench.',
      shopThisLook: mockShopThisLook,
    },
    {
      id: 'midday-outfit-id',
      scenario: 'midday',
      garmentIds: ['casual-tee', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Mezzogiorno caldo e soleggiato. T-shirt leggera ideale.',
      shopThisLook: null,
    },
    {
      id: 'evening-outfit-id',
      scenario: 'evening',
      garmentIds: ['crewneck-sweater', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Serata fresca in arrivo. Consigliato maglione.',
      shopThisLook: null,
    },
  ],
}

export const handlers = [
  http.get('*/api/health', () =>
    HttpResponse.json({
      status: 'ok',
      service: 'couturecast-api',
      environment: 'test',
      gitSha: 'test-git-sha',
      gitBranch: 'test-git-branch',
      timestamp: '2026-04-09T00:00:00.000Z',
    })
  ),
  http.get('*/api/v1/ritual', ({ request }) => {
    const locale = new URL(request.url).searchParams.get('locale') || 'en-US'
    const localizedList = localizedOutfits[locale] || mockRitualResponse.data.outfits

    return HttpResponse.json({
      data: {
        ...mockRitualResponse.data,
        outfits: localizedList,
      },
    })
  }),
  http.get('*/api/v1/commerce/preferences', () =>
    HttpResponse.json({ data: { affiliateCtasEnabled: true } })
  ),
  http.put('*/api/v1/commerce/preferences', async ({ request }) => {
    const body = (await request.json()) as { affiliateCtasEnabled?: boolean }
    // Echoes the stored state back, matching the real endpoint: an unchanged
    // value still returns 200 with the current value so the response is uniform.
    return HttpResponse.json({
      data: { affiliateCtasEnabled: body.affiliateCtasEnabled ?? true },
    })
  }),
  http.post('*/api/v1/commerce/affiliate/clicks', () =>
    HttpResponse.json(
      { data: { redirectUrl: mockAffiliateRedirectUrl } },
      { status: 201 }
    )
  ),
  http.get('*/api/v1/commerce/subscription', () =>
    HttpResponse.json(mockSubscriptionNone)
  ),
  http.post('*/api/v1/commerce/subscription/refresh', () =>
    HttpResponse.json(mockSubscriptionNone)
  ),
  http.get('*/api/v1/commerce/premium/theme', () =>
    HttpResponse.json(mockPremiumThemeLocked)
  ),
  http.put('*/api/v1/commerce/premium/theme', async ({ request }) => {
    const body = (await request.json()) as { theme?: string | null }
    return HttpResponse.json({
      data: { ...mockPremiumThemeEntitled.data, theme: body.theme ?? null },
    })
  }),
  http.get('*/api/v1/alerts/preferences', () =>
    HttpResponse.json({
      data: {
        preferences: {
          pushEnabled: true,
          quietHoursEnabled: false,
          quietHoursStart: '22:00',
          quietHoursEnd: '07:00',
          timezone: 'America/Los_Angeles',
        },
        rules: [],
      },
    })
  ),
]
