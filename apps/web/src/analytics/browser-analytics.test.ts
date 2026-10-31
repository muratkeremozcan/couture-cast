import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CaptureResult } from 'posthog-js'
import { SHARE_CARD_SHARED_ALLOWED_PROPERTIES } from '@couture/api-client'

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  get_distinct_id: vi.fn(() => 'distinct-web'),
}))
vi.mock('posthog-js', () => ({ default: posthog }))

const business = {
  client: 'web',
  target: 'unknown',
  outcome: 'handed_off',
  duration_ms: 1250,
}
const sdk = {
  token: 'phc_project',
  distinct_id: 'distinct-web',
  $lib: 'web',
  $lib_version: '1.356.1',
  $os: 'Mac OS X',
  $device_type: 'Desktop',
}
// What the sanitizer always sets: no GeoIP, no stored IP, no person profile.
const privacy = { $geoip_disable: true, $ip: null, $process_person_profile: false }
// What posthog-js adds to a capture before before_send runs: URL, path, host, referrer,
// screen, session, a registered super property and person updates.
const enriched = {
  ...business,
  ...sdk,
  $current_url: 'https://couturecast.app/community/posts/post-123?ref=private',
  $pathname: '/community/posts/post-123',
  $host: 'couturecast.app',
  $referrer: 'https://referrer.example/private',
  $referring_domain: 'referrer.example',
  $screen_height: 1100,
  $screen_width: 1440,
  $viewport_width: 1440,
  $session_id: 'session-1',
  $window_id: 'window-1',
  $browser: 'Chrome',
  plan_tier: 'premium',
  $set: { email: 'member@example.test' },
  $set_once: { $initial_current_url: 'https://couturecast.app/' },
}
const timestamp = new Date('2026-10-30T12:00:00.000Z')
const shareEvent = (properties: Record<string, unknown> = enriched): CaptureResult => ({
  uuid: '0199-share',
  event: 'share_card_shared',
  properties,
  $set: { email: 'member@example.test' },
  $set_once: { $initial_referrer: 'https://referrer.example/private' },
  timestamp,
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  delete window.__enableAnalyticsTestHook
  delete window.__capturedAnalyticsEvents
})

describe('U-SHARE-SANITIZER-WEB: share_card_shared before_send', () => {
  it('keeps the envelope and only the allowlisted primitive properties with GeoIP off', async () => {
    const { shareCardSharedBeforeSend } = await import('./browser-analytics')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = shareCardSharedBeforeSend(shareEvent())
    expect(result).toEqual({
      uuid: '0199-share',
      event: 'share_card_shared',
      timestamp,
      properties: { ...business, ...sdk, ...privacy },
    })
    expect(Object.keys(result!).sort()).toEqual(
      ['event', 'properties', 'timestamp', 'uuid'].sort()
    )
    expect(
      Object.keys(result!.properties).every((key) =>
        (SHARE_CARD_SHARED_ALLOWED_PROPERTIES as readonly string[]).includes(key)
      )
    ).toBe(true)
    // GeoIP stays off even when the caller tried to turn it on, and locale is kept.
    expect(
      shareCardSharedBeforeSend(
        shareEvent({ ...business, $geoip_disable: false, locale: 'de-DE' })
      )?.properties
    ).toEqual({ ...business, locale: 'de-DE', ...privacy })
    const untimed = shareEvent()
    delete untimed.timestamp
    expect(shareCardSharedBeforeSend(untimed)).not.toHaveProperty('timestamp')
    expect(warn).not.toHaveBeenCalled()
  })

  it('passes every other event through untouched', async () => {
    const { shareCardSharedBeforeSend } = await import('./browser-analytics')
    const pageview: CaptureResult = {
      uuid: '0199-pageview',
      event: '$pageview',
      properties: { ...enriched },
      $set: { email: 'member@example.test' },
    }
    expect(shareCardSharedBeforeSend(pageview)).toBe(pageview)
    expect(pageview.properties).toEqual(enriched)
    expect(shareCardSharedBeforeSend(null)).toBeNull()
  })

  it.each([
    ['an outcome outside the web client', { ...business, outcome: 'completed' }],
    [
      'a missing business key',
      { client: 'web', target: 'unknown', outcome: 'handed_off' },
    ],
    ['a nested object in a business key', { ...business, target: { name: 'unknown' } }],
    [
      'a cyclic value',
      (() => {
        const cyclic: Record<string, unknown> = { ...business }
        cyclic.client = cyclic
        return cyclic
      })(),
    ],
    [
      'a throwing getter',
      Object.defineProperty({ ...business }, 'outcome', {
        enumerable: true,
        get() {
          throw new Error('private value')
        },
      }),
    ],
    ['properties that are not an object', 'share_card_shared'],
  ])('drops the event and logs a closed code for %s', async (_, properties) => {
    const { SHARE_CARD_ANALYTICS_DROPPED, shareCardSharedBeforeSend } = await import(
      './browser-analytics'
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(
      shareCardSharedBeforeSend(shareEvent(properties as Record<string, unknown>))
    ).toBeNull()
    expect(warn).toHaveBeenCalledExactlyOnceWith(SHARE_CARD_ANALYTICS_DROPPED)
    expect(SHARE_CARD_ANALYTICS_DROPPED).toBe('share_card_analytics_dropped')
  })

  it('never throws, even when reading the event itself throws', async () => {
    const { SHARE_CARD_ANALYTICS_DROPPED, shareCardSharedBeforeSend } = await import(
      './browser-analytics'
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const hostile = Object.defineProperty({}, 'event', {
      get() {
        throw new Error('hostile')
      },
    }) as CaptureResult
    expect(() => shareCardSharedBeforeSend(hostile)).not.toThrow()
    expect(shareCardSharedBeforeSend(hostile)).toBeNull()
    expect(warn).toHaveBeenCalledWith(SHARE_CARD_ANALYTICS_DROPPED)
  })
})

describe('browser analytics initialization', () => {
  it('registers before_send on posthog-js and keeps the Playwright capture hook', async () => {
    vi.stubEnv('POSTHOG_API_KEY', 'phc_project')
    window.__enableAnalyticsTestHook = true
    const { browserAnalytics, shareCardSharedBeforeSend } = await import(
      './browser-analytics'
    )
    browserAnalytics.capture('share_card_shared', business)
    expect(posthog.init).toHaveBeenCalledExactlyOnceWith(
      'phc_project',
      expect.objectContaining({ before_send: shareCardSharedBeforeSend })
    )
    expect(window.__capturedAnalyticsEvents).toEqual([
      { event: 'share_card_shared', properties: business },
    ])
    expect(posthog.capture).toHaveBeenCalledWith('share_card_shared', business, {
      send_instantly: true,
      transport: 'XHR',
    })
    expect(browserAnalytics.getDistinctId()).toBe('distinct-web')
    expect(posthog.init).toHaveBeenCalledOnce()
  })

  it('stays inert without a PostHog token', async () => {
    const { browserAnalytics, initializeBrowserAnalytics } = await import(
      './browser-analytics'
    )
    browserAnalytics.capture('share_card_shared', business)
    expect(browserAnalytics.getDistinctId()).toBeUndefined()
    expect(initializeBrowserAnalytics()).toBe(browserAnalytics)
    expect(posthog.init).not.toHaveBeenCalled()
    expect(posthog.capture).not.toHaveBeenCalled()
  })
})
