export interface NotificationPreferenceSnapshot {
  pushEnabled: boolean
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
  timezone: string
}

export type PushSuppressionReason =
  | 'push_disabled'
  | 'quiet_hours'
  | 'invalid_timezone'
  | 'invalid_quiet_hours'

export type PushSuppressionDecision =
  | { suppressed: false }
  | { suppressed: true; reason: PushSuppressionReason }

export const DEFAULT_NOTIFICATION_PREFERENCE: Readonly<NotificationPreferenceSnapshot> =
  Object.freeze({
    pushEnabled: true,
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    timezone: 'UTC',
  })

function parseMinuteOfDay(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>()

function getCachedDateTimeFormat(timezone: string): Intl.DateTimeFormat {
  let formatter = dateTimeFormatCache.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    dateTimeFormatCache.set(timezone, formatter)
  }
  return formatter
}

function minuteOfDayAt(instant: Date, timezone: string): number | null {
  try {
    const parts = getCachedDateTimeFormat(timezone).formatToParts(instant)
    const hour = Number(parts.find((part) => part.type === 'hour')?.value)
    const minute = Number(parts.find((part) => part.type === 'minute')?.value)

    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
    return hour * 60 + minute
  } catch {
    return null
  }
}

export function evaluatePushSuppression(
  preference: NotificationPreferenceSnapshot,
  instant: Date
): PushSuppressionDecision {
  if (!preference.pushEnabled) {
    return { suppressed: true, reason: 'push_disabled' }
  }
  if (!preference.quietHoursEnabled) {
    return { suppressed: false }
  }

  const start = parseMinuteOfDay(preference.quietHoursStart)
  const end = parseMinuteOfDay(preference.quietHoursEnd)
  if (start === null || end === null || start === end) {
    return { suppressed: true, reason: 'invalid_quiet_hours' }
  }

  const current = minuteOfDayAt(instant, preference.timezone)
  if (current === null) {
    return { suppressed: true, reason: 'invalid_timezone' }
  }

  const isQuiet =
    start < end ? current >= start && current < end : current >= start || current < end

  return isQuiet ? { suppressed: true, reason: 'quiet_hours' } : { suppressed: false }
}
