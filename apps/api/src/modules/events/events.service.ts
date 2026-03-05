import { Injectable, Logger } from '@nestjs/common'
import { EventsRepository } from './events.repository'

/**
 * Story 0.5 (Task 5): polling fallback data path.
 *
 * This service backs "offline-safe" event sync when realtime delivery is unavailable.
 * It returns incremental events using a cursor-like since timestamp (nextSince) so clients
 * can continue from the last known point without re-fetching the whole stream.
 *
 * Alternative:
 * - Full snapshot fetch on each poll, which is simpler but increases payload and duplicate processing.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name)

  constructor(private readonly repo: EventsRepository) {}

  async poll(since?: Date) {
    // Polling stays available even when websocket or push delivery paths are degraded.
    try {
      const events = await this.repo.findSince(since)
      const nextSince = events.length
        ? events[events.length - 1]?.created_at.toISOString()
        : null
      return {
        events: events.map((event) => ({
          id: event.id,
          channel: event.channel,
          payload: event.payload,
          userId: event.user_id ?? null,
          createdAt: event.created_at.toISOString(),
        })),
        nextSince,
      }
    } catch (error) {
      // Gracefully degrade if storage is unavailable; clients can still poll without breaking.
      this.logger.error('poll events failed', error as Error)
      return { events: [], nextSince: null }
    }
  }
}
