import { describe, expect, it } from 'vitest'
import {
  EXCEPTION_MESSAGE_PLACEHOLDER,
  analyticsOriginUrl,
  analyticsRouteUrl,
  mobileAnalyticsPrivacyFilter,
  webAnalyticsPrivacyFilter,
} from '../src'

type Event = {
  event: string
  uuid?: string
  timestamp?: Date
  properties?: Record<string, unknown>
  $set?: Record<string, unknown>
  $set_once?: Record<string, unknown>
}

// A guardian invitation token as the API issues it: a JWT whose payload names the teen
// and the guardian's email.
const invitationToken =
  'eyJhbGciOiJIUzI1NiJ9.eyJ0ZWVuSWQiOiJ0ZWVuLTEiLCJndWFyZGlhbkVtYWlsIjoiZ0BleC50ZXN0In0.c2lnbmF0dXJl'
const personalUuid = '01234567-89ab-cdef-0123-456789abcdef'
const sdk = {
  token: 'phc_project',
  distinct_id: '0192f0c4-0000-7000-8000-000000000001',
  $session_id: '0192f0c4-0000-7000-8000-000000000002',
  $lib: 'web',
  $lib_version: '1.356.1',
  $browser: 'Chrome',
  $browser_version: 130,
  $os: 'Mac OS X',
  $device_type: 'Desktop',
  $screen_width: 1440,
  $process_person_profile: false,
}
// Everything posthog-js or a careless caller could add that must never leave.
const hostile = {
  email: 'teen@example.test',
  name: 'Alice Smith',
  birthdate: '2011-04-01',
  plan_tier: 'premium',
  $raw_user_agent: 'Mozilla/5.0',
  $timezone: 'America/Chicago',
  $device_name: "Alice's iPhone",
  $session_entry_url: `https://couturecast.app/guardian/accept?token=${invitationToken}`,
  $initial_current_url: `https://couturecast.app/guardian/accept?token=${invitationToken}`,
  $set: { email: 'teen@example.test' },
}
const leaks = [
  invitationToken,
  'eyJ',
  'teen@example',
  'teen%40example',
  'Alice',
  'alice',
  '2011-04-01',
  personalUuid,
  'guardian-secret',
  'hidden',
]
const expectNoLeak = (value: unknown) => {
  const serialized = JSON.stringify(value)
  for (const leak of leaks) expect(serialized).not.toContain(leak)
}

