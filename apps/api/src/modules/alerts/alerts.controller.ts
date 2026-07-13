import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Put,
  UseGuards,
} from '@nestjs/common'
import { ZodError } from 'zod'
import {
  getAlertPreferencesResponseSchema,
  updateAlertRulesInputSchema,
  updateAlertRulesResponseSchema,
  updateNotificationPreferencesInputSchema,
  updateNotificationPreferencesResponseSchema,
  type GetAlertPreferencesResponse,
  type UpdateAlertRulesResponse,
  type UpdateNotificationPreferencesResponse,
} from '../../contracts/http'
import { AuthContext } from '../auth/security.decorators'
import { RequestAuthGuard } from '../auth/security.guards'
import type { RequestAuthContext } from '../auth/security.types'
import { AlertsService } from './alerts.service'

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

@Controller('/api/v1/alerts')
@UseGuards(RequestAuthGuard)
export class AlertsController {
  constructor(
    @Inject(AlertsService)
    private readonly alertsService: AlertsService
  ) {}

  @Get('preferences')
  async getPreferences(
    @AuthContext() auth: RequestAuthContext
  ): Promise<GetAlertPreferencesResponse> {
    const data = await this.alertsService.getSettings(auth.userId)

    return getAlertPreferencesResponseSchema.parse({ data })
  }

  @Put('rules')
  @HttpCode(200)
  async updateRules(
    @AuthContext() auth: RequestAuthContext,
    @Body() body: unknown
  ): Promise<UpdateAlertRulesResponse> {
    try {
      const input = updateAlertRulesInputSchema.parse(body)
      const rules = await this.alertsService.updateRules(auth.userId, input)

      return updateAlertRulesResponseSchema.parse({ data: { rules } })
    } catch (error) {
      return toBadRequest(error)
    }
  }

  @Put('preferences')
  @HttpCode(200)
  async updateNotificationPreferences(
    @AuthContext() auth: RequestAuthContext,
    @Body() body: unknown
  ): Promise<UpdateNotificationPreferencesResponse> {
    try {
      const input = updateNotificationPreferencesInputSchema.parse(body)
      const preferences = await this.alertsService.updateNotificationPreferences(
        auth.userId,
        input
      )

      return updateNotificationPreferencesResponseSchema.parse({
        data: { preferences },
      })
    } catch (error) {
      return toBadRequest(error)
    }
  }
}
