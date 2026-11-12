// Learning path Step 49: Native platform sharing.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-49-native-platform-sharing
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Linking } from 'react-native'
import { PostHog } from 'posthog-react-native'
import type * as PostHogModule from 'posthog-react-native'
import type * as ApiClientModule from '@couture/api-client'

/**
 * I-SHARE-WIRE-MOBILE: the real posthog-react-native client, with only `fetch` replaced,
 * serializes the batch it would send. The share event must leave with its SDK envelope
 * intact and only allowlisted properties, even when a sensitive URL, a registered super
 * property and `$set` were present before the hook ran.
 */
vi.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }))
// The browser has neither expo-file-system nor AsyncStorage, so the app's own module-level
// client gets memory persistence. Everything else about the SDK stays real.
vi.mock('posthog-react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof PostHogModule>()
  class MemoryPostHog extends actual.PostHog {
    constructor(
      apiKey: string,
      options?: ConstructorParameters<typeof actual.PostHog>[1]
    ) {
      super(apiKey, { ...options, persistence: 'memory' })
    }
  }
  return { ...actual, __esModule: true, default: MemoryPostHog }
})
vi.mock('@couture/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>()
  return {
    ...actual,
    sanitizeShareCardSharedProperties: vi.fn(actual.sanitizeShareCardSharedProperties),
  }
})
const quiet = vi.hoisted(() => {
  const original = console.warn
  console.warn = () => undefined
  return () => {
    console.warn = original
  }
})
import {
  SHARE_CARD_SHARED_ALLOWED_PROPERTIES,
  sanitizeShareCardSharedProperties,
} from '@couture/api-client'
import { mobilePostHogPrivacyOptions } from './posthog'
import { createMobileAnalyticsClient } from '../analytics/mobile-analytics'
import { trackMobileShareCardShared } from '../analytics/track-events'
import { processMobileDeepLink } from '../lib/mobile-deep-link-handler'
quiet()

type Batch = { api_key: string; batch: Record<string, unknown>[]; sent_at: string }
const sensitiveUrl = 'https://couturecast.app/share/post-123?token=secret'
const seenBeforeSanitizing: Record<string, unknown>[] = []

async function bodyOf(init: RequestInit): Promise<Batch> {
  const headers = new Headers(init.headers)
  const body = init.body as BodyInit
  if (headers.get('Content-Encoding') !== 'gzip')
    return JSON.parse(await new Response(body).text()) as Batch
  const stream = new Response(body).body!.pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text()) as Batch
}

let fetchMock: ReturnType<typeof vi.fn>
let client: PostHog
beforeEach(() => {
  seenBeforeSanitizing.length = 0
  fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
  vi.stubGlobal('fetch', fetchMock)
  client = new PostHog('phc_wire_test', {
    host: 'https://wire.test',
    persistence: 'memory',
    flushAt: 100,
    flushInterval: 0,
    captureAppLifecycleEvents: false,
    preloadFeatureFlags: false,
    fetchRetryCount: 0,
    before_send: [
      (event) => {
        if (event?.event === 'share_card_shared')
          seenBeforeSanitizing.push({ ...event.properties })
        return event
      },
      ...mobilePostHogPrivacyOptions.before_send,
    ],
  })
})
afterEach(async () => {
  await client.shutdown()
  vi.unstubAllGlobals()
})

async function flushedBatches() {
  await client.flush()
  const batches: Batch[] = []
  for (const [url, init] of fetchMock.mock.calls as [string, RequestInit][])
    if (String(url).endsWith('/batch/')) batches.push(await bodyOf(init))
  return batches
}

async function captureShare() {
  await client.ready()
  await client.register({
    registered_super_property: 'plan-premium',
    $current_url: sensitiveUrl,
  })
  const facade = createMobileAnalyticsClient(client)
  // The app path: the composer's tracker through the mobile facade, which adds locale.
  trackMobileShareCardShared(facade, {
    client: 'ios',
    target: 'instagram',
    outcome: 'completed',
    duration_ms: 2150,
  })
  // A raw capture carrying a URL and $set must be stripped the same way.
  client.capture('share_card_shared', {
    client: 'android',
    target: 'pinterest',
    outcome: 'target_chosen',
    duration_ms: 900,
    url: sensitiveUrl,
    $set: { email: 'member@example.com' },
    $set_once: { first_url: sensitiveUrl },
  })
  client.capture('tab_one_viewed', { locale: 'en-US' })
}