describe('analytics privacy filter: events and properties', () => {
  it('keeps the envelope and only allowlisted, valid properties of an explicit event', () => {
    const timestamp = new Date('2026-11-11T12:00:00.000Z')
    const sent = webAnalyticsPrivacyFilter<Event>({
      uuid: '0199f5c2-3d1e-7a4b-9c8d-1e2f3a4b5c60',
      event: 'ritual_created',
      timestamp,
      properties: {
        ...sdk,
        ...hostile,
        ritual_type: 'daily_outfit',
        weather_context: 'rain',
        timestamp: '2026-11-11T12:00:00.000Z',
        user_id: 'web-anonymous-user',
        location_id: 'America/Chicago',
        locale: 'de-DE',
      },
      $set: { email: 'teen@example.test' },
      $set_once: { birthdate: '2011-04-01' },
    })
    expect(sent).toEqual({
      uuid: '0199f5c2-3d1e-7a4b-9c8d-1e2f3a4b5c60',
      event: 'ritual_created',
      timestamp,
      properties: {
        ...sdk,
        ritual_type: 'daily_outfit',
        weather_context: 'rain',
        timestamp: '2026-11-11T12:00:00.000Z',
        locale: 'de-DE',
      },
    })
    expectNoLeak(sent)
  })

  it('drops strings outside their enum and values of the wrong type', () => {
    const sent = mobileAnalyticsPrivacyFilter<Event>({
      event: 'alert_received',
      properties: {
        alert_type: 'Storm warning for Alice at 12 Elm St',
        severity: 'critical',
        weather_severity: 'severe',
        timestamp: 'yesterday',
        locale: 'xx-XX',
      },
    })
    expect(sent?.properties).toEqual({ severity: 'critical', weather_severity: 'severe' })
    expect(
      webAnalyticsPrivacyFilter<Event>({
        event: 'deep_link_invalid',
        properties: {
          reason: `token=${invitationToken}`,
          param_keys: ['source', 'email', invitationToken],
          surface: 'web',
        },
      })?.properties
    ).toEqual({ param_keys: ['source'], surface: 'web' })
    expect(
      webAnalyticsPrivacyFilter<Event>({
        event: 'lookbook_prism_viewed',
        properties: { viewportWidth: '1440', layoutMode: 'split' },
      })?.properties
    ).toEqual({ layoutMode: 'split' })
  })

  it('drops events outside the allowlist, person updates included', () => {
    for (const event of ['$identify', '$set', '$autocapture', 'moderation_case_viewed'])
      expect(
        webAnalyticsPrivacyFilter<Event>({ event, properties: { ...sdk } })
      ).toBeNull()
    // Each client keeps only its own SDK events.
    expect(
      webAnalyticsPrivacyFilter<Event>({ event: '$screen', properties: {} })
    ).toBeNull()
    expect(
      mobileAnalyticsPrivacyFilter<Event>({ event: '$pageview', properties: {} })
    ).toBeNull()
    expect(webAnalyticsPrivacyFilter(null)).toBeNull()
    expect(webAnalyticsPrivacyFilter({ properties: {} })).toBeNull()
  })

  it('sends no object whose own serialization could carry a token', () => {
    const leaky = {
      toJSON: () => `https://couturecast.app/guardian/accept?token=${invitationToken}`,
    }
    class Props {
      locale = 'en-US'
      toJSON() {
        return { locale: invitationToken }
      }
    }
    const fromCustomRecord = mobileAnalyticsPrivacyFilter<Event>({
      event: 'modal_opened',
      properties: new Props() as unknown as Record<string, unknown>,
    })
    expect(fromCustomRecord).toEqual({ event: 'modal_opened', properties: {} })
    expectNoLeak(fromCustomRecord)

    class StampedDate extends Date {
      override toJSON() {
        return invitationToken
      }
    }
    const stamped = mobileAnalyticsPrivacyFilter<Event>({
      event: 'modal_opened',
      timestamp: new StampedDate(0),
      properties: { locale: leaky, surface: leaky },
    } as unknown as Event)
    expect(stamped).toEqual({ event: 'modal_opened', properties: {} })
    expectNoLeak(stamped)

    // React Native puts the original uuid back when the result has none, so an invalid
    // uuid drops the whole event.
    expect(
      mobileAnalyticsPrivacyFilter<Event>({
        event: 'modal_opened',
        uuid: leaky,
      } as unknown as Event)
    ).toBeNull()

    // A toJSON that returns nothing on the first read and a token on the next.
    let uuidReads = 0
    const vanishing = {
      toJSON: () => (++uuidReads === 1 ? undefined : invitationToken),
    }
    expect(
      mobileAnalyticsPrivacyFilter<Event>({
        event: 'modal_opened',
        uuid: vanishing,
      } as unknown as Event)
    ).toBeNull()

    // What JSON cannot carry costs the value, never the event.
    const cyclic: Record<string, unknown> = { locale: 'en-US' }
    cyclic.self = cyclic
    expect(
      mobileAnalyticsPrivacyFilter<Event>({
        event: 'modal_opened',
        properties: { locale: 'en-US', size: BigInt(1), loop: cyclic },
      } as unknown as Event)
    ).toEqual({ event: 'modal_opened', properties: { locale: 'en-US' } })

    // A value shared with a discarded property still reaches the allowed one.
    const shared = ['source']
    expect(
      webAnalyticsPrivacyFilter<Event>({
        event: 'deep_link_invalid',
        properties: { discarded: shared, param_keys: shared, surface: 'web' },
      })?.properties
    ).toEqual({ param_keys: ['source'], surface: 'web' })

    // An Array subclass keeps its species through filter, slice and map.
    class LeakyArray<T> extends Array<T> {
      toJSON() {
        return `https://couturecast.app/guardian/accept?token=${invitationToken}`
      }
    }
    const keys = new LeakyArray<string>()
    keys.push('source')
    const list = new LeakyArray<unknown>()
    list.push({ type: 'UploadError', stacktrace: { frames: [] } })
    const arrays = webAnalyticsPrivacyFilter<Event>({
      event: 'deep_link_invalid',
      properties: { param_keys: keys, surface: 'web' },
    })
    expect(arrays?.properties).toEqual({ surface: 'web' })
    expectNoLeak(arrays)
    const exceptionArrays = mobileAnalyticsPrivacyFilter<Event>({
      event: '$exception',
      properties: { $exception_list: list },
    })
    expectNoLeak(exceptionArrays)

    // A getter can pass a check on one read and return an object on the next.
    let reads = 0
    const frame = Object.defineProperty(
      { filename: 'app-4f2a.js', in_app: true },
      'lineno',
      { enumerable: true, get: () => (++reads === 1 ? 12 : leaky) }
    )
    const framed = mobileAnalyticsPrivacyFilter<Event>({
      event: '$exception',
      properties: {
        $exception_list: [{ type: 'UploadError', stacktrace: { frames: [frame] } }],
      },
    })
    expectNoLeak(framed)
    expect(reads).toBe(1)

    expect(
      webAnalyticsPrivacyFilter<Event>({
        event: 'modal_opened',
        uuid: '0190f5c2-3d1e-7a4b-9c8d-1e2f3a4b5c6d',
        timestamp: new Date('2026-11-11T22:00:00.000Z'),
      } as unknown as Event)
    ).toEqual({
      event: 'modal_opened',
      properties: {},
      uuid: '0190f5c2-3d1e-7a4b-9c8d-1e2f3a4b5c6d',
      timestamp: new Date('2026-11-11T22:00:00.000Z'),
    })
  })

  it('drops the event instead of throwing when reading it fails', () => {
    const properties = Object.defineProperty({}, 'locale', {
      enumerable: true,
      get() {
        throw new Error('teen@example.test')
      },
    })
    expect(() =>
      webAnalyticsPrivacyFilter({ event: 'modal_opened', properties })
    ).not.toThrow()
    expect(webAnalyticsPrivacyFilter({ event: 'modal_opened', properties })).toBeNull()
    expect(webAnalyticsPrivacyFilter({ event: 'modal_opened' })).toEqual({
      event: 'modal_opened',
      properties: {},
    })
  })
})

