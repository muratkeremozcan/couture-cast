import type {
  NormalizedWeatherAlert,
  NormalizedWeatherForecast,
  WeatherCondition,
} from '../weather/providers/weather.types.js'

export type WeatherAlertRuleType = 'temperature' | 'precipitation' | 'severe'

export interface WeatherAlertEvaluationRule {
  ruleType: WeatherAlertRuleType
  threshold: number
  enabled: boolean
}

export interface WeatherAlertTrigger {
  alertType: WeatherAlertRuleType
  fingerprint: string
  message: string
  severity: 'info' | 'warning' | 'critical'
}

const PRECIPITATION_CONDITIONS = new Set<WeatherCondition>(['rain', 'snow', 'sleet'])
const SEVERE_ALERT_RANK = {
  low: 1,
  medium: 2,
  high: 3,
} as const

function formatNumber(value: number): string {
  return String(Math.round(value * 10) / 10)
}

function evaluateTemperature(
  rule: WeatherAlertEvaluationRule,
  forecast: NormalizedWeatherForecast,
  location: string
): WeatherAlertTrigger | null {
  const threshold = rule.threshold
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return null
  }

  let largestDelta = 0
  for (const hour of forecast.hourly.slice(0, 24)) {
    const delta = hour.temperature - forecast.current.temperature
    if (Math.abs(delta) > Math.abs(largestDelta)) {
      largestDelta = delta
    }
  }

  if (Math.abs(largestDelta) <= threshold) {
    return null
  }

  const direction = largestDelta > 0 ? 'rise' : 'drop'
  return {
    alertType: 'temperature',
    fingerprint: `temperature:${direction}`,
    message: `${location} temperature is forecast to ${direction} by ${formatNumber(Math.abs(largestDelta))}°C within 24 hours.`,
    severity: 'warning',
  }
}

function evaluatePrecipitation(
  rule: WeatherAlertEvaluationRule,
  forecast: NormalizedWeatherForecast,
  location: string
): WeatherAlertTrigger | null {
  const threshold = rule.threshold
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    return null
  }

  let previousCondition = forecast.current.condition
  for (const hour of forecast.hourly.slice(0, 24)) {
    const wasDry = !PRECIPITATION_CONDITIONS.has(previousCondition)
    const isWet = PRECIPITATION_CONDITIONS.has(hour.condition)
    if (wasDry && isWet && hour.precipitationProbability > threshold) {
      return {
        alertType: 'precipitation',
        fingerprint: `precipitation:${hour.condition}`,
        message: `${hour.condition} is forecast to start in ${location} with a ${Math.round(hour.precipitationProbability * 100)}% chance.`,
        severity: 'info',
      }
    }
    if (isWet) {
      if (hour.precipitationProbability > threshold) {
        previousCondition = hour.condition
      }
    } else {
      previousCondition = hour.condition
    }
  }

  return null
}

function evaluateSevere(
  rule: WeatherAlertEvaluationRule,
  forecast: NormalizedWeatherForecast,
  location: string
): WeatherAlertTrigger | null {
  const threshold = rule.threshold
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 3) {
    return null
  }

  const alertRank = (alert: NormalizedWeatherAlert): number =>
    alert.severity && alert.severity in SEVERE_ALERT_RANK
      ? SEVERE_ALERT_RANK[alert.severity as keyof typeof SEVERE_ALERT_RANK]
      : SEVERE_ALERT_RANK.high

  let alert: NormalizedWeatherAlert | undefined
  let highestRank = 0
  for (const candidate of forecast.alerts) {
    const rank = alertRank(candidate)
    if (rank >= threshold && rank > highestRank) {
      alert = candidate
      highestRank = rank
    }
  }

  if (!alert) {
    return null
  }

  return {
    alertType: 'severe',
    fingerprint: `severe:${alert.event.trim().toLowerCase().replace(/\s+/g, ' ')}`,
    message: `${alert.event} for ${location}: ${alert.description}`,
    severity: highestRank === SEVERE_ALERT_RANK.high ? 'critical' : 'warning',
  }
}

export function evaluateWeatherAlertRules(
  rules: WeatherAlertEvaluationRule[],
  forecast: NormalizedWeatherForecast,
  location: string
): WeatherAlertTrigger[] {
  const rulesByType = new Map<WeatherAlertRuleType, WeatherAlertEvaluationRule>()
  for (const rule of rules) {
    if (rule.enabled && !rulesByType.has(rule.ruleType)) {
      rulesByType.set(rule.ruleType, rule)
    }
  }

  const triggers: WeatherAlertTrigger[] = []
  const temperatureRule = rulesByType.get('temperature')
  if (temperatureRule) {
    const trigger = evaluateTemperature(temperatureRule, forecast, location)
    if (trigger) triggers.push(trigger)
  }

  const precipitationRule = rulesByType.get('precipitation')
  if (precipitationRule) {
    const trigger = evaluatePrecipitation(precipitationRule, forecast, location)
    if (trigger) triggers.push(trigger)
  }

  const severeRule = rulesByType.get('severe')
  if (severeRule) {
    const trigger = evaluateSevere(severeRule, forecast, location)
    if (trigger) triggers.push(trigger)
  }

  return triggers
}