describe('I-SHARE-WIRE-MOBILE: the serialized share_card_shared request', () => {
  it('sends exactly the envelope and allowlisted properties', async () => {
    await captureShare()
    const batches = await flushedBatches()
    expect(batches).toHaveLength(1)
    const [request] = batches
    expect(Object.keys(request!).sort()).toEqual(['api_key', 'batch', 'sent_at'])
    expect(request!.api_key).toBe('phc_wire_test')
    const shares = request!.batch.filter((item) => item.event === 'share_card_shared')
    expect(shares).toHaveLength(2)
    // The enrichment really was there before before_send ran.
    expect(seenBeforeSanitizing).toHaveLength(2)
    for (const before of seenBeforeSanitizing) {
      expect(before).toMatchObject({
        $current_url: sensitiveUrl,
        registered_super_property: 'plan-premium',
      })
      expect(Object.keys(before).length).toBeGreaterThan(
        SHARE_CARD_SHARED_ALLOWED_PROPERTIES.length
      )
    }
    expect(seenBeforeSanitizing[1]).toHaveProperty('$set')
    for (const item of shares) {
      expect(Object.keys(item).sort()).toEqual(
        [
          'distinct_id',
          'event',
          'library',
          'library_version',
          'properties',
          'timestamp',
          'type',
          'uuid',
        ].sort()
      )
      expect(item.type).toBe('capture')
      expect(item.library).toBe('posthog-react-native')
      const properties = item.properties as Record<string, unknown>
      expect(
        Object.keys(properties).filter(
          (key) =>
            !(SHARE_CARD_SHARED_ALLOWED_PROPERTIES as readonly string[]).includes(key)
        )
      ).toEqual([])
      expect(properties.$geoip_disable).toBe(true)
      expect(properties.$ip).toBeNull()
      expect(properties.$process_person_profile).toBe(false)
      expect(JSON.stringify(item)).not.toContain('couturecast.app')
      expect(JSON.stringify(item)).not.toContain('member@example.com')
      expect(JSON.stringify(item)).not.toContain('plan-premium')
    }
    const appPath = shares[0]!.properties as Record<string, unknown>
    expect(Object.keys(appPath).sort()).toEqual(
      [
        'client',
        'target',
        'outcome',
        'duration_ms',
        'locale',
        '$geoip_disable',
        '$ip',
        '$process_person_profile',
        '$lib',
        '$lib_version',
        ...SDK_IDENTITY_KEYS,
      ].sort()
    )
    expect(appPath).toMatchObject({
      client: 'ios',
      target: 'instagram',
      outcome: 'completed',
      duration_ms: 2150,
      locale: 'en-US',
    })
    // Other events keep their own allowlist: no super property, a route URL.
    const viewed = request!.batch.find((item) => item.event === 'tab_one_viewed')
    expect(viewed?.properties).toMatchObject({
      locale: 'en-US',
      $current_url: 'https://couturecast.app/:unknown',
      // PostHog adds no location, keeps no IP and builds no person for any event.
      $geoip_disable: true,
      $ip: null,
      $process_person_profile: false,
    })
    expect(viewed?.properties).not.toHaveProperty('registered_super_property')
  })

  it('U-ANALYTICS-PRIVACY-MOBILE: sends no person update or personal property on the wire', async () => {
    await client.ready()
    client.identify('member-123', { email: 'member@example.com', name: 'Alice Smith' })
    client.capture('tab_one_viewed', {
      locale: 'en-US',
      email: 'member@example.com',
      birthdate: '2011-04-01',
      $set: { firstName: 'Alice' },
    })
    const items = (await flushedBatches()).flatMap((batch) => batch.batch)
    expect(items.map((item) => item.event)).not.toContain('$identify')
    expect(propertiesOf(items, 'tab_one_viewed')).toMatchObject({ locale: 'en-US' })
    const serialized = JSON.stringify(items)
    for (const leak of ['member@example.com', 'Alice', '2011-04-01'])
      expect(serialized).not.toContain(leak)
  })

  it.each([
    [
      'throws',
      () => {
        throw new Error('sanitizer exploded')
      },
    ],
    ['returns null', () => null],
  ])(
    'a sanitizer that %s drops the share event; the share outcome is unchanged',
    async (name, failure) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      vi.mocked(sanitizeShareCardSharedProperties).mockImplementation(failure)
      await expect(captureShare()).resolves.toBeUndefined()
      const batches = await flushedBatches()
      const items = batches.flatMap((batch) => batch.batch)
      expect(items.filter((item) => item.event === 'share_card_shared')).toEqual([])
      expect(items.map((item) => item.event)).toContain('tab_one_viewed')
      // One closed code per dropped share event, never the event or its properties.
      expect(new Set(warn.mock.calls.flat())).toEqual(
        new Set([
          name === 'throws'
            ? '[cc69-analytics] before_send_failed'
            : '[cc69-analytics] share_event_dropped',
        ])
      )
    }
  )
})