describe('analytics privacy filter: value rules', () => {
  it('keeps valid values and drops invalid ones for every rule type', () => {
    const properties = Object.assign(Object.create(null) as Record<string, unknown>, {
      interactionType: 'ribbon_toggle',
      isExpanded: 'yes',
      scenario: 'morning',
    })
    expect(
      mobileAnalyticsPrivacyFilter<Event>({ event: 'hero_interaction', properties })
        ?.properties
    ).toEqual({ interactionType: 'ribbon_toggle', scenario: 'morning' })
    expect(
      webAnalyticsPrivacyFilter<Event>({
        event: 'lookbook_prism_viewed',
        properties: { viewportWidth: 1440, layoutMode: 'mobile' },
      })?.properties
    ).toEqual({ viewportWidth: 1440, layoutMode: 'mobile' })
    expect(
      webAnalyticsPrivacyFilter<Event>({
        event: 'share_card_shared',
        properties: { duration_ms: Number.NaN, client: 'web' },
      })?.properties
    ).toEqual({ client: 'web' })
    expect(
      mobileAnalyticsPrivacyFilter<Event>({
        event: 'deep_link_invalid',
        properties: { param_keys: 'source', reason: 'Deep link expired' },
      })?.properties
    ).toEqual({ reason: 'Deep link expired' })
    expect(
      mobileAnalyticsPrivacyFilter<Event>({
        event: 'external_link_tapped',
        properties: { url: 42 },
      })?.properties
    ).toEqual({})
  })

  it('sends a bare exception entry as type, placeholder and an empty stack', () => {
    expect(
      mobileAnalyticsPrivacyFilter<Event>({
        event: '$exception',
        properties: {
          $exception_list: [
            {
              type: 'TypeError',
              stacktrace: {
                frames: [{ filename: 42, in_app: true, lineno: 'x', platform: 'alice' }],
              },
            },
          ],
        },
      })?.properties
    ).toEqual({
      $exception_list: [
        {
          type: 'TypeError',
          value: EXCEPTION_MESSAGE_PLACEHOLDER,
          mechanism: { type: 'generic', handled: false, synthetic: false },
          stacktrace: { type: 'raw', frames: [{ filename: '<unknown>', in_app: true }] },
        },
      ],
    })
  })
})

