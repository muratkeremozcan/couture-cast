import {
  DEEP_LINK_FAILURE_REASONS,
  deepLinkNotificationTypeSchema,
  deepLinkSlotSchema,
  deepLinkSourceSchema,
  deepLinkWidgetSizeSchema,
} from '@couture/utils'
import { alertRuleTypeSchema } from './contracts/http/alerts'
import { affiliateCommunitySurfaceSchema } from './contracts/http/commerce'
import { communityFeedModeSchema } from './contracts/http/community'
import { supportedLocales } from './contracts/http/localization'
import { weatherConditionSchema } from './contracts/http/weather'
import {
  type AnalyticsPlatform,
  UNKNOWN_ANALYTICS_ROUTE,
  templateAnalyticsRoute,
} from './analytics-routes'
import {
  shareCardShareClientSchema,
  shareCardShareOutcomeSchema,
  shareCardShareTargetSchema,
} from './types/analytics-events'

/**
 * Production analytics privacy boundary, run first in the web (posthog-js) and mobile
 * (posthog-react-native) before_send chains. CoutureCast has members aged 13 to 15 with
 * guardian consent and wardrobe photos, so nothing leaves an SDK unless it is on a
 * closed allowlist:
 *
 * - An event not named in ANALYTICS_EVENT_PROPERTIES or the platform's SDK events is
 *   dropped.
 * - A property not on that event's list or the SDK property list is dropped, and so is
 *   a value that fails its rule. A string survives only as an enum member, a route
 *   template, an origin, a host, an SDK identifier or version, or a timestamp.
 * - Paths and URLs keep a known route's static segments (`:param` for dynamic ones);
 *   anything else is `/:unknown`. External URLs and referrers keep their origin only.
 * - Exceptions keep their type and in-app frames as file basename, line and column.
 *   Messages are replaced by EXCEPTION_MESSAGE_PLACEHOLDER.
 * - `$set` and `$set_once` person updates never leave: the clients never identify.
 */

type Rule = (value: unknown, platform: AnalyticsPlatform) => unknown
const DROP = Symbol('drop')
// Hermes in older React Native builds has no Object.hasOwn.
const has = (record: object, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key)

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const oneOf =
  (values: readonly string[]): Rule =>
  (value) =>
    typeof value === 'string' && values.includes(value) ? value : DROP
const listOf =
  (values: readonly string[]): Rule =>
  (value) =>
    Array.isArray(value)
      ? value.filter(
          (item): item is string => typeof item === 'string' && values.includes(item)
        )
      : DROP
const matching =
  (pattern: RegExp): Rule =>
  (value) =>
    typeof value === 'string' && pattern.test(value) ? value : DROP
const number: Rule = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : DROP
const integer: Rule = (value) => (Number.isInteger(value) ? value : DROP)
const boolean: Rule = (value) => (typeof value === 'boolean' ? value : DROP)
const nullValue: Rule = (value) => (value === null ? null : DROP)
const either =
  (...rules: Rule[]): Rule =>
  (value, platform) => {
    for (const rule of rules) {
      const result = rule(value, platform)
      if (result !== DROP) return result
    }
    return DROP
  }

const timestamp = matching(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
)
// SDK-generated identifiers (anonymous distinct id, session, window, device and
// pageview ids, the project token) and SDK descriptions (browser, OS, device model,
// library and app versions).
const sdkId = matching(/^[A-Za-z0-9_-]{1,100}$/)
const sdkText = matching(/^[A-Za-z0-9 ._()+-]{1,64}$/)
const sdkValue = either(sdkText, number)
const version = matching(/^[A-Za-z0-9._+-]{1,32}$/)
const host = matching(/^[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d{1,5})?$/i)
// Identifiers our own server issues for catalog entries (affiliate partner slugs, offer
// and recommendation ids); never typed by a member.
const catalogId = matching(/^[A-Za-z0-9_-]{1,128}$/)
const regionCode = matching(/^(?:\*|[A-Z0-9]{2,3})$/)
const locale = oneOf(supportedLocales)

const absoluteUrl = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)/i
const webSchemes = new Set(['http:', 'https:'])
const hostOf = (authority: string) => authority.slice(authority.lastIndexOf('@') + 1)

