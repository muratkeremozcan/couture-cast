import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  UseGuards,
  InternalServerErrorException,
} from '@nestjs/common'
import { ZodError } from 'zod'
import {
  ritualQueryParamsSchema,
  ritualResponseSchema,
  type RitualResponse,
  type RitualQueryParams,
} from '../../contracts/http.js'
import { AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { RitualService } from './ritual.service.js'

function isZodError(error: unknown): error is ZodError {
  return (
    error instanceof ZodError ||
    (error instanceof Error &&
      error.name === 'ZodError' &&
      'issues' in error &&
      Array.isArray((error as ZodError).issues))
  )
}

@Controller('/api/v1/ritual')
@UseGuards(RequestAuthGuard)
export class RitualController {
  constructor(
    @Inject(RitualService)
    private readonly ritualService: RitualService
  ) {}

  @Get()
  async getOrCreateRitual(
    @AuthContext() auth: RequestAuthContext,
    @Query() query: unknown
  ): Promise<RitualResponse> {
    let parsedQuery: RitualQueryParams
    try {
      parsedQuery = ritualQueryParamsSchema.parse(query)
    } catch (error) {
      if (isZodError(error)) {
        throw new BadRequestException(
          error.issues.map((issue) => issue.message).join('; ')
        )
      }
      throw error
    }

    const data = await this.ritualService.getOrCreateRitual(
      auth.userId,
      parsedQuery.locationId
    )

    try {
      return ritualResponseSchema.parse({ data })
    } catch (error) {
      throw new InternalServerErrorException(
        error instanceof Error ? error.message : 'Response schema validation failed'
      )
    }
  }
}