describe('analytics privacy filter: URLs, paths and screens', () => {
  it('sends known routes as templates and everything else as /:unknown', () => {
    const sent = webAnalyticsPrivacyFilter<Event>({
      event: '$pageview',
      properties: {
        $current_url: `https://CoutureCast.app/guardian/accept?token=${invitationToken}&email=teen%40example.test#frag`,
        $pathname: '/moderation/cases/case-123',
        $prev_pageview_pathname: '/profile/alice-smith/reset/guardian-secret',
        $referrer: `https://mail.example/inbox/alice-smith?token=${invitationToken}`,
        $referring_domain: 'mail.example',
        $host: 'couturecast.app',
      },
    })
    expect(sent?.properties).toEqual({
      $current_url: 'https://couturecast.app/guardian/accept',
      $pathname: '/moderation/cases/:param',
      $prev_pageview_pathname: '/:unknown',
      $referrer: 'https://mail.example',
      $referring_domain: 'mail.example',
      $host: 'couturecast.app',
    })
    expectNoLeak(sent)
  })

  it('covers mobile screens, previous screens and lifecycle links', () => {
    const screen = mobileAnalyticsPrivacyFilter<Event>({
      event: '$screen',
      properties: {
        $screen_name: '/community',
        previous_screen: '/profile/alice-smith',
        $device_name: "Alice's iPhone",
        $app_version: '1.4.0',
      },
    })
    expect(screen?.properties).toEqual({
      $screen_name: '/community',
      previous_screen: '/:unknown',
      $app_version: '1.4.0',
    })
    expect(
      mobileAnalyticsPrivacyFilter<Event>({
        event: '$screen',
        properties: { $screen_name: '/', previous_screen: null },
      })?.properties
    ).toEqual({ $screen_name: '/', previous_screen: null })
    const opened = mobileAnalyticsPrivacyFilter<Event>({
      event: 'Application Opened',
      properties: {
        url: `couturecast://guardian-accept?token=${invitationToken}#frag`,
        from_background: false,
      },
    })
    expect(opened?.properties).toEqual({
      url: 'couturecast://guardian-accept',
      from_background: false,
    })
  })

  it('treats bare tokens and non-URLs as unknown and keeps only origins of external links', () => {
    expect(analyticsRouteUrl(invitationToken, 'web')).toBe('/:unknown')
    expect(analyticsRouteUrl('community-notification', 'mobile')).toBe('/:unknown')
    expect(analyticsRouteUrl('https://u:p@couturecast.app/', 'web')).toBe(
      'https://couturecast.app/'
    )
    expect(analyticsRouteUrl('https://bad host/wardrobe', 'web')).toBe(
      'https:///wardrobe'
    )
    expect(analyticsRouteUrl('exp://192.168.1.5:8081/--/post/1', 'mobile')).toBe(
      'exp://:unknown'
    )
    expect(analyticsOriginUrl('https://weather.example/alerts/alice?zip=60601')).toBe(
      'https://weather.example'
    )
    expect(analyticsOriginUrl('couturecast://guardian-accept?token=x')).toBe(
      'couturecast://'
    )
    expect(analyticsOriginUrl('/relative')).toBeUndefined()
    expect(analyticsOriginUrl('https://bad host/')).toBeUndefined()
    expect(
      mobileAnalyticsPrivacyFilter<Event>({
        event: 'external_link_tapped',
        properties: { url: 'https://weather.example/alerts/alice-smith?zip=60601' },
      })?.properties
    ).toEqual({ url: 'https://weather.example' })
    expect(
      webAnalyticsPrivacyFilter<Event>({
        event: '$pageview',
        properties: { $referrer: invitationToken, $current_url: 42 },
      })?.properties
    ).toEqual({})
  })
})

