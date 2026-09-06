import { Inject, Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { parseCommunityObjectPath } from '@couture/utils'
import { createBaseLogger } from '../../logger/pino.config.js'
import {
  CommunityModerationQueue,
  type CommunityModerationPublisher,
} from './community-moderation.queue.js'

const MAX_DISPATCH_BATCH = 100

export interface CommunityOutboxDispatchResult {
  dispatched: number
  failed: number
}

/**
 * The half of the transactional outbox that was missing.
 *
 * `publishPost` wrote a `CommunityModerationOutbox` row inside the publish
 * transaction, which is the correct producer side, but nothing ever read those
 * rows: `CommunityModerationQueue.enqueue` had no production caller and the
 * worker was never registered. Every post therefore terminated at
 * `pending_review` and no image or caption was ever screened.
 *
 * This dispatcher closes the loop the way `CapsuleTelemetryOutbox` does for
 * capsule analytics: claim the rows whose work has not been handed off, enqueue
 * each one, and record the outcome on the row. The queue's deterministic job id
 * (`postId__uploadSessionId`) makes a re-dispatch a no-op rather than a second
 * screening, so a crash between enqueue and stamp costs nothing.
 */
@Injectable()
export class CommunityModerationOutboxDispatcher {
  private readonly logger = createBaseLogger().child({
    feature: 'community-moderation-outbox',
  })

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(CommunityModerationQueue)
    private readonly queue: CommunityModerationPublisher
  ) {}

  async dispatchPending(
    limit = MAX_DISPATCH_BATCH
  ): Promise<CommunityOutboxDispatchResult> {
    const pending = await this.prisma.communityModerationOutbox.findMany({
      where: { dispatched_at: null },
      orderBy: { created_at: 'asc' },
      take: Math.min(limit, MAX_DISPATCH_BATCH),
      include: { post: true },
    })

    let dispatched = 0
    let failed = 0

    for (const row of pending) {
      const ok = await this.dispatchOne(row.id, row.post_id, row.post.image_object_path)
      if (ok) {
        dispatched += 1
      } else {
        failed += 1
      }
    }

    return { dispatched, failed }
  }

  private async dispatchOne(
    outboxId: string,
    postId: string,
    imageObjectPath: string | null
  ): Promise<boolean> {
    // The upload session is the random middle segment of the object path, so it
    // survives a restart without a column of its own and keeps the job id stable
    // across retries. A post whose path predates that convention falls back to
    // its own id, which is still deterministic.
    const uploadSessionId =
      (imageObjectPath
        ? parseCommunityObjectPath(imageObjectPath)?.uploadSessionId
        : null) ?? postId

    try {
      await this.queue.enqueue(postId, uploadSessionId)
      await this.prisma.communityModerationOutbox.update({
        where: { id: outboxId },
        data: {
          dispatched_at: new Date(),
          attempts: { increment: 1 },
          last_error: null,
        },
      })
      return true
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error'
      this.logger.error(
        { postId, message: 'community_moderation_dispatch_failed', error: message },
        'Community moderation enqueue failed; outbox row stays claimable for retry'
      )

      await this.prisma.communityModerationOutbox
        .update({
          where: { id: outboxId },
          data: { attempts: { increment: 1 }, last_error: message.slice(0, 500) },
        })
        .catch(() => {
          // Recording the failure is best effort; the undispatched row survives.
        })

      return false
    }
  }
}
