// Story 6.5 owner: authenticated owner-scoped push registration routes.
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  registerPushTokenInputSchema,
  registerPushTokenResponseSchema,
  pushRegistrationsResponseSchema,
  removePushRegistrationQuerySchema,
  removePushRegistrationResponseSchema,
} from '@couture/api-client/contracts/http'
import { AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { parseCommunityInput } from '../community/community-sync.controller.js'
import { PushRegistrationService } from './push-registration.service.js'
@Controller('/api/v1/notifications/push-tokens')
@UseGuards(RequestAuthGuard)
export class PushRegistrationController {
  constructor(
    @Inject(PushRegistrationService)
    private readonly registrations: PushRegistrationService
  ) {}
  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async register(@AuthContext() auth: RequestAuthContext, @Body() body: unknown) {
    return registerPushTokenResponseSchema.parse({
      data: await this.registrations.register(
        auth.userId,
        parseCommunityInput(registerPushTokenInputSchema, body)
      ),
    })
  }
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@AuthContext() auth: RequestAuthContext) {
    return pushRegistrationsResponseSchema.parse({
      data: await this.registrations.list(auth.userId),
    })
  }
  @Delete(':registrationId')
  @Header('Cache-Control', 'private, no-store')
  async remove(
    @AuthContext() auth: RequestAuthContext,
    @Param('registrationId') id: string,
    @Query() query: unknown
  ) {
    const { bindingGeneration } = parseCommunityInput(
      removePushRegistrationQuerySchema,
      query
    )
    return removePushRegistrationResponseSchema.parse({
      data: await this.registrations.remove(auth.userId, id, bindingGeneration),
    })
  }
}
