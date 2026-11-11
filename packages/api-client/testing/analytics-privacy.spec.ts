import { describe, expect, it } from 'vitest'
import {
  PERSONAL_ANALYTICS_PROPERTY_KEYS,
  sanitizeAnalyticsUrl,
  scrubAnalyticsText,
  stripPersonalAnalyticsData,
} from '../src'

type Event = {
  event: string
  timestamp?: Date
  properties?: Record<string, unknown>
  $set?: Record<string, unknown>
  $set_once?: Record<string, unknown>
}

// A guardian invitation token as the API issues it: a JWT whose payload names the teen
// and the guardian's email.
const invitationToken =
  'eyJhbGciOiJIUzI1NiJ9.eyJ0ZWVuSWQiOiJ0ZWVuLTEiLCJndWFyZGlhbkVtYWlsIjoiZ0BleC50ZXN0In0.c2lnbmF0dXJl'
const invitationUrl = `https://couturecast.app/guardian/accept?token=${invitationToken}#consent`

describe('stripPersonalAnalyticsData: personal keys', () => {
  it('names email, name and birthdate keys in the frozen denylist', () => {
    expect(PERSONAL_ANALYTICS_PROPERTY_KEYS).toEqual(
      expect.arrayContaining(['email', 'name', 'birthdate', 'date_of_birth'])
    )
    expect(Object.isFrozen(PERSONAL_ANALYTICS_PROPERTY_KEYS)).toBe(true)
  })

  it('removes personal keys at every depth, in objects and arrays', () => {
    const event: Event = {
      event: '$pageview',
      properties: {
        locale: 'en-US',
        email: 'member@example.test',
        $name: 'Teen Member',
        firstName: 'Teen',
        'Date-Of-Birth': '2011-04-01',
        member: { display_name: 'Teen Member', plan: 'premium' },
        members: [{ username: 'teen', role: 'teen' }],
        $set: { email: 'member@example.test', plan: 'premium' },
        $set_once: { birthdate: '2011-04-01', first_seen: 'today' },
      },
      $set: { display_name: 'Teen Member', plan: 'premium' },
      $set_once: { BIRTHDAY: '04-01', first_seen: 'today' },
    }
    expect(stripPersonalAnalyticsData(event)).toEqual({
      event: '$pageview',
      properties: {
        locale: 'en-US',
        member: { plan: 'premium' },
        members: [{ role: 'teen' }],
        $set: { plan: 'premium' },
        $set_once: { first_seen: 'today' },
      },
      $set: { plan: 'premium' },
      $set_once: { first_seen: 'today' },
    })
    // The caller's event is left as it was.
    expect(event.properties).toHaveProperty('email', 'member@example.test')
  })
})

describe('stripPersonalAnalyticsData: URLs keep only origin and route template', () => {
  it('reduces every URL-bearing property, initial and session props included', () => {
    const sent = stripPersonalAnalyticsData({
      event: '$pageview',
      properties: {
        $current_url: invitationUrl,
        $pathname: '/moderation/cases/case-123',
        $referrer: 'https://mail.example/inbox/msg-42?to=g@ex.test',
        $referring_domain: 'mail.example',
        $session_entry_url: 'https://couturecast.app/community/posts/0192f0c4?ref=x',
        $prev_pageview_pathname: '/teen/dashboard',
        rawUrl: 'https://couturecast.app/?cardId=card-9&email=teen%40example.test',
        url: 'couturecast://guardian-accept?token=secret#frag',
        deep_link: '{"cardId":"card-9","email":"teen@example.test"}',
        $screen_name: '/community/post-123',
        $host: 'couturecast.app',
        distinct_id: '0192f0c4-0000-7000-8000-000000000001',
        token: 'phc_project',
      },
      $set_once: {
        $initial_current_url: invitationUrl,
        $initial_person_info: { r: '$direct', u: invitationUrl },
      },
    })
    expect(sent).toEqual({
      event: '$pageview',
      properties: {
        $current_url: 'https://couturecast.app/guardian/accept',
        $pathname: '/moderation/cases/:id',
        $referrer: 'https://mail.example/inbox/:id',
        $referring_domain: 'mail.example',
        $session_entry_url: 'https://couturecast.app/community/posts/:id',
        $prev_pageview_pathname: '/teen/dashboard',
        rawUrl: 'https://couturecast.app/',
        url: 'couturecast://guardian-accept',
        deep_link: '[redacted]',
        $screen_name: '/community/:id',
        $host: 'couturecast.app',
        distinct_id: '0192f0c4-0000-7000-8000-000000000001',
        token: 'phc_project',
      },
      $set_once: {
        $initial_current_url: 'https://couturecast.app/guardian/accept',
        $initial_person_info: {
          r: '$direct',
          u: 'https://couturecast.app/guardian/accept',
        },
      },
    })
  })

  it('templates ids, drops user info, query and fragment, and keeps route words', () => {
    expect(sanitizeAnalyticsUrl('https://user:pass@CoutureCast.app/a/b2/c?x#y')).toBe(
      'https://couturecast.app/a/:id/c'
    )
    expect(sanitizeAnalyticsUrl('couturecast://post-1/comments')).toBe(
      'couturecast://:id/comments'
    )
    expect(sanitizeAnalyticsUrl('/(tabs)/wardrobe/teen@example.test')).toBe(
      '/(tabs)/wardrobe/:id'
    )
    expect(sanitizeAnalyticsUrl('community-notification')).toBe('community-notification')
    expect(sanitizeAnalyticsUrl('')).toBe('')
    expect(sanitizeAnalyticsUrl('card-9')).toBe('[redacted]')
  })

  it('reduces absolute URLs and redacts emails in any other string', () => {
    const sent = stripPersonalAnalyticsData({
      event: 'external_link_tapped',
      properties: {
        target: 'https://weather.example/alerts/123?zip=60601',
        note: `opened ${invitationUrl} for teen@example.test`,
        tags: ['https://cdn.example/p/photo.jpg?sig=abc', 'plain'],
      },
    })
    expect(sent?.properties).toEqual({
      target: 'https://weather.example/alerts/:id',
      note: 'opened https://couturecast.app/guardian/accept for [email]',
      tags: ['https://cdn.example/p/:id', 'plain'],
    })
  })
})