describe('analytics privacy filter: exceptions', () => {
  it('sends the type and in-app frames as basename, line and column only', () => {
    const message = `Invalid token=guardian-secret for Alice Smith, DOB 2011-04-01, email teen%40example.test ${invitationToken}`
    const sent = webAnalyticsPrivacyFilter<Event>({
      event: '$exception',
      properties: {
        $exception_level: 'error',
        $exception_message: message,
        $exception_types: ['UploadError'],
        $exception_values: [message],
        $exception_list: [
          {
            type: 'UploadError',
            value: message,
            module: 'alice',
            mechanism: { type: 'onunhandledrejection', handled: false, extra: message },
            stacktrace: {
              type: 'resolved',
              frames: [
                {
                  platform: 'web:javascript',
                  filename:
                    'https://couturecast.app/_next/static/chunks/app-4f2a.js?dpl=x#L1',
                  abs_path:
                    'https://couturecast.app/_next/static/chunks/app-4f2a.js?dpl=x',
                  function: 'uploadAliceSmithPhoto',
                  lineno: 12,
                  colno: 4,
                  in_app: true,
                  context_line: message,
                },
                {
                  platform: 'web:javascript',
                  filename: `https://cdn.test/private/${personalUuid}/teen%40example.test.jpg?token=hidden`,
                  lineno: 3,
                  in_app: true,
                },
                {
                  filename: 'https://third-party.example/sdk.js',
                  lineno: 1,
                  colno: 1,
                  in_app: false,
                },
              ],
            },
          },
          { type: 'not a type', mechanism: { type: 'alice' } },
          'not an entry',
        ],
      },
    })
    expect(sent?.properties).toEqual({
      $exception_level: 'error',
      $exception_list: [
        {
          type: 'UploadError',
          value: EXCEPTION_MESSAGE_PLACEHOLDER,
          mechanism: { type: 'onunhandledrejection', handled: false, synthetic: false },
          stacktrace: {
            type: 'raw',
            frames: [
              {
                platform: 'web:javascript',
                filename: 'app-4f2a.js',
                lineno: 12,
                colno: 4,
                in_app: true,
              },
              {
                platform: 'web:javascript',
                filename: '<unknown>',
                lineno: 3,
                in_app: true,
              },
            ],
          },
        },
        {
          type: 'Error',
          value: EXCEPTION_MESSAGE_PLACEHOLDER,
          mechanism: { type: 'generic', handled: false, synthetic: false },
          stacktrace: { type: 'raw', frames: [] },
        },
      ],
    })
    expectNoLeak(sent)
    expect(
      webAnalyticsPrivacyFilter<Event>({
        event: '$exception',
        properties: { $exception_list: 'Alice', $exception_level: 'alice' },
      })?.properties
    ).toEqual({})
  })
})
