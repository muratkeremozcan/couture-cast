/**
 * Production analytics privacy guard, shared by the web (posthog-js) and mobile
 * (posthog-react-native) before_send hooks. CoutureCast has members aged 13 to 15 with
 * guardian consent and wardrobe photos, so an event leaves an SDK only after a closed
 * policy has run over its properties and its `$set` / `$set_once` person updates, at
 * every depth:
 *
 * - A key that names a person or their birth date is removed.
 * - A URL-bearing key (`$current_url`, `$pathname`, `$referrer`, `$initial_*` and
 *   session entry URLs, `url`, `rawUrl`, deep link fields, `$screen_name`) and any string
 *   that is itself an absolute URL keep only the origin and a route template: query
 *   string and fragment are dropped and every path segment that is not a plain route
 *   word becomes `:id`.
 * - Exception payloads (`$exception_*`) keep their types, code locations and function
 *   names; free text (messages, values) is scrubbed of emails, URLs, UUIDs, tokens and
 *   long numbers, and stack frame file paths lose their query string and fragment.
 * - Every other string has emails redacted and embedded URLs reduced as above.
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

/** The placeholder for a path segment that is not a plain route word. */
export const ANALYTICS_ROUTE_PARAMETER = ':id'
const REDACTED = '[redacted]'

const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '')
const personalKeys: ReadonlySet<string> = new Set(
  PERSONAL_ANALYTICS_PROPERTY_KEYS.map(normalizeKey)
)
// URL-bearing keys, after normalization. `$referring_domain` holds a host only.
const urlKeyFragments = ['url', 'href', 'pathname', 'referrer', 'referer', 'link']
const urlKeys: ReadonlySet<string> = new Set(['screenname', 'path', 'route'])
const isUrlKey = (key: string) => {
  const normalized = normalizeKey(key)
  return (
    urlKeys.has(normalized) ||
    normalized.endsWith('path') ||
    urlKeyFragments.some((fragment) => normalized.includes(fragment))
  )
}
// Inside an exception payload: stack frame locations and code identifiers survive;
// every other string is free text.
const frameLocationKeys: ReadonlySet<string> = new Set(['filename', 'abs_path'])
const exceptionCodeKeys: ReadonlySet<string> = new Set([
  'type',
  '$exception_types',
  '$exception_type',
  '$exception_level',
  'function',
  'module',
  'platform',
  'lang',
  'chunk_id',
  'raw_id',
  'context_line',
  'pre_context',
  'post_context',
])

// A route word: lowercase letters joined by single hyphens or underscores, optionally
// wrapped in parentheses for an Expo Router group such as `(tabs)`.
const routeWord = /^\(?[a-z]+(?:[-_][a-z]+)*\)?$/
const templateSegment = (segment: string) =>
  segment === '' || (segment.length <= 48 && routeWord.test(segment))
    ? segment
    : ANALYTICS_ROUTE_PARAMETER
const templatePath = (path: string) => path.split('/').map(templateSegment).join('/')
const webSchemes: ReadonlySet<string> = new Set(['http:', 'https:'])
const absoluteUrl = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)/i
const hostname = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?$/i

/**
 * Reduces a URL or path to its origin and route template: no query string, no fragment,
 * no user info, and `:id` for every path segment that is not a plain route word. For an
 * app scheme such as `couturecast://community/post-1` the host is a route segment too.
 * A value that is neither a URL nor a path survives only as a route word or a host name.
 */
export function sanitizeAnalyticsUrl(value: string): string {
  const match = absoluteUrl.exec(value)
  if (match) {
    const scheme = match[1]!.toLowerCase()
    const host = match[2]!.slice(match[2]!.lastIndexOf('@') + 1)
    const origin = webSchemes.has(scheme) ? host.toLowerCase() : templateSegment(host)
    return `${scheme}//${origin}${templatePath(match[3]!)}`
  }
  const path = value.split(/[?#]/, 1)[0]!
  if (path.startsWith('/')) return templatePath(path)
  if (value === '' || value === '$direct' || hostname.test(value)) return value
  return routeWord.test(value) && value.length <= 48 ? value : REDACTED
}

/** Drops the query string and fragment of a stack frame location and keeps the path. */
const stripQueryAndFragment = (value: string) => value.split(/[?#]/, 1)[0]!

const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const embeddedUrlPattern = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>)\]]+/gi
const redactEmails = (value: string) => value.replace(emailPattern, '[email]')
const reduceEmbeddedUrls = (value: string) =>
  value.replace(embeddedUrlPattern, (url) => sanitizeAnalyticsUrl(url))

/**
 * Free text from an exception message: URLs keep their origin and route template;
 * emails, JWTs, UUIDs, long hex or base64 tokens and long digit runs are replaced.
 */
export function scrubAnalyticsText(value: string): string {
  return redactEmails(reduceEmbeddedUrls(value))
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[token]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/\b[0-9a-f]{16,}\b/gi, '[token]')
    .replace(
      /(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{20,}={0,2}/g,
      '[token]'
    )
    .replace(/\d{6,}/g, '[number]')
}

type Context = { exception: boolean; ancestors: object[] }

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const DROP = Symbol('drop')

const isExceptionKey = (key: string) => key.startsWith('$exception')

function sanitizeString(key: string, value: string, context: Context): string {
  if (context.exception || isExceptionKey(key)) {
    if (frameLocationKeys.has(key)) return redactEmails(stripQueryAndFragment(value))
    if (exceptionCodeKeys.has(key)) return redactEmails(value)
    return scrubAnalyticsText(value)
  }
  if (isUrlKey(key) || absoluteUrl.test(value)) return sanitizeAnalyticsUrl(value)
  return redactEmails(reduceEmbeddedUrls(value))
}

function sanitizeValue(key: string, value: unknown, context: Context): unknown {
  if (typeof value === 'string') return sanitizeString(key, value, context)
  const isArray = Array.isArray(value)
  if (!isArray && !isPlainRecord(value)) return value
  // A cyclic value cannot be serialized; it is dropped instead of followed.
  if (context.ancestors.includes(value)) return DROP
  const nested: Context = {
    exception: context.exception || isExceptionKey(key),
    ancestors: [...context.ancestors, value],
  }
  if (isArray) {
    return value
      .map((item) => sanitizeValue(key, item, nested))
      .filter((item) => item !== DROP)
  }
  return sanitizeRecord(value, nested)
}

function sanitizeRecord(
  record: Record<string, unknown>,
  context: Context
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  for (const key of Object.keys(record)) {
    if (personalKeys.has(normalizeKey(key))) continue
    const value = sanitizeValue(key, record[key], context)
    if (value !== DROP) sanitized[key] = value
  }
  return sanitized
}

// The parts of an event that carry data: its properties and the person updates SDKs
// place on the event. The envelope (event name, uuid, timestamp) is left as it is.
const dataKeys = ['properties', '$set', '$set_once'] as const

/**
 * A before_send hook for either SDK: returns a copy of the event with the closed policy
 * above applied to its properties and person updates. The caller's objects are never
 * mutated. Any error drops the event (null): the SDKs send the original event when a
 * hook throws, so this never throws.
 */
export function stripPersonalAnalyticsData<T extends object>(event: T | null): T | null {
  if (!event) return event
  try {
    const source = event as Record<string, unknown>
    const sanitized: Record<string, unknown> = { ...source }
    for (const key of dataKeys) {
      const value = source[key]
      if (isPlainRecord(value))
        sanitized[key] = sanitizeRecord(value, { exception: false, ancestors: [value] })
    }
    return sanitized as T
  } catch {
    return null
  }
}
