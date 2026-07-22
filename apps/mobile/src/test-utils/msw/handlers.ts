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
  http.get('*/api/v1/ritual', () => {
    return HttpResponse.json(mockRitualResponse)
  }),
]
