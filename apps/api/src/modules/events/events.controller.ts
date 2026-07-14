import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common'
import {
  eventsPollInvalidSinceResponseSchema,
  eventsPollQuerySchema,
} from '../../contracts/http'
import { AuthContext } from '../auth/security.decorators'
import { RequestAuthGuard } from '../auth/security.guards'
import type { RequestAuthContext } from '../auth/security.types'
import { EventsService } from './events.service'

@Controller('/api/v1/events')
@UseGuards(RequestAuthGuard)
export class EventsController {
  constructor(@Inject(EventsService) private readonly eventsService: EventsService) {}

  @Get('poll')
  async poll(@AuthContext() auth: RequestAuthContext, @Query('since') since?: string) {
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
    return this.eventsService.poll(auth.userId, sinceDate)
  }
}
