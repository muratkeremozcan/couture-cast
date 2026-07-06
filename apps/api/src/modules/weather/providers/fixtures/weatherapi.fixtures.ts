export function getWeatherApiSuccessFixture(lat = 40.7128, lon = -74.006) {
  const currentHourEpoch = Math.floor(Date.now() / 1000 / 3600) * 3600

  const forecastday = Array.from({ length: 3 }, (_, dayIndex) => {
    const dayStartEpoch = currentHourEpoch + dayIndex * 24 * 3600
    const hour = Array.from({ length: 24 }, (_, hourIndex) => {
      const timeEpoch = dayStartEpoch + hourIndex * 3600
      return {
        time_epoch: timeEpoch,
        time: new Date(timeEpoch * 1000).toISOString().replace('T', ' ').substring(0, 16),
        temp_c: 20 + Math.sin(hourIndex / 5) * 5,
        temp_f: 68 + Math.sin(hourIndex / 5) * 9,
        is_day: 1,
        condition: {
          text: 'Sunny',
          icon: '//cdn.weatherapi.com/weather/64x64/day/113.png',
          code: 1000,
        },
        wind_mph: 6.7,
        wind_kph: 10.8,
        wind_degree: 180,
        wind_dir: 'S',
        pressure_mb: 1012,
        pressure_in: 29.88,
        precip_mm: 0.0,
        precip_in: 0.0,
        snow_cm: 0.0,
        humidity: 60,
        cloud: 10,
        feelslike_c: 19 + Math.sin(hourIndex / 5) * 5,
        feelslike_f: 66.2,
        windchill_c: 20.0,
        windchill_f: 68.0,
        heatindex_c: 20.0,
        heatindex_f: 68.0,
        dewpoint_c: 12.0,
        dewpoint_f: 53.6,
        will_it_rain: 0,
        chance_of_rain: 10,
        will_it_snow: 0,
        chance_of_snow: 5,
        vis_km: 10.0,
        vis_miles: 6.0,
        gust_mph: 8.9,
        gust_kph: 14.3,
        uv: 5.0,
      }
    })

    return {
      date: new Date(dayStartEpoch * 1000).toISOString().split('T')[0],
      date_epoch: dayStartEpoch,
      day: {
        maxtemp_c: 25.0,
        mintemp_c: 15.0,
        avgtemp_c: 20.0,
        maxwind_kph: 15.0,
        totalprecip_mm: 0.0,
        totalsnow_cm: 0.0,
        avgvis_km: 10.0,
        avghumidity: 60.0,
        daily_will_it_rain: 0,
        daily_chance_of_rain: 10,
        daily_will_it_snow: 0,
        daily_chance_of_snow: 0,
        condition: {
          text: 'Sunny',
          icon: '//cdn.weatherapi.com/weather/64x64/day/113.png',
          code: 1000,
        },
        uv: 5.0,
      },
      astro: {
        sunrise: '06:00 AM',
        sunset: '08:00 PM',
      },
      hour,
    }
  })

  return {
    location: {
      name: 'New York',
      region: 'New York',
      country: 'USA',
      lat,
      lon,
      tz_id: 'America/New_York',
      localtime_epoch: Math.floor(Date.now() / 1000),
      localtime: new Date().toISOString(),
    },
    current: {
      last_updated_epoch: Math.floor(Date.now() / 1000),
      last_updated: new Date().toISOString(),
      temp_c: 21.5,
      temp_f: 70.7,
      is_day: 1,
      condition: {
        text: 'Partly cloudy',
        icon: '//cdn.weatherapi.com/weather/64x64/day/116.png',
        code: 1003,
      },
      wind_mph: 8.9,
      wind_kph: 14.3,
      wind_degree: 200,
      wind_dir: 'SSW',
      pressure_mb: 1013,
      pressure_in: 29.91,
      precip_mm: 0.0,
      precip_in: 0.0,
      humidity: 55,
      cloud: 25,
      feelslike_c: 21.0,
      feelslike_f: 69.8,
      vis_km: 10.0,
      vis_miles: 6.0,
      uv: 6.0,
      gust_mph: 11.2,
      gust_kph: 18.0,
    },
    forecast: {
      forecastday,
    },
    alerts: {
      alert: [
        {
          headline: 'Flood Advisory issued by NWS',
          msgtype: 'Alert',
          severity: 'Moderate',
          urgency: 'Expected',
          areas: 'New York',
          category: 'Met',
          certainty: 'Likely',
          event: 'Flood Advisory',
          note: 'None',
          effective: new Date().toISOString(),
          expires: new Date(Date.now() + 7200 * 1000).toISOString(),
          desc: 'Minor flooding in low-lying areas.',
          instruction: 'Avoid flooded areas.',
        },
      ],
    },
  }
}

export const WEATHERAPI_MISSING_FIELDS_FIXTURE = {
  location: {
    lat: 40.7128,
    lon: -74.006,
    tz_id: 'America/New_York',
  },
  // missing current and forecast
}

export const WEATHERAPI_MALFORMED_FIXTURE = '{ invalid json '

export const WEATHERAPI_FAILURE_FIXTURES = {
  rateLimit: { status: 429 },
  serverError: { status: 503 },
  timeout: { name: 'TimeoutError', message: 'request exceeded its deadline' },
  malformed: { body: WEATHERAPI_MALFORMED_FIXTURE },
} as const
