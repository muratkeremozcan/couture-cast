import { describe, expect, it } from 'vitest'
import {
  SHARE_CARD_SHARED_ALLOWED_PROPERTIES,
  SHARE_CARD_SHARED_EVENT,
  analyticsEventNameSchema,
  analyticsEventSchemas,
  sanitizeShareCardSharedProperties,
  shareCardShareClientSchema,
  shareCardShareOutcomeSchema,
  shareCardShareTargetSchema,
  shareCardSharedEventSchema,
  trackShareCardShared,
  type ShareCardShareClient,
  type ShareCardShareOutcome,
  type ShareCardShareTarget,
} from '../src'
import { analyticsPropertySchemas } from '../src/testing/analytics-event-assertions'

const apps = ['pinterest', 'instagram', 'facebook', 'tiktok'] as const
// The spec's result model, written out by hand so a drift in the shipped tables fails
// here instead of moving both sides at once.
const validTargets: Record<ShareCardShareOutcome, readonly ShareCardShareTarget[]> = {
  completed: [...apps, 'other', 'unknown'],
  target_chosen: [...apps, 'other'],
  handed_off: ['unknown'],
  cancelled: [...apps, 'other', 'none'],
  dismissed: ['none'],
  not_confirmed: ['none'],
  failed: ['none'],
  unavailable: ['none'],
}
const observingClients: Record<ShareCardShareOutcome, readonly ShareCardShareClient[]> = {
  completed: ['ios'],
  target_chosen: ['android'],
  handed_off: ['web'],
  cancelled: ['ios'],
  dismissed: ['web'],
  not_confirmed: ['android'],
  failed: ['ios', 'android', 'web'],
  unavailable: ['ios', 'android', 'web'],
}
const outcomes = shareCardShareOutcomeSchema.options
const targets = shareCardShareTargetSchema.options
const clients = shareCardShareClientSchema.options
const valid = {
  client: 'ios',
  target: 'instagram',
  outcome: 'completed',
  duration_ms: 1200,
}

describe('share_card_shared registry', () => {
  it('registers the event name, its schema and its assertion schema', () => {
    expect(SHARE_CARD_SHARED_EVENT).toBe('share_card_shared')
    expect(analyticsEventNameSchema.safeParse(SHARE_CARD_SHARED_EVENT).success).toBe(true)
    expect(analyticsEventSchemas.share_card_shared).toBe(shareCardSharedEventSchema)
    expect(analyticsPropertySchemas.share_card_shared.safeParse(valid).success).toBe(true)
  })
  it('names exactly the eight outcomes, seven targets and three clients', () => {
    expect([...outcomes].sort()).toEqual(Object.keys(validTargets).sort())
    expect([...targets].sort()).toEqual([...apps, 'other', 'none', 'unknown'].sort())
    expect([...clients].sort()).toEqual(['android', 'ios', 'web'])
  })
})

describe('U-SHARE-EVT-SCHEMA: every valid row of the result model parses', () => {
  const rows = outcomes.flatMap((outcome) =>
    validTargets[outcome].flatMap((target) =>
      observingClients[outcome].map((client) => ({ client, target, outcome }))
    )
  )
  it('covers the whole table', () => {
    // completed 6, target_chosen 5, handed_off 1, cancelled 6, dismissed 1,
    // not_confirmed 1, failed 3 clients, unavailable 3 clients.
    expect(rows).toHaveLength(26)
  })
  it.each(rows)('$client $outcome/$target', (row) => {
    const event = { ...row, duration_ms: 0 }
    expect(shareCardSharedEventSchema.safeParse(event).success).toBe(true)
    const properties = trackShareCardShared(event)
    expect(properties).toEqual(event)
    expect(Object.keys(properties).sort()).toEqual([
      'client',
      'duration_ms',
      'outcome',
      'target',
    ])
  })
  it('accepts the duration bounds', () => {
    for (const duration_ms of [0, 1, 86_400_000])
      expect(
        shareCardSharedEventSchema.safeParse({ ...valid, duration_ms }).success
      ).toBe(true)
  })
  it('trackShareCardShared returns a fresh object and throws on invalid input', () => {
    const event = { ...valid } as const
    expect(trackShareCardShared(event as never)).not.toBe(event)
    expect(() =>
      trackShareCardShared({ ...valid, outcome: 'target_chosen' } as never)
    ).toThrow()
  })
})

