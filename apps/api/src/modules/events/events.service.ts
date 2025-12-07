import { Injectable, Logger } from '@nestjs/common'
import { EventsRepository } from './events.repository'

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name)

  constructor(private readonly repo: EventsRepository) {}

  async poll(since?: Date) {
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
