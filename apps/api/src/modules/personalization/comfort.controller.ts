import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Put,
  UseGuards,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common'
import { ZodError } from 'zod'
import {
  comfortPreferencesResponseSchema,
  updateComfortPreferencesInputSchema,
  updateComfortPreferencesResponseSchema,
  type ComfortPreferencesResponse,
  type UpdateComfortPreferencesResponse,
} from '../../contracts/http.js'
import { AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { ComfortService } from './comfort.service.js'

function isZodError(error: unknown): error is ZodError {
  return (
    error instanceof ZodError ||
    (error instanceof Error &&
      error.name === 'ZodError' &&
      'issues' in error &&
      Array.isArray((error as ZodError).issues))
  )
}

function toBadRequest(error: unknown): never {
  if (isZodError(error)) {
    throw new BadRequestException(error.issues.map((issue) => issue.message).join('; '))
  }
  throw error
}

@Controller('/api/v1/personalization/comfort')
@UseGuards(RequestAuthGuard)
export class ComfortController {
  private readonly logger = new Logger(ComfortController.name)

  constructor(
    @Inject(ComfortService)
    private readonly comfortService: ComfortService
  ) {}

  @Get()
  async getComfortPreferences(
    @AuthContext() auth: RequestAuthContext
  ): Promise<ComfortPreferencesResponse> {
    const data = await this.comfortService.getComfortPreferences(auth.userId)

    try {
      return comfortPreferencesResponseSchema.parse({ data })
    } catch (error) {
      this.logger.error(
        `Comfort preferences response schema validation failed for user ${auth.userId}:`,
        error instanceof Error ? error.stack : error
      )
      throw new InternalServerErrorException('Response schema validation failed')
    }
  }

  @Put()
  @HttpCode(200)
  async updateComfortPreferences(
    @AuthContext() auth: RequestAuthContext,
    @Body() body: unknown
  ): Promise<UpdateComfortPreferencesResponse> {
    try {
      const input = updateComfortPreferencesInputSchema.parse(body)
      const data = await this.comfortService.updateComfortPreferences(auth.userId, input)

      try {
        return updateComfortPreferencesResponseSchema.parse({ data })
      } catch (error) {
        this.logger.error(
          `Update comfort preferences response schema validation failed for user ${auth.userId}:`,
          error instanceof Error ? error.stack : error
        )
        throw new InternalServerErrorException('Response schema validation failed')
      }
    } catch (error) {
      return toBadRequest(error)
    }
  }
}
