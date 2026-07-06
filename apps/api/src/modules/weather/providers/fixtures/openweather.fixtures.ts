export function getOpenWeatherSuccessFixture(lat = 40.7128, lon = -74.006) {
  const hourly = Array.from({ length: 48 }, (_, i) => {
    const timeEpoch = Math.floor(Date.now() / 1000) + i * 3600
    return {
      dt: timeEpoch,
      temp: 20 + Math.sin(i / 5) * 5,
      feels_like: 19 + Math.sin(i / 5) * 5,
      pressure: 1012,
      humidity: 60,
      dew_point: 12,
      uvi: 0,
      clouds: 20,
      visibility: 10000,
      wind_speed: 3.5,
      wind_deg: 180,
      wind_gust: 4.5,
      pop: 0.1,
      weather: [
        {
          id: 801,
          main: 'Clouds',
          description: 'few clouds',
          icon: '02d',
        },
      ],
    }
  })

  return {
    lat,
    lon,
    timezone: 'America/New_York',
    timezone_offset: -18000,
    current: {
      dt: Math.floor(Date.now() / 1000),
      sunrise: Math.floor(Date.now() / 1000) - 10000,
      sunset: Math.floor(Date.now() / 1000) + 20000,
      temp: 21.5,
      feels_like: 21.0,
      pressure: 1013,
      humidity: 55,
      dew_point: 12,
      uvi: 5.5,
      clouds: 10,
      visibility: 10000,
      wind_speed: 4.0,
      wind_deg: 200,
      weather: [
        {
          id: 800,
          main: 'Clear',
          description: 'clear sky',
          icon: '01d',
        },
      ],
    },
    hourly,
    alerts: [
      {
        sender_name: 'National Weather Service',
        event: 'Flood Advisory',
        start: Math.floor(Date.now() / 1000),
        end: Math.floor(Date.now() / 1000) + 7200,
        description: 'Minor flooding in low-lying areas.',
        tags: ['Hydrology'],
      },
    ],
  }
}

export const OPENWEATHER_MISSING_FIELDS_FIXTURE = {
  lat: 40.7128,
  lon: -74.006,
  timezone: 'America/New_York',
  // current and hourly are missing or incomplete
  current: {
    dt: Math.floor(Date.now() / 1000),
    // temp and weather are missing
    humidity: 55,
  },
  hourly: [],
}

export const OPENWEATHER_MALFORMED_FIXTURE = '{ invalid json: true '

export const OPENWEATHER_FAILURE_FIXTURES = {
  rateLimit: { status: 429 },
  serverError: { status: 503 },
  timeout: { name: 'TimeoutError', message: 'request exceeded its deadline' },
  malformed: { body: OPENWEATHER_MALFORMED_FIXTURE },
} as const
