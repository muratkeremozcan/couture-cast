import type { TestInfo } from '@playwright/test'
import { acquireAdvisoryLock } from './advisory-lock'
import { isNonLocalEnvironment } from './api-test'

export const ENGAGEMENT_FEED_LOCK = 'couture-cast:story-6.5-engagement-feed'

export type FeedTestInfo = Pick<TestInfo, 'project' | 'timeout' | 'setTimeout' | 'skip'>

/**
 * Runs `use` while this test alone holds the shared engagement feed.
 *
 * The engagement journeys need the local seeded database, and the lock lives in
 * it, so a preview or prod run skips here, before any connection is made; the
 * skip the community fixtures apply comes later than this automatic fixture.
 *
 * Time spent queued behind another engagement test is not this test's time: the
 * wait has its own deadline, and the test keeps its whole budget after it.
 */
export async function holdEngagementFeed(
  testInfo: FeedTestInfo,
  use: () => Promise<void>,
  {
    databaseUrl,
    acquire = acquireAdvisoryLock,
  }: { databaseUrl: () => string; acquire?: typeof acquireAdvisoryLock }
): Promise<void> {
  testInfo.skip(
    isNonLocalEnvironment(testInfo as TestInfo),
    'Community engagement journeys need the local seeded database.'
  )
  const budget = testInfo.timeout
  const waitingSince = Date.now()
  testInfo.setTimeout(0)
  const release = await acquire(databaseUrl(), ENGAGEMENT_FEED_LOCK, {
    timeoutMs: 30 * 60_000,
  })
  testInfo.setTimeout(budget + (Date.now() - waitingSince))
  try {
    await use()
  } finally {
    await release()
  }
}
