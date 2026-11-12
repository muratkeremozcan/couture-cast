// Learning path Step 49: Native platform sharing.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-49-native-platform-sharing
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BeforeSendFn, CaptureResult, PostHogConfig } from 'posthog-js'
import {
  SHARE_CARD_SHARED_ALLOWED_PROPERTIES,
  webAnalyticsPrivacyFilter,
} from '@couture/api-client'

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
  uuid: '0199f5c2-3d1e-7a4b-9c8d-1e2f3a4b5c61',
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
      uuid: '0199f5c2-3d1e-7a4b-9c8d-1e2f3a4b5c61',
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
      uuid: '0199f5c2-3d1e-7a4b-9c8d-1e2f3a4b5c62',
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
      expect.objectContaining({
        before_send: [webAnalyticsPrivacyFilter, shareCardSharedBeforeSend],
      })
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

/** The options posthog-js was initialized with, from the single init call. */
async function initOptions(testMode: boolean): Promise<Partial<PostHogConfig>> {
  vi.stubEnv('POSTHOG_API_KEY', 'phc_project')
  if (testMode) window.__enableAnalyticsTestHook = true
  const { initializeBrowserAnalytics } = await import('./browser-analytics')
  initializeBrowserAnalytics()
  expect(posthog.init).toHaveBeenCalledOnce()
  return posthog.init.mock.calls[0]![1] as Partial<PostHogConfig>
}

/**
 * Production analytics privacy: CoutureCast has members aged 13 to 15 (with guardian
 * consent) and wardrobe photos, so the browser SDK only sends explicit events,
 * pageviews and exceptions. Nothing records the screen, reads element text or inputs,
 * shows a survey or builds a person profile for an anonymous visitor.
 */
describe('U-ANALYTICS-PRIVACY-WEB: production posthog-js configuration', () => {
  const privacy = {
    autocapture: false,
    rageclick: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    mask_personal_data_properties: true,
    person_profiles: 'identified_only',
    // No /flags or remote config request, and no stored initial URL or referrer.
    advanced_disable_flags: true,
    save_referrer: false,
    save_campaign_params: false,
  }

  it('turns off autocapture, recording and surveys and keeps pageviews and exceptions', async () => {
    const options = await initOptions(false)
    expect(options).toMatchObject({
      ...privacy,
      capture_pageview: 'history_change',
      capture_exceptions: true,
      session_recording: { maskAllInputs: true, maskTextSelector: '*' },
    })
  })

  it('loads only the exception autocapture script; logs, remote config JS and the rest are blocked', async () => {
    const prepare = (await initOptions(false)).prepare_external_dependency_script!
    const script = (src: string) => {
      const tag = document.createElement('script')
      tag.src = src
      return tag
    }
    const allowed = script('/ingest/static/exception-autocapture.js?v=1.356.1')
    expect(prepare(allowed)).toBe(allowed)
    for (const blocked of [
      '/ingest/static/logs.js?v=1.356.1',
      '/ingest/array/phc_project/config.js',
      '/ingest/static/lazy-recorder.js?v=1.356.1',
      '/ingest/static/surveys.js?v=1.356.1',
      '/ingest/static/toolbar.js?v=1.356.1&t=1',
      '/ingest/static/web-vitals.js?v=1.356.1',
      '/ingest/static/exception-autocapture.js.evil/logs.js',
      'https://evil.example/static/exception-autocapture.js',
    ])
      expect(prepare(script(blocked))).toBeNull()
  })

  it('keeps the same privacy switches in analytics test mode', async () => {
    const options = await initOptions(true)
    expect(options).toMatchObject({
      ...privacy,
      capture_pageview: false,
      capture_exceptions: false,
    })
  })

  it('sends only allowlisted properties and no person updates', async () => {
    const hooks = (await initOptions(false)).before_send as BeforeSendFn[]
    const pageview: CaptureResult = {
      uuid: '0199f5c2-3d1e-7a4b-9c8d-1e2f3a4b5c62',
      event: '$pageview',
      properties: {
        $current_url: 'https://couturecast.app/profile/alice-smith?token=guardian-secret',
        email: 'member@example.test',
        name: 'Teen Member',
        birthdate: '2011-04-01',
        plan_tier: 'premium',
        $set: { email: 'member@example.test' },
      },
      $set: { email: 'member@example.test', name: 'Teen Member', plan: 'premium' },
      $set_once: { birthdate: '2011-04-01' },
    }
    const sent = hooks.reduce<CaptureResult | null>(
      (event, hook) => hook(event),
      pageview
    )
    expect(sent).toEqual({
      uuid: '0199f5c2-3d1e-7a4b-9c8d-1e2f3a4b5c62',
      event: '$pageview',
      properties: { $current_url: 'https://couturecast.app/:unknown' },
    })
  })
})
