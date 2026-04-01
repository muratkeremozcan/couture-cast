import { Controller, Get, Query } from '@nestjs/common'
import {
  eventsPollInvalidSinceResponseSchema,
  eventsPollQuerySchema,
} from '../../contracts/http'
import { EventsService } from './events.service'

@Controller('/api/v1/events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get('poll')
  async poll(@Query('since') since?: string) {
    const parsed = eventsPollQuerySchema.safeParse({ since })
    if (!parsed.success && since !== undefined) {
      return eventsPollInvalidSinceResponseSchema.parse({
        events: [],
        nextSince: null,
        error: 'Invalid since timestamp',
      })
    }

    const sinceDate =
      parsed.success && parsed.data.since ? new Date(parsed.data.since) : undefined
    return this.eventsService.poll(sinceDate)
  }
}