/**
 * A URL or path reduced to a known route on `platform`: an http(s) URL keeps its origin
 * and route template, an app link (`couturecast://guardian-accept?token=...`) keeps
 * its scheme and route template, a path becomes its route template, and anything else
 * is `/:unknown`.
 */
export function analyticsRouteUrl(value: string, platform: AnalyticsPlatform): string {
  const match = absoluteUrl.exec(value)
  if (!match) {
    return value.startsWith('/')
      ? templateAnalyticsRoute(value, platform)
      : UNKNOWN_ANALYTICS_ROUTE
  }
  const scheme = match[1]!.toLowerCase()
  const authority = hostOf(match[2]!)
  if (webSchemes.has(scheme)) {
    const origin = host(authority, platform) === DROP ? '' : authority.toLowerCase()
    return `${scheme}//${origin}${templateAnalyticsRoute(match[3]!, platform)}`
  }
  // In an app link the host is the first route segment.
  return `${scheme}/${templateAnalyticsRoute(`/${authority}${match[3]!}`, platform)}`
}

/** A URL reduced to its origin; anything that is not an absolute URL is dropped. */
export function analyticsOriginUrl(value: string): string | undefined {
  const match = absoluteUrl.exec(value)
  if (!match) return undefined
  const scheme = match[1]!.toLowerCase()
  const authority = hostOf(match[2]!)
  if (!webSchemes.has(scheme)) return `${scheme}//`
  return host(authority, 'web') === DROP
    ? undefined
    : `${scheme}//${authority.toLowerCase()}`
}

const route: Rule = (value, platform) =>
  typeof value === 'string' ? analyticsRouteUrl(value, platform) : DROP
const origin: Rule = (value) =>
  typeof value === 'string' ? (analyticsOriginUrl(value) ?? DROP) : DROP

