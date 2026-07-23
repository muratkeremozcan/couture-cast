import { http, HttpResponse } from 'msw'

const generateMockHourly = () => {
  const hourly = []
  for (let i = 0; i < 48; i++) {
    hourly.push({
      forecastAt: new Date(Date.now() + i * 3600000).toISOString(),
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
      },
      {
        id: 'midday-outfit-id',
        scenario: 'midday' as const,
        garmentIds: ['casual-tee', 'navy-chinos'],
        reasoningBadges: [],
        comfortNotes: 'Warm and sunny midday. Light tee is perfect.',
      },
      {
        id: 'evening-outfit-id',
        scenario: 'evening' as const,
        garmentIds: ['crewneck-sweater', 'navy-chinos'],
        reasoningBadges: [],
        comfortNotes: 'Cool evening ahead. Sweater recommended.',
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
    },
    {
      id: 'midday-outfit-id',
      scenario: 'midday',
      garmentIds: ['casual-tee', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Sıcak ve güneşli öğle vakti. Hafif tişört mükemmeldir.',
    },
    {
      id: 'evening-outfit-id',
      scenario: 'evening',
      garmentIds: ['crewneck-sweater', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Serin akşam. Kazak önerilir.',
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
    },
    {
      id: 'midday-outfit-id',
      scenario: 'midday',
      garmentIds: ['casual-tee', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Mediodía cálido y soleado. Camiseta ligera es perfecta.',
    },
    {
      id: 'evening-outfit-id',
      scenario: 'evening',
      garmentIds: ['crewneck-sweater', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Noche fresca por delante. Suéter recomendado.',
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
    },
    {
      id: 'midday-outfit-id',
      scenario: 'midday',
      garmentIds: ['casual-tee', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Midi chaud et ensoleillé. Un T-shirt léger est parfait.',
    },
    {
      id: 'evening-outfit-id',
      scenario: 'evening',
      garmentIds: ['crewneck-sweater', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Soirée fraîche à venir. Chandail recommandé.',
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
    },
    {
      id: 'midday-outfit-id',
      scenario: 'midday',
      garmentIds: ['casual-tee', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Warmer und sonniger Mittag. Ein leichtes T-Shirt ist perfekt.',
    },
    {
      id: 'evening-outfit-id',
      scenario: 'evening',
      garmentIds: ['crewneck-sweater', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Kühler Abend steht bevor. Pullover empfohlen.',
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
    },
    {
      id: 'midday-outfit-id',
      scenario: 'midday',
      garmentIds: ['casual-tee', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Mezzogiorno caldo e soleggiato. T-shirt leggera ideale.',
    },
    {
      id: 'evening-outfit-id',
      scenario: 'evening',
      garmentIds: ['crewneck-sweater', 'navy-chinos'],
      reasoningBadges: [],
      comfortNotes: 'Serata fresca in arrivo. Consigliato maglione.',
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
]
