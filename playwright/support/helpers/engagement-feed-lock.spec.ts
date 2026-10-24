import { describe, expect, it, vi } from 'vitest'
import {
  ENGAGEMENT_FEED_LOCK,
  type FeedTestInfo,
  holdEngagementFeed,
} from './engagement-feed-lock'

class Skipped extends Error {}

function testInfo(environment: string) {
  const timeouts: number[] = []
  const info = {
    project: { metadata: { environment } },
    timeout: 60_000,
    setTimeout: (timeout: number) => {
      timeouts.push(timeout)
      info.timeout = timeout
    },
    // Playwright's skip throws to end the test; this stand-in does the same.
    skip: (condition: boolean) => {
      if (condition) throw new Skipped()
    },
  }
  return { info: info as unknown as FeedTestInfo, timeouts }
}

const LOCAL_DATABASE = 'postgresql://local/test'

describe('engagement feed lock fixture', () => {
  it.each(['preview', 'prod'])(
    'skips a %s run before it connects to any database',
    async (environment) => {
      const acquire = vi.fn()
      const databaseUrl = vi.fn(() => 'postgresql://unused')
      const use = vi.fn(() => Promise.resolve())
      await expect(
        holdEngagementFeed(testInfo(environment).info, use, { databaseUrl, acquire })
      ).rejects.toBeInstanceOf(Skipped)
      expect(databaseUrl).not.toHaveBeenCalled()
      expect(acquire).not.toHaveBeenCalled()
      expect(use).not.toHaveBeenCalled()
    }
  )

  it('holds the feed lock around a local test and releases it after', async () => {
    const order: string[] = []
    const release = vi.fn(() => {
      order.push('release')
      return Promise.resolve()
    })
    const acquire = vi.fn(() => {
      order.push('acquire')
      return Promise.resolve(release)
    })
    const { info, timeouts } = testInfo('local')
    await holdEngagementFeed(
      info,
      () => {
        order.push('test')
        return Promise.resolve()
      },
      { databaseUrl: () => LOCAL_DATABASE, acquire }
    )
    expect(acquire).toHaveBeenCalledWith(LOCAL_DATABASE, ENGAGEMENT_FEED_LOCK, {
      timeoutMs: 30 * 60_000,
    })
    expect(order).toEqual(['acquire', 'test', 'release'])
    // The wait runs without a test deadline; the test then gets its whole budget.
    expect(timeouts[0]).toBe(0)
    expect(timeouts[1]).toBeGreaterThanOrEqual(60_000)
  })

  it('releases the lock when the test fails', async () => {
    const release = vi.fn(() => Promise.resolve())
    await expect(
      holdEngagementFeed(
        testInfo('local').info,
        () => Promise.reject(new Error('test failed')),
        { databaseUrl: () => LOCAL_DATABASE, acquire: () => Promise.resolve(release) }
      )
    ).rejects.toThrow('test failed')
    expect(release).toHaveBeenCalledTimes(1)
  })
})