/** What an exception message is sent as. */
export const EXCEPTION_MESSAGE_PLACEHOLDER = 'redacted'
const exceptionType = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z_$][\w$]{0,63}$/.test(value) ? value : 'Error'
const mechanismTypes = [
  'generic',
  'onerror',
  'onunhandledrejection',
  'onuncaughtexception',
  'onconsole',
]
const framePlatforms = ['web:javascript', 'node:javascript', 'custom', 'hermes']
const codeFile = /^[A-Za-z0-9_.-]{1,100}\.(?:m?js|cjs|jsx|ts|tsx|bundle|hbc)$/
const UNKNOWN_CODE_FILE = '<unknown>'
const basenameOf = (value: unknown) => {
  if (typeof value !== 'string') return UNKNOWN_CODE_FILE
  const parts = value.split(/[?#]/, 1)[0]!.split('/')
  const name = parts[parts.length - 1]!
  return codeFile.test(name) ? name : UNKNOWN_CODE_FILE
}

function sanitizeFrame(frame: Record<string, unknown>) {
  const sanitized: Record<string, unknown> = {
    filename: basenameOf(frame.filename),
    in_app: true,
  }
  for (const key of ['lineno', 'colno'])
    if (Number.isInteger(frame[key])) sanitized[key] = frame[key]
  if (typeof frame.platform === 'string' && framePlatforms.includes(frame.platform))
    sanitized.platform = frame.platform
  return sanitized
}

function sanitizeException(entry: Record<string, unknown>) {
  const mechanism = isPlainRecord(entry.mechanism) ? entry.mechanism : {}
  const stacktrace = isPlainRecord(entry.stacktrace) ? entry.stacktrace : {}
  const frames = Array.isArray(stacktrace.frames) ? stacktrace.frames : []
  return {
    type: exceptionType(entry.type),
    value: EXCEPTION_MESSAGE_PLACEHOLDER,
    mechanism: {
      type:
        typeof mechanism.type === 'string' && mechanismTypes.includes(mechanism.type)
          ? mechanism.type
          : 'generic',
      handled: mechanism.handled === true,
      synthetic: mechanism.synthetic === true,
    },
    stacktrace: {
      type: 'raw',
      frames: frames
        .filter((frame) => isPlainRecord(frame) && frame.in_app === true)
        .map((frame) => sanitizeFrame(frame as Record<string, unknown>)),
    },
  }
}

const exceptionList: Rule = (value) =>
  Array.isArray(value)
    ? value
        .filter(isPlainRecord)
        .slice(0, 10)
        .map((entry) => sanitizeException(entry))
    : DROP

// Fixed reasons the web and mobile deep link handlers send.
const deepLinkInvalidReasons = [
  ...DEEP_LINK_FAILURE_REASONS,
  'Weather alert target could not be loaded',
  'Weather alert target was not found',
  'Weather alert notification type was not found',
  'Widget target slot was not found',
  'Community card target was not found',
  'Deep link target was not found',
  'target_unavailable',
]
const deepLinkParamKeys = [
  'source',
  'slot',
  'size',
  'type',
  'alertId',
  'cardId',
  'commentId',
  'parentId',
  'focus',
  'focusToken',
  'expiresAt',
]
const errorNames = [
  'Error',
  'AbortError',
  'AggregateError',
  'ChunkLoadError',
  'DOMException',
  'EvalError',
  'NetworkError',
  'NotFoundError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
]
const surfaces = ['web', 'mobile']
const scenarios = ['morning', 'midday', 'evening']
const chipCategories = ['Personal', 'Community', 'Sponsored']

/**
 * The explicit events the clients send and the only properties each may carry. Every
 * event may also carry `locale`, and the SDK properties below.
 */
export const ANALYTICS_EVENT_PROPERTIES: Readonly<
  Record<string, Readonly<Record<string, Rule>>>
> = Object.freeze({
  ritual_created: {
    ritual_type: oneOf(['daily_outfit']),
    weather_context: oneOf([...weatherConditionSchema.options, 'hero_cta']),
    timestamp,
  },
  wardrobe_upload_started: {
    file_size: number,
    item_count: integer,
    upload_source: oneOf(['web_file_picker']),
    timestamp,
  },
  alert_received: {
    alert_type: oneOf([
      ...alertRuleTypeSchema.options,
      'alert:weather',
      'weather_alert',
      'push_notification',
    ]),
    severity: oneOf(['info', 'warning', 'critical']),
    weather_severity: oneOf(['minor', 'moderate', 'severe', 'extreme', 'unknown']),
    timestamp,
  },
  affiliate_cta_shown: {
    partner_id: catalogId,
    offer_id: catalogId,
    recommendation_id: catalogId,
    scenario: oneOf(scenarios),
    surface: oneOf(['mobile_hero', ...affiliateCommunitySurfaceSchema.options]),
    locale_region: regionCode,
  },
  premium_subscribe_tapped: {
    plan: oneOf(['premium_monthly', 'premium_annual']),
    surface: oneOf(['mobile_settings', 'web_settings']),
  },
  locale_switched: { from_locale: locale, to_locale: locale, timestamp },
  share_card_shared: {
    client: oneOf(shareCardShareClientSchema.options),
    target: oneOf(shareCardShareTargetSchema.options),
    outcome: oneOf(shareCardShareOutcomeSchema.options),
    duration_ms: number,
  },
  cta_clicked: {
    cta_label: oneOf(['Start signup', 'Preview outfits', 'See the planner']),
    cta_type: oneOf(['primary', 'secondary']),
  },
  nav_link_clicked: {
    label: oneOf(['Daily ritual', 'Wardrobe', 'Community']),
    href: oneOf(['#ritual', '#wardrobe', '#community']),
  },
  chip_changed: {
    chipCategory: oneOf(chipCategories),
    previousCategory: oneOf(chipCategories),
    surface: oneOf(surfaces),
  },
  layout_interaction: {
    action: oneOf(['filter_chip_click', 'toggle_comparison', 'toggle_mobile_preview']),
    target: oneOf([
      ...communityFeedModeSchema.options,
      'comparison_mode_button',
      'mobile_preview_button',
    ]),
  },
  lookbook_prism_viewed: {
    viewportWidth: integer,
    layoutMode: oneOf(['split', 'stacked', 'mobile']),
  },
  bottom_nav_clicked: {
    tabId: oneOf(['home', 'wardrobe', 'community', 'settings']),
    targetPath: route,
  },
  error_page_viewed: {
    error_name: oneOf(errorNames),
    error_digest: matching(/^(?:none|\d{1,20})$/),
  },
  error_reset_clicked: {
    error_name: oneOf(errorNames),
    error_digest: matching(/^(?:none|\d{1,20})$/),
  },
  deep_link_invalid: {
    rawUrl: either(oneOf(['community-notification']), route),
    reason: oneOf(deepLinkInvalidReasons),
    surface: oneOf(surfaces),
    param_keys: listOf(deepLinkParamKeys),
  },
  deep_link_handled: {
    source: oneOf(deepLinkSourceSchema.options),
    slot: oneOf(deepLinkSlotSchema.options),
    widgetSize: oneOf(deepLinkWidgetSizeSchema.options),
    type: oneOf(deepLinkNotificationTypeSchema.options),
    surface: oneOf(surfaces),
  },
  hero_interaction: {
    interactionType: oneOf([
      'scenario_toggle',
      'ribbon_toggle',
      'garment_swap',
      'widget_tap',
      'watch_tap',
    ]),
    scenario: oneOf(scenarios),
    isExpanded: boolean,
    widgetSize: oneOf(deepLinkWidgetSizeSchema.options),
    slot: oneOf(deepLinkSlotSchema.options),
  },
  tab_one_viewed: {},
  tab_two_viewed: {},
  modal_opened: {},
  external_link_tapped: { url: origin },
})

/** SDK events each client may send, with their own properties. */
const SDK_EVENT_PROPERTIES: Record<
  AnalyticsPlatform,
  Record<string, Record<string, Rule>>
> = {
  web: {
    $pageview: {},
    $pageleave: {},
    $exception: {},
  },
  mobile: {
    $screen: { $screen_name: route, previous_screen: either(nullValue, route) },
    $exception: {},
    'Application Opened': { url: route, from_background: boolean },
    'Application Became Active': {},
    'Application Backgrounded': {},
    'Application Installed': { version, build: version },
    'Application Updated': {
      version,
      build: version,
      previous_version: version,
      previous_build: version,
    },
  },
}

/** Properties any event may carry: locale and the harmless SDK properties. */
const COMMON_PROPERTIES: Record<string, Rule> = {
  locale,
  token: sdkId,
  distinct_id: sdkId,
  $session_id: sdkId,
  $window_id: sdkId,
  $device_id: sdkId,
  $pageview_id: sdkId,
  $prev_pageview_id: sdkId,
  $insert_id: sdkId,
  $lib: sdkText,
  $lib_version: sdkText,
  $browser: sdkText,
  $browser_version: sdkValue,
  $browser_language: sdkText,
  $os: sdkText,
  $os_name: sdkText,
  $os_version: sdkValue,
  $device_type: sdkText,
  $device: sdkText,
  $device_manufacturer: sdkText,
  $device_model: sdkText,
  $app_build: version,
  $app_name: sdkText,
  $app_namespace: sdkText,
  $app_version: version,
  $screen_height: number,
  $screen_width: number,
  $viewport_height: number,
  $viewport_width: number,
  $time: number,
  $current_url: route,
  $pathname: route,
  $host: host,
  $referrer: either(oneOf(['$direct']), origin),
  $referring_domain: either(oneOf(['$direct']), host),
  $prev_pageview_pathname: route,
  $prev_pageview_duration: number,
  $prev_pageview_last_scroll: number,
  $prev_pageview_last_scroll_percentage: number,
  $prev_pageview_max_scroll: number,
  $prev_pageview_max_scroll_percentage: number,
  $prev_pageview_last_content: number,
  $prev_pageview_last_content_percentage: number,
  $prev_pageview_max_content: number,
  $prev_pageview_max_content_percentage: number,
  $process_person_profile: boolean,
  $is_identified: boolean,
  $geoip_disable: boolean,
  $ip: nullValue,
  $exception_list: exceptionList,
  $exception_level: oneOf(['fatal', 'error', 'warning', 'log', 'info', 'debug']),
}

/** The event names the platform may send. */
export function analyticsEventNames(platform: AnalyticsPlatform): string[] {
  return [
    ...Object.keys(ANALYTICS_EVENT_PROPERTIES),
    ...Object.keys(SDK_EVENT_PROPERTIES[platform]),
  ]
}

/**
 * A JSON.stringify replacer that leaves out what JSON cannot carry instead of throwing: a
 * BigInt, and any object met a second time (a cycle, or a shared reference; leaving it out
 * only sends less).
 */
function jsonSafe() {
  const seen = new WeakSet<object>()
  return (_key: string, value: unknown) => {
    if (typeof value === 'bigint') return undefined
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return undefined
      seen.add(value)
    }
    return value
  }
}

/**
 * The event as plain JSON data, or null. React Native puts the original uuid back when the
 * result has none, and a toJSON can vanish from the snapshot once and return a token later,
 * so an own uuid that the snapshot lost drops the event.
 */
function snapshotOf(event: object): Record<string, unknown> | null {
  const snapshot: unknown = JSON.parse(JSON.stringify(event, jsonSafe()))
  if (!isPlainRecord(snapshot)) return null
  if (has(event, 'uuid') && snapshot.uuid === undefined) return null
  return snapshot
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

/**
 * The outgoing event, or null when its uuid is present but invalid: React Native restores
 * the original uuid when the hook result has none, so leaving it out would not remove it.
 * `source` is already a JSON snapshot, so the event time arrives as its serialized string.
 */
function envelope(
  source: Record<string, unknown>,
  name: string,
  properties: Record<string, unknown>
): Record<string, unknown> | null {
  const result: Record<string, unknown> = { event: name, properties }
  if (source.uuid !== undefined) {
    if (typeof source.uuid !== 'string' || !UUID.test(source.uuid)) return null
    result.uuid = source.uuid
  }
  // Both SDKs hand the hook a Date and compute offsets from it, so the time goes back as one.
  if (typeof source.timestamp === 'string' && ISO_TIMESTAMP.test(source.timestamp)) {
    const time = Date.parse(source.timestamp)
    if (Number.isFinite(time)) result.timestamp = new Date(time)
  }
  return result
}

/**
 * The before_send hook for `platform`: returns a new event with only its envelope
 * (event, uuid, timestamp) and allowlisted properties, or null for an event outside the
 * allowlist. Any error drops the event: the SDKs send the original event when a hook
 * throws, so this never throws.
 */
export function createAnalyticsPrivacyFilter(platform: AnalyticsPlatform) {
  const sdkEvents = SDK_EVENT_PROPERTIES[platform]
  return function analyticsPrivacyFilter<T extends object>(event: T | null): T | null {
    if (!event) return event
    try {
      // Rules run on exactly what would reach the wire: serializing first applies every
      // toJSON, reads every getter once and leaves only plain arrays, records and primitives,
      // so no value can pass a rule and then serialize as something else.
      const source = snapshotOf(event)
      if (!source) return null
      const name = source.event
      if (typeof name !== 'string') return null
      const eventRules = has(ANALYTICS_EVENT_PROPERTIES, name)
        ? ANALYTICS_EVENT_PROPERTIES[name]
        : has(sdkEvents, name)
          ? sdkEvents[name]
          : undefined
      if (!eventRules) return null
      const properties = isPlainRecord(source.properties) ? source.properties : {}
      const sanitized: Record<string, unknown> = {}
      for (const key of Object.keys(properties)) {
        const rule = has(eventRules, key)
          ? eventRules[key]
          : has(COMMON_PROPERTIES, key)
            ? COMMON_PROPERTIES[key]
            : undefined
        if (!rule) continue
        const value = rule(properties[key], platform)
        if (value !== DROP) sanitized[key] = value
      }
      return envelope(source, name, sanitized) as T | null
    } catch {
      return null
    }
  }
}

/** The web client's privacy boundary; see createAnalyticsPrivacyFilter. */
export const webAnalyticsPrivacyFilter = createAnalyticsPrivacyFilter('web')
/** The mobile client's privacy boundary; see createAnalyticsPrivacyFilter. */
export const mobileAnalyticsPrivacyFilter = createAnalyticsPrivacyFilter('mobile')
