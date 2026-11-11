/**
 * Production analytics privacy guard, shared by the web (posthog-js) and mobile
 * (posthog-react-native) before_send hooks. CoutureCast has members aged 13 to 15 with
 * guardian consent, so a key that names a person or their birth date never leaves an
 * SDK, whoever added it: feature code, a registered super property or a person update.
 *
 * Keys match after lowercasing and dropping every character that is not a letter or a
 * digit, so `email`, `$email`, `firstName`, `first_name` and `Date-Of-Birth` all match.
 */
export const PERSONAL_ANALYTICS_PROPERTY_KEYS = Object.freeze([
  'email',
  'name',
  'first_name',
  'last_name',
  'full_name',
  'display_name',
  'username',
  'birthdate',
  'birth_date',
  'date_of_birth',
  'dob',
  'birthday',
  'phone',
  'phone_number',
] as const)

const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '')
const personalKeys: ReadonlySet<string> = new Set(
  PERSONAL_ANALYTICS_PROPERTY_KEYS.map(normalizeKey)
)
// The event's own properties and the person updates SDKs place on the event or
// inside its properties.
const nestedRecordKeys: ReadonlySet<string> = new Set(['properties', '$set', '$set_once'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function withoutPersonalKeys(record: Record<string, unknown>): Record<string, unknown> {
  let cleaned: Record<string, unknown> | undefined
  for (const key of Object.keys(record)) {
    const value = record[key]
    if (personalKeys.has(normalizeKey(key))) {
      cleaned ??= { ...record }
      delete cleaned[key]
    } else if (nestedRecordKeys.has(key) && isRecord(value)) {
      const nested = withoutPersonalKeys(value)
      if (nested !== value) {
        cleaned ??= { ...record }
        cleaned[key] = nested
      }
    }
  }
  return cleaned ?? record
}

/**
 * A before_send hook for either SDK: returns the event without any personal key in its
 * properties or its `$set` / `$set_once` person updates. A clean event comes back by
 * reference; a changed one is a copy, so the caller's objects are never mutated. Any
 * error drops the event (null): the SDKs send the original event when a hook throws,
 * so this never throws.
 */
export function stripPersonalAnalyticsData<T extends object>(event: T | null): T | null {
  if (!event) return event
  try {
    return withoutPersonalKeys(event as Record<string, unknown>) as T
  } catch {
    return null
  }
}
