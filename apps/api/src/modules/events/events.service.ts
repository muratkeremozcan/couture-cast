import { Injectable } from '@nestjs/common'
import { eventsPollResponseSchema } from '../../contracts/http'
import { createBaseLogger } from '../../logger/pino.config'
import { EventsRepository } from './events.repository'

/**
 * Story 0.5 support file: polling fallback data path.
 *
 * This service backs "offline-safe" event sync when realtime delivery is unavailable.
 * It returns incremental events using a cursor-like since timestamp (nextSince) so clients
 * can continue from the last known point without re-fetching the whole stream.
 *
 * Alternative:
 * - Full snapshot fetch on each poll, which is simpler but increases payload and duplicate processing.
 *
 * Flow refs:
 * - S0.5/T5: polling fallback depends on incremental event retrieval with a stable cursor.
 */
@Injectable()
export class EventsService {
  private readonly logger = createBaseLogger().child({ feature: 'events' })

  constructor(private readonly repo: EventsRepository) {}

  async poll(since?: Date) {
    // Flow ref S0.5/T5: polling stays available even when websocket or push paths are degraded.
    try {
      const events = await this.repo.findSince(since)
      const nextSince = events.length
        ? events[events.length - 1]?.created_at.toISOString()
        : null
      return eventsPollResponseSchema.parse({
        events: events.map((event) => ({
          id: event.id,
          channel: event.channel,
          payload: event.payload,
          userId: event.user_id ?? null,
          createdAt: event.created_at.toISOString(),
        })),
        nextSince,
      })
    } catch (error) {
      // Flow ref S0.5/T5: degrade gracefully so polling clients do not crash on transient storage issues.
      this.logger.error({ err: error }, 'poll_events_failed')
      return eventsPollResponseSchema.parse({ events: [], nextSince: null })
    }
  }
}