// A guardian invitation token as the API issues it: a JWT whose payload names the teen
// and the guardian's email, delivered to the app as a cold-start link.
const invitationToken =
  'eyJhbGciOiJIUzI1NiJ9.eyJ0ZWVuSWQiOiJ0ZWVuLTEiLCJndWFyZGlhbkVtYWlsIjoiZ0BleC50ZXN0In0.c2lnbmF0dXJl'
const invitationLink = `couturecast://guardian-accept?token=${invitationToken}&email=teen%40example.test#frag-teen`

/**
 * Runs `scenario` against a real client built with the app's privacy options and
 * returns every batch item it sent, decoded from the request body.
 */
async function privacyBatch(scenario: (privacyClient: PostHog) => Promise<void>) {
  vi.spyOn(Linking, 'getInitialURL').mockResolvedValue(invitationLink)
  fetchMock.mockClear()
  const privacyClient = new PostHog('phc_wire_test', {
    host: 'https://wire.test',
    persistence: 'memory',
    flushAt: 100,
    flushInterval: 0,
    fetchRetryCount: 0,
    // The app's own privacy options decide flags and remote config here.
    ...mobilePostHogPrivacyOptions,
    // Exceptions are captured explicitly below; the runner keeps its own global handlers.
    errorTracking: { autocapture: false },
    // The automatic lifecycle path: Application Opened carries the cold-start link.
    captureAppLifecycleEvents: true,
  })
  try {
    await privacyClient.ready()
    await scenario(privacyClient)
    await vi.waitFor(async () => {
      await privacyClient.flush()
      const items = await sentItems()
      expect(items.map((item) => item.event)).toContain('Application Opened')
    })
    return await sentItems()
  } finally {
    await privacyClient.shutdown()
  }
}
async function sentItems() {
  const items: Record<string, unknown>[] = []
  for (const [url, init] of fetchMock.mock.calls as [string, RequestInit][])
    if (String(url).endsWith('/batch/')) items.push(...(await bodyOf(init)).batch)
  return items
}
const propertiesOf = (items: Record<string, unknown>[], event: string) =>
  items.find((item) => item.event === event)?.properties as Record<string, unknown>
const personalUuid = '01234567-89ab-cdef-0123-456789abcdef'
const leaks = [
  invitationToken,
  'eyJ',
  'teen@example.test',
  'teen%40example.test',
  'frag-teen',
  'Alice',
  'alice',
  '2011-04-01',
  personalUuid,
  'guardian-secret',
  'post-123',
  'card-9',
  'private-photo',
  'photo-secret',
]
/** Every request the client made, by URL: only event batches, never flags or config. */
function requestUrls() {
  return (fetchMock.mock.calls as [string, RequestInit][]).map(([url]) => String(url))
}