describe('U-SHARE-EVT-PAIRS: the 8 x 7 cross product and the client binding', () => {
  const pairs = outcomes.flatMap((outcome) =>
    targets.map((target) => ({
      outcome,
      target,
      allowed: validTargets[outcome].includes(target),
    }))
  )
  it('enumerates all 56 pairs, 34 of them invalid', () => {
    expect(pairs).toHaveLength(56)
    expect(pairs.filter(({ allowed }) => !allowed)).toHaveLength(34)
  })
  it.each(pairs)('$outcome/$target allowed=$allowed', ({ outcome, target, allowed }) => {
    // Use an observing client so only the target decides.
    const client = observingClients[outcome][0]!
    const result = shareCardSharedEventSchema.safeParse({
      client,
      target,
      outcome,
      duration_ms: 10,
    })
    expect(result.success).toBe(allowed)
    if (!allowed && !result.success)
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(['target'])
  })
  const bindings = outcomes.flatMap((outcome) =>
    clients.map((client) => ({
      outcome,
      client,
      allowed: observingClients[outcome].includes(client),
    }))
  )
  it.each(bindings)(
    '$client may report $outcome: $allowed',
    ({ outcome, client, allowed }) => {
      const target = validTargets[outcome][0]!
      const result = shareCardSharedEventSchema.safeParse({
        client,
        target,
        outcome,
        duration_ms: 10,
      })
      expect(result.success).toBe(allowed)
      if (!allowed && !result.success)
        expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual([
          'client',
        ])
    }
  )
  it.each([
    ['android', 'completed', 'instagram'],
    ['web', 'completed', 'unknown'],
    ['android', 'target_chosen', 'none'],
    ['android', 'target_chosen', 'unknown'],
    ['android', 'not_confirmed', 'pinterest'],
    ['web', 'handed_off', 'other'],
    ['ios', 'cancelled', 'unknown'],
    ['web', 'dismissed', 'instagram'],
    ['android', 'not_confirmed', 'other'],
    ['ios', 'failed', 'unknown'],
    ['ios', 'completed', 'none'],
  ])('named truthfulness negative: %s %s/%s', (client, outcome, target) => {
    expect(
      shareCardSharedEventSchema.safeParse({ client, outcome, target, duration_ms: 1 })
        .success
    ).toBe(false)
  })
})

describe('U-SHARE-EVT-FORBIDDEN: privacy-sensitive inputs are refused', () => {
  it.each([
    'pngBase64',
    'bytes',
    'sha256',
    'digest',
    'expectedSha256',
    'caption',
    'postId',
    'recommendationId',
    'sourceId',
    'source',
    'url',
    'uri',
    'fileUri',
    'filename',
    'assetId',
    'localIdentifier',
    'location',
    'latitude',
    'longitude',
    'city',
    'activityType',
    'packageName',
    'component',
    'errorMessage',
  ])('rejects the extra key %s', (key) => {
    expect(shareCardSharedEventSchema.safeParse({ ...valid, [key]: 'x' }).success).toBe(
      false
    )
    expect(() => trackShareCardShared({ ...valid, [key]: 'x' } as never)).toThrow()
  })
  it.each([
    'com.instagram.android',
    'com.burbn.instagram.shareextension',
    'com.apple.UIKit.activity.Message',
  ])('rejects the raw target value %s', (target) => {
    expect(shareCardSharedEventSchema.safeParse({ ...valid, target }).success).toBe(false)
  })
  it.each([-1, 1.5, 86_400_001, Number.NaN, Number.POSITIVE_INFINITY, '10'])(
    'rejects duration_ms %s',
    (duration_ms) => {
      expect(
        shareCardSharedEventSchema.safeParse({ ...valid, duration_ms }).success
      ).toBe(false)
    }
  )
  it.each(['client', 'target', 'outcome', 'duration_ms'])('requires %s', (key) => {
    const event: Record<string, unknown> = { ...valid }
    delete event[key]
    expect(shareCardSharedEventSchema.safeParse(event).success).toBe(false)
  })
})

