import { Controller, Get, Query } from '@nestjs/common'
import { z } from 'zod'
import { EventsService } from './events.service'

const sinceSchema = z.string().datetime().optional()

@Controller('/api/v1/events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get('poll')
  async poll(@Query('since') since?: string) {
    const parsed = sinceSchema.safeParse(since)
    if (!parsed.success && since !== undefined) {
      return { events: [], nextSince: null, error: 'Invalid since timestamp' }
    }

    const sinceDate = parsed.success && parsed.data ? new Date(parsed.data) : undefined
    return this.eventsService.poll(sinceDate)
  }
}
