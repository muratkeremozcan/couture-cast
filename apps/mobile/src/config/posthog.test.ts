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

import { isPostHogEnabled, posthog, posthogProviderClient } from './posthog'

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