describe('stripPersonalAnalyticsData: exception payloads', () => {
  it('keeps types and code locations and scrubs messages and frame URLs', () => {
    const message =
      'Photo upload failed for teen@example.test: https://cdn.test/private-photo.jpg?token=photo-secret ' +
      `id 0192f0c4-0000-7000-8000-000000000001 sig deadbeefdeadbeefdeadbeef jwt ${invitationToken} ` +
      'key AbC123dEf456GhI789jKl012 phone 3125550100'
    const sent = stripPersonalAnalyticsData({
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
            mechanism: { type: 'onunhandledrejection', handled: false },
            stacktrace: {
              type: 'raw',
              frames: [
                {
                  platform: 'web:javascript',
                  filename:
                    'https://couturecast.app/_next/static/chunks/app-4f2a.js?dpl=x#L1',
                  abs_path: 'file:///var/mobile/photo.jpg?token=photo-secret',
                  function: 'uploadGarmentPhoto',
                  lineno: 12,
                  colno: 4,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    })
    const scrubbed =
      'Photo upload failed for [email]: https://cdn.test/:id id [id] sig [token] jwt [token] key [token] phone [number]'
    expect(sent?.properties).toEqual({
      $exception_level: 'error',
      $exception_message: scrubbed,
      $exception_types: ['UploadError'],
      $exception_values: [scrubbed],
      $exception_list: [
        {
          type: 'UploadError',
          value: scrubbed,
          mechanism: { type: 'onunhandledrejection', handled: false },
          stacktrace: {
            type: 'raw',
            frames: [
              {
                platform: 'web:javascript',
                filename: 'https://couturecast.app/_next/static/chunks/app-4f2a.js',
                abs_path: 'file:///var/mobile/photo.jpg',
                function: 'uploadGarmentPhoto',
                lineno: 12,
                colno: 4,
                in_app: true,
              },
            ],
          },
        },
      ],
    })
    expect(scrubAnalyticsText('TypeError: x is undefined')).toBe(
      'TypeError: x is undefined'
    )
  })
})

describe('stripPersonalAnalyticsData: envelope and failure', () => {
  it('keeps the envelope, drops cycles and passes null through', () => {
    const timestamp = new Date('2026-11-11T12:00:00.000Z')
    const properties: Record<string, unknown> = { locale: 'en-US', when: timestamp }
    properties.self = properties
    properties.list = [properties, 'kept']
    const sent = stripPersonalAnalyticsData({ event: 'cyclic', timestamp, properties })
    expect(sent).toEqual({
      event: 'cyclic',
      timestamp,
      properties: { locale: 'en-US', when: timestamp, list: ['kept'] },
    })
    expect(sent?.timestamp).toBe(timestamp)
    expect(stripPersonalAnalyticsData({ event: 'no_properties' })).toEqual({
      event: 'no_properties',
    })
    expect(stripPersonalAnalyticsData(null)).toBeNull()
  })

  it('leaves non-object data fields alone', () => {
    const event = { event: 'odd', properties: 'not-an-object', $set: ['email'] }
    expect(stripPersonalAnalyticsData(event)).toEqual(event)
  })

  it('drops the event instead of throwing when reading it fails', () => {
    const properties = Object.defineProperty({}, 'email_hint', {
      enumerable: true,
      get() {
        throw new Error('member@example.test')
      },
    })
    const hostile = { event: 'x', properties }
    expect(() => stripPersonalAnalyticsData(hostile)).not.toThrow()
    expect(stripPersonalAnalyticsData(hostile)).toBeNull()
  })
})