describe('U-ANALYTICS-PRIVACY-MOBILE: the serialized batch', () => {
  it('sends link URLs as origin and route template only', async () => {
    const items = await privacyBatch(async (privacyClient) => {
      const analytics = createMobileAnalyticsClient(privacyClient)
      await privacyClient.screen('/community', {
        previous_screen: '/profile/alice-smith',
      })
      await privacyClient.screen('/community/post-123')
      await processMobileDeepLink({
        params: { source: 'bad_source', email: 'teen@example.test', cardId: 'card-9' },
        locale: 'en-US',
        analytics,
        setWidgetScenario: vi.fn(),
        setForecastSlot: vi.fn(),
        setFocusedWeatherAlert: vi.fn(),
        setIsInvalidDeepLink: vi.fn(),
        pushToCommunity: vi.fn(),
      })
      analytics.capture('external_link_tapped', {
        url: 'https://weather.example/alerts/alice-smith?ref=teen@example.test',
      })
    })
    expect(propertiesOf(items, 'Application Opened').url).toBe(
      'couturecast://guardian-accept'
    )
    const screens = items
      .filter((item) => item.event === '$screen')
      .map((item) => item.properties as Record<string, unknown>)
    expect(screens[0]).toMatchObject({
      $screen_name: '/community',
      previous_screen: '/:unknown',
    })
    expect(screens[1]?.$screen_name).toBe('/:unknown')
    for (const url of requestUrls()) expect(url).toMatch(/\/batch\/$/)
    // Only known link parameter names: an unexpected name never leaves.
    expect(propertiesOf(items, 'deep_link_invalid').param_keys).toEqual([
      'cardId',
      'source',
    ])
    expect(propertiesOf(items, 'external_link_tapped').url).toBe(
      'https://weather.example'
    )
    const serialized = JSON.stringify(items)
    for (const leak of leaks) expect(serialized).not.toContain(leak)
  })

  it('sends no caller object whose own serialization carries a token', async () => {
    const tokenUrl = `https://couturecast.app/guardian/accept?token=${invitationToken}`
    class LeakyArray<T> extends Array<T> {
      toJSON() {
        return tokenUrl
      }
    }
    const keys = new LeakyArray<string>()
    keys.push('source')
    const items = await privacyBatch((privacyClient) => {
      // posthog-react-native puts the original uuid back when before_send returns none.
      privacyClient.capture('modal_opened', { locale: 'en-US' }, {
        uuid: { toJSON: () => tokenUrl },
      } as unknown as Parameters<PostHog['capture']>[2])
      let reads = 0
      privacyClient.capture('tab_two_viewed', {}, {
        uuid: { toJSON: () => (++reads === 1 ? undefined : tokenUrl) },
      } as unknown as Parameters<PostHog['capture']>[2])
      privacyClient.capture('deep_link_invalid', {
        param_keys: keys as unknown as string[],
        surface: 'mobile',
      })
      return Promise.resolve()
    })
    expect(items.some((item) => item.event === 'modal_opened')).toBe(false)
    expect(items.some((item) => item.event === 'tab_two_viewed')).toBe(false)
    expect(propertiesOf(items, 'deep_link_invalid')).not.toHaveProperty('param_keys')
    expect(propertiesOf(items, 'deep_link_invalid').surface).toBe('mobile')
    expect(JSON.stringify(items)).not.toContain(invitationToken)
  })

  it('sends exceptions as type and code locations only', async () => {
    const items = await privacyBatch((privacyClient) => {
      privacyClient.captureException(
        new Error(
          `Invalid token=guardian-secret for Alice Smith, DOB 2011-04-01, email teen%40example.test ${invitationToken} https://cdn.test/private/${personalUuid}/private-photo.jpg?token=photo-secret`
        )
      )
      return Promise.resolve()
    })
    const exception = propertiesOf(items, '$exception')
    expect(Object.keys(exception)).not.toContain('$exception_values')
    const [entry] = exception.$exception_list as {
      type: string
      value: string
      stacktrace: { frames: Record<string, unknown>[] }
    }[]
    expect(entry!.type).toBe('Error')
    expect(entry!.value).toBe('redacted')
    for (const frame of entry!.stacktrace.frames)
      expect(frame.filename).toMatch(/^(?:<unknown>|[A-Za-z0-9_.-]+)$/)
    for (const url of requestUrls()) expect(url).toMatch(/\/batch\/$/)
    const serialized = JSON.stringify(items)
    for (const leak of leaks) expect(serialized).not.toContain(leak)
  })
})

/**
 * The allowlisted SDK keys posthog-react-native 4.x puts inside `properties` under the
 * browser test runtime. On a device `$os` joins them; `token` and `distinct_id` stay
 * allowlisted for SDKs that copy them into properties, and this one keeps distinct_id
 * top-level in the envelope.
 */
const SDK_IDENTITY_KEYS = ['$device_type']
