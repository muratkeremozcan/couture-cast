import type { PrismaClient } from '@prisma/client'
import {
  isAppendDeferral,
  type CommunityStreamRepository,
} from '../../src/modules/community/community-stream.repository.js'

/**
 * Appends until no outbox row is left unappended, the way the runtime append loop does.
 *
 * Every sync read and realtime tick starts a detached `assist()` that can still hold a
 * stream head after the request answered or the server closed. An append that meets
 * that head fails NOWAIT with head contention, and the holder commits the rows it
 * claimed. An append that runs out of its bounded budget rolls back and halves its
 * next batch. The product classifies both as deferrals (`isAppendDeferral`), and the
 * drain appends again, as the runtime does. Any other append failure propagates, and
 * so does the last deferral once the deadline passes. A backlog that outlives the
 * deadline fails with its size; the default deadline ends inside Vitest's 5s test
 * timeout so that message is the one seen.
 */
export async function drainCommunityOutbox(
  prisma: PrismaClient,
  streams: Pick<CommunityStreamRepository, 'append'>,
  deadlineMs = 4000
): Promise<void> {
  const deadline = performance.now() + deadlineMs
  for (;;) {
    const backlog = await prisma.communityDomainOutbox.count({
      where: { appended_at: null },
    })
    if (!backlog) return
    if (performance.now() >= deadline)
      throw new Error(
        `Community outbox kept ${backlog} unappended rows past the drain deadline`
      )
    try {
      await streams.append()
    } catch (error) {
      if (!isAppendDeferral(error) || performance.now() >= deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}
