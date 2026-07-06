import type { WeatherAlertSeverity, WeatherCondition } from './weather.types.js'

const OPEN_WEATHER_SLEET_CODES = new Set([511, 611, 612, 613, 615, 616])
const OPEN_WEATHER_WIND_CODES = new Set([771, 781])

export function mapOpenWeatherCondition(code: number): WeatherCondition {
  if (OPEN_WEATHER_SLEET_CODES.has(code)) return 'sleet'
  if (OPEN_WEATHER_WIND_CODES.has(code)) return 'wind'

  const group = Math.floor(code / 100)
  switch (group) {
    case 2:
      return 'thunderstorm'
    case 3:
      return 'drizzle'
    case 5:
      return 'rain'
    case 6:
      return 'snow'
    case 7:
      if (code >= 701 && code <= 762) return 'fog'
      return 'unknown'
    case 8:
      if (code === 800) return 'clear'
      if (code === 801) return 'partly_cloudy'
      if (code >= 802 && code <= 804) return 'cloudy'
      return 'unknown'
    default:
      return 'unknown'
  }
}

const WEATHER_API_PARTLY_CLOUDY = new Set([1003])
const WEATHER_API_CLOUDY = new Set([1006, 1009])
const WEATHER_API_FOG = new Set([1030, 1135, 1147])
const WEATHER_API_THUNDERSTORM = new Set([1087, 1273, 1276, 1279, 1282])
const WEATHER_API_SLEET = new Set([1069, 1204, 1207, 1237, 1249, 1252, 1261, 1264])
const WEATHER_API_SNOW = new Set([
  1066, 1114, 1117, 1210, 1213, 1216, 1219, 1222, 1225, 1255, 1258,
])
const WEATHER_API_DRIZZLE = new Set([1072, 1150, 1153, 1168, 1171])
const WEATHER_API_RAIN = new Set([
  1063, 1180, 1183, 1186, 1189, 1192, 1195, 1198, 1201, 1240, 1243, 1246,
])

export function mapWeatherApiCondition(code: number): WeatherCondition {
  if (code === 1000) return 'clear'
  if (WEATHER_API_PARTLY_CLOUDY.has(code)) return 'partly_cloudy'
  if (WEATHER_API_CLOUDY.has(code)) return 'cloudy'
  if (WEATHER_API_FOG.has(code)) return 'fog'
  if (WEATHER_API_THUNDERSTORM.has(code)) return 'thunderstorm'
  if (WEATHER_API_SLEET.has(code)) return 'sleet'
  if (WEATHER_API_SNOW.has(code)) return 'snow'
  if (WEATHER_API_DRIZZLE.has(code)) return 'drizzle'
  if (WEATHER_API_RAIN.has(code)) return 'rain'
  return 'unknown'
}

export function mapWeatherApiAlertSeverity(
  severity?: string
): WeatherAlertSeverity | undefined {
  if (severity === undefined) {
    return undefined
  }

  switch (severity.trim().toLowerCase()) {
    case 'minor':
      return 'low'
    case 'moderate':
      return 'medium'
    case 'severe':
    case 'extreme':
      return 'high'
    default:
      return undefined
  }
}