describe('sanitizeShareCardSharedProperties: the SDK-boundary allowlist', () => {
  const sdk = {
    token: 'phc_public',
    distinct_id: 'anon-1',
    $lib: 'posthog-react-native',
    $lib_version: '4.0.0',
    $os: 'iOS',
    $device_type: 'Mobile',
    locale: 'fr-CA',
  }
  it('lists exactly the allowed keys', () => {
    expect([...SHARE_CARD_SHARED_ALLOWED_PROPERTIES].sort()).toEqual(
      [
        'client',
        'target',
        'outcome',
        'duration_ms',
        'locale',
        '$geoip_disable',
        'token',
        'distinct_id',
        '$lib',
        '$lib_version',
        '$os',
        '$device_type',
      ].sort()
    )
    expect(Object.isFrozen(SHARE_CARD_SHARED_ALLOWED_PROPERTIES)).toBe(true)
  })
  it('keeps allowlisted primitives, drops everything else and disables GeoIP', () => {
    const input = {
      ...valid,
      ...sdk,
      $geoip_disable: false,
      $current_url: 'https://couturecast.app/share?postId=private',
      $pathname: '/community/private-post',
      $host: 'couturecast.app',
      $referrer: 'https://private.invalid',
      $screen_name: 'ShareCardComposer',
      $screen_height: 900,
      plan_tier: 'super-property',
      $set: { email: 'private@example.invalid' },
      $set_once: { first_seen: 'x' },
      nested: { $set: { email: 'private@example.invalid' } },
    }
    const sanitized = sanitizeShareCardSharedProperties(input)
    expect(sanitized).toEqual({ ...valid, ...sdk, $geoip_disable: true })
    expect(sanitized).not.toBe(input)
    expect(input.$geoip_disable).toBe(false)
  })
  it('drops allowlisted keys whose values are not primitives', () => {
    expect(
      sanitizeShareCardSharedProperties({
        ...valid,
        locale: { value: 'fr-CA' },
        $os: null,
        $lib_version: Number.NaN,
        token: ['phc'],
      })
    ).toEqual({ ...valid, $geoip_disable: true })
  })
  it.each([
    ['null', null],
    ['an array', [valid]],
    ['a string', 'share_card_shared'],
    ['undefined', undefined],
    ['an invalid pair', { ...valid, target: 'none' }],
    ['a client binding breach', { ...valid, client: 'android' }],
    ['a raw target', { ...valid, target: 'com.instagram.android' }],
    [
      'a missing business key',
      { client: 'ios', target: 'instagram', outcome: 'completed' },
    ],
    ['a nested business value', { ...valid, outcome: { value: 'completed' } }],
  ])('returns null for %s', (_name, input) => {
    expect(sanitizeShareCardSharedProperties(input)).toBeNull()
  })
  it('never throws: a hostile object returns null', () => {
    const hostile = new Proxy(
      { ...valid },
      {
        ownKeys: () => {
          throw new Error('boom')
        },
      }
    )
    expect(sanitizeShareCardSharedProperties(hostile)).toBeNull()
    const getter = Object.defineProperty({ ...valid }, 'locale', {
      enumerable: true,
      get: () => {
        throw new Error('boom')
      },
    })
    expect(sanitizeShareCardSharedProperties(getter)).toBeNull()
  })
})
