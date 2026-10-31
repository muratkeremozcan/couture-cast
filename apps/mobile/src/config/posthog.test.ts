// Learning path Step 8: Shared analytics contracts and event tracking.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-8-shared-analytics-contracts-and-event-tracking
import { describe, expect, it, vi } from 'vitest'

/**
 * This module decides its configuration once, at import time, and Vitest browser
 * mode has no working module-registry reset. So this spec pins the state a build
 * without analytics credentials lands in: the exact case where analytics must
 * degrade to a disabled client instead of breaking the app.
 */
const bootstrap = vi.hoisted(() => {
  const warnings: unknown[][] = []
  const constructions: { apiKey: string; options: Record<string, unknown> }[] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args)
  }
  return {
    warnings,
    constructions,
    restoreConsole: () => {
      console.warn = originalWarn
    },
  }
})

vi.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: null },
}))

vi.mock('posthog-react-native', () => {
  class FakePostHog {
    constructor(apiKey: string, options: Record<string, unknown>) {
      bootstrap.constructions.push({ apiKey, options })
    }
  }
  return { __esModule: true, default: FakePostHog }
})

import {
  isPostHogEnabled,
  mobilePostHogBeforeSend,
  posthog,
  posthogProviderClient,
} from './posthog'
import { SHARE_CARD_SHARED_ALLOWED_PROPERTIES } from '@couture/api-client'

bootstrap.restoreConsole()

describe('mobile PostHog provider configuration', () => {
  it('reports analytics as disabled when no API key is configured', () => {
    expect(isPostHogEnabled).toBe(false)
  })

  /**
   * The core ritual must not depend on analytics being configured, so an
   * unconfigured build still gets a real client object that simply does nothing.
   */
  it('still constructs a usable client with the provider switched off', () => {
    expect(posthogProviderClient).toBeDefined()
    expect(bootstrap.constructions).toHaveLength(1)
    expect(bootstrap.constructions[0]?.apiKey).toBe('placeholder_key')
    expect(bootstrap.constructions[0]?.options).toMatchObject({ disabled: true })
  })

  it('defaults to the PostHog US cloud host', () => {
    expect(bootstrap.constructions[0]?.options).toMatchObject({
      host: 'https://us.i.posthog.com',
    })
  })

  /** Silent analytics is a support trap; the operator has to be told. */
  it('warns that analytics is disabled and names the env var to set', () => {
    const message = bootstrap.warnings.flat().join(' ')
    expect(message).toContain('PostHog API key not configured')
    expect(message).toContain('POSTHOG_API_KEY')
  })

  /**
   * Batching and retry settings are the reason a degraded network does not turn
   * into dropped events or a drained battery, so they are part of the contract.
   */
  it('queues and retries events instead of sending one request per event', () => {
    expect(bootstrap.constructions[0]?.options).toMatchObject({
      flushAt: 20,
      flushInterval: 10000,
      maxBatchSize: 100,
      maxQueueSize: 1000,
      fetchRetryCount: 3,
      requestTimeout: 10000,
      captureAppLifecycleEvents: true,
      preloadFeatureFlags: true,
    })
  })

  /** The legacy alias must stay the same instance while the facade rolls out. */
  it('exposes the legacy alias as the same client instance', () => {
    expect(posthog).toBe(posthogProviderClient)
  })
})

type HookEvent = NonNullable<Parameters<typeof mobilePostHogBeforeSend>[0]>
const timestamp = new Date('2026-10-30T12:00:00.000Z')
function shareEvent(properties: Record<string, unknown>): HookEvent {
  return {
    uuid: '0192f0c4-0000-7000-8000-000000000001',
    event: 'share_card_shared',
    timestamp,
    properties: properties as HookEvent['properties'],
    $set: { email: 'member@example.com' } as HookEvent['$set'],
    $set_once: { first_seen_url: 'https://couturecast.app/p/1' } as HookEvent['$set'],
  }
}
const enriched = {
  client: 'ios',
  target: 'instagram',
  outcome: 'completed',
  duration_ms: 1840,
  locale: 'en-US',
  token: 'phc_project',
  distinct_id: 'anon-1',
  $lib: 'posthog-react-native',
  $lib_version: '4.36.1',
  $os: 'iOS',
  $device_type: 'Mobile',
  $screen_name: 'community/post-123',
  $current_url: 'https://couturecast.app/share/post-123?token=secret',
  $app_build: '42',
  $session_id: 'session-1',
  registered_super_property: 'plan-premium',
  $set: { email: 'member@example.com' },
  $set_once: { first_seen: 'yesterday' },
  caption: 'Tall boots for a wet morning',
  sha256: 'a'.repeat(64),
}

describe('U-SHARE-SANITIZER-MOBILE: before_send for share_card_shared', () => {
  it('installs the exported hook as the SDK before_send option', () => {
    expect(bootstrap.constructions[0]?.options.before_send).toBe(mobilePostHogBeforeSend)
  })

  it('keeps the envelope, allowlists properties and removes every $set', () => {
    const result = mobilePostHogBeforeSend(shareEvent(enriched))
    expect(result).toEqual({
      uuid: '0192f0c4-0000-7000-8000-000000000001',
      event: 'share_card_shared',
      timestamp,
      properties: {
        client: 'ios',
        target: 'instagram',
        outcome: 'completed',
        duration_ms: 1840,
        locale: 'en-US',
        token: 'phc_project',
        distinct_id: 'anon-1',
        $lib: 'posthog-react-native',
        $lib_version: '4.36.1',
        $os: 'iOS',
        $device_type: 'Mobile',
        $geoip_disable: true,
        $ip: null,
        $process_person_profile: false,
      },
    })
    expect(result).not.toHaveProperty('$set')
    expect(result).not.toHaveProperty('$set_once')
    expect(
      Object.keys(result?.properties ?? {}).every((key) =>
        (SHARE_CARD_SHARED_ALLOWED_PROPERTIES as readonly string[]).includes(key)
      )
    ).toBe(true)
  })

  it.each([
    ['an invalid outcome pair', { ...enriched, client: 'android' }],
    ['a missing business key', { ...enriched, duration_ms: undefined }],
    ['a raw package target', { ...enriched, target: 'com.instagram.android' }],
  ])('drops the event on %s and logs a closed code', (_name, properties) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(mobilePostHogBeforeSend(shareEvent(properties))).toBeNull()
    expect(warn.mock.calls).toEqual([['[cc69-analytics] share_event_dropped']])
  })

  it('returns null instead of throwing when reading the event fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const hostile = {
      event: 'share_card_shared',
      get properties(): never {
        throw new Error(`file:///cache/share-cards/cc69-share-1.png ${'b'.repeat(64)}`)
      },
    } as unknown as HookEvent
    expect(() => mobilePostHogBeforeSend(hostile)).not.toThrow()
    expect(mobilePostHogBeforeSend(hostile)).toBeNull()
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/file:|[a-f0-9]{64}/)
  })

  it('passes every other event through unchanged, by reference', () => {
    const other: HookEvent = {
      event: 'ritual_created',
      properties: { $current_url: 'https://couturecast.app', locale: 'en-US' },
      $set: { plan: 'premium' },
    }
    expect(mobilePostHogBeforeSend(other)).toBe(other)
    expect(mobilePostHogBeforeSend(null)).toBeNull()
  })
})
