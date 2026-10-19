// Learning path Step 8: Shared analytics contracts and event tracking.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-8-shared-analytics-contracts-and-event-tracking
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getFeatureFlag = vi.fn()
const shutdown = vi.fn()
const capture = vi.fn()

vi.mock('posthog-node', () => ({
  PostHog: class PostHogMock {
    capture = capture
    getFeatureFlag = getFeatureFlag
    shutdown = shutdown
  },
}))

describe('PostHogService', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.POSTHOG_API_KEY = 'phc_test'
    process.env.POSTHOG_HOST = 'https://us.i.posthog.com'
    getFeatureFlag.mockReset()
    shutdown.mockReset()
    capture.mockReset()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns boolean feature flag values from the SDK', async () => {
    const { PostHogService } = await import('#posthog/posthog.service')
    getFeatureFlag.mockResolvedValue(true)

    const service = new PostHogService()

    await expect(
      service.getFeatureFlagValue('premium_themes_enabled', 'user-1')
    ).resolves.toBe(true)
    expect(getFeatureFlag).toHaveBeenCalledWith('premium_themes_enabled', 'user-1', {
      sendFeatureFlagEvents: false,
    })
  })

  it('returns non-boolean feature flag values unchanged for downstream coercion', async () => {
    const { PostHogService } = await import('#posthog/posthog.service')
    getFeatureFlag.mockResolvedValue('variant-a')

    const service = new PostHogService()

    await expect(
      service.getFeatureFlagValue('premium_themes_enabled', 'user-2')
    ).resolves.toBe('variant-a')
  })

  it('returns undefined when the SDK is not configured', async () => {
    const { PostHogService } = await import('#posthog/posthog.service')
    delete process.env.POSTHOG_API_KEY

    const service = new PostHogService()

    await expect(
      service.getFeatureFlagValue('premium_themes_enabled', 'user-3')
    ).resolves.toBe(undefined)
  })
})

describe('Story 6.3 acknowledged analytics ingestion', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
  it('retains retry ownership when ingestion is unconfigured, rejects, or quota-limits a 200 response', async () => {
    const { PostHogService } = await import('#posthog/posthog.service')
    vi.stubEnv('POSTHOG_API_KEY', '')
    const adapter = new PostHogService()
    const event = {
      distinctId: 'hmac-synthetic-subject',
      event: 'community_reaction_added',
      properties: { $insert_id: '63100000-0000-4000-8000-000000000001' },
    }
    await expect(adapter.captureAcknowledged(event)).rejects.toThrow('unconfigured')
    vi.stubEnv('POSTHOG_API_KEY', 'phc_synthetic')
    vi.stubEnv('POSTHOG_HOST', 'http://localhost:43210/')
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 1, quota_limited: ['events'] }))
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 0 })))
    vi.stubGlobal('fetch', fetch)
    await expect(adapter.captureAcknowledged(event)).rejects.toThrow('503')
    await expect(adapter.captureAcknowledged(event)).rejects.toThrow('quota limited')
    await expect(adapter.captureAcknowledged(event)).rejects.toThrow(
      'acknowledgement invalid'
    )
  })

  it('acknowledges accepted events with original time, stable UUID and disabled person/IP enrichment', async () => {
    const { PostHogService } = await import('#posthog/posthog.service')
    vi.stubEnv('POSTHOG_API_KEY', 'phc_synthetic')
    vi.stubEnv('POSTHOG_HOST', '')
    delete process.env.POSTHOG_HOST
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('1'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 1 })))
    vi.stubGlobal('fetch', fetch)
    const adapter = new PostHogService()
    const timestamp = '2026-10-01T12:00:00.000Z'
    const event = {
      distinctId: 'hmac-synthetic-subject',
      event: 'community_reaction_added',
      timestamp,
      properties: { $insert_id: '63100000-0000-4000-8000-000000000001', $ip: null },
    }
    await expect(adapter.captureAcknowledged(event)).resolves.toBeUndefined()
    await expect(adapter.captureAcknowledged(event)).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith(
      'https://us.i.posthog.com/i/v0/e/',
      expect.objectContaining({ method: 'POST' })
    )
    const request = fetch.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(request.body as string)).toMatchObject({
      uuid: event.properties.$insert_id,
      timestamp,
      properties: { $ip: null, $geoip_disable: true, $process_person_profile: false },
    })
  })
})
