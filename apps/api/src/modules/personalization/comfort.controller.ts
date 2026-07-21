// Story 2.2 Task 2 step 2 owner: implement ComfortController route handlers
import {
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
import {
  comfortPreferencesResponseSchema,
  updateComfortPreferencesInputSchema,
  updateComfortPreferencesResponseSchema,
  type ComfortPreferencesResponse,
  type UpdateComfortPreferencesInput,
  type UpdateComfortPreferencesResponse,
} from '../../contracts/http.js'
import { AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { ComfortService } from './comfort.service.js'
import { toBadRequest } from '../../controllers/error-helpers.js'

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
    let input: UpdateComfortPreferencesInput
    try {
      input = updateComfortPreferencesInputSchema.parse(body)
    } catch (error) {
      return toBadRequest(error)
    }

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
  }
}
