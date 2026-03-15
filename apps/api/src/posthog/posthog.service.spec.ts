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
    const { PostHogService } = await import('./posthog.service.js')
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
    const { PostHogService } = await import('./posthog.service.js')
    getFeatureFlag.mockResolvedValue('variant-a')

    const service = new PostHogService()

    await expect(
      service.getFeatureFlagValue('premium_themes_enabled', 'user-2')
    ).resolves.toBe('variant-a')
  })

  it('returns undefined when the SDK is not configured', async () => {
    const { PostHogService } = await import('./posthog.service.js')
    delete process.env.POSTHOG_API_KEY

    const service = new PostHogService()

    await expect(
      service.getFeatureFlagValue('premium_themes_enabled', 'user-3')
    ).resolves.toBe(undefined)
  })
})
