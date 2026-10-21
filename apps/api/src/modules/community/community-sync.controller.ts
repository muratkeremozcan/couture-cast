// Story 6.5 owner: canonical community-only HTTP routes.
import { CommunityPreferencesService } from './community-preferences.service.js'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common'
import type { z } from 'zod'
import {
  communityEventsQuerySchema,
  communityNotificationPreferencesResponseSchema,
  patchCommunityNotificationPreferencesSchema,
  communityEventsResponseSchema,
  resolveCommunityTargetsInputSchema,
  resolveCommunityTargetsResponseSchema,
} from '@couture/api-client/contracts/http'
import { AuthContext, ConsentCheckedInTransaction } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { CommunitySyncService } from './community-sync.service.js'
import { CommunityTargetsService } from './community-targets.service.js'
export function parseCommunityInput<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown
): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success)
    throw new BadRequestException({
      statusCode: 400,
      code: 'invalid_request',
      message: 'Invalid community request.',
    })
  return parsed.data
}
@Controller('/api/v1/community')
@UseGuards(RequestAuthGuard)
export class CommunitySyncController {
  constructor(
    @Inject(CommunityPreferencesService)
    private readonly preferences: CommunityPreferencesService,
    @Inject(CommunitySyncService) private readonly sync: CommunitySyncService,
    @Inject(CommunityTargetsService) private readonly targets: CommunityTargetsService
  ) {}
  @Get('notification-preferences')
  @ConsentCheckedInTransaction()
  @Header('Cache-Control', 'private, no-store')
  async preferencesGet(@AuthContext() auth: RequestAuthContext) {
    return communityNotificationPreferencesResponseSchema.parse({
      data: await this.preferences.get(auth.userId),
    })
  }
  @Patch('notification-preferences')
  @ConsentCheckedInTransaction()
  @Header('Cache-Control', 'private, no-store')
  async preferencesPatch(
    @AuthContext() auth: RequestAuthContext,
    @Body() input: unknown
  ) {
    return communityNotificationPreferencesResponseSchema.parse({
      data: await this.preferences.patch(
        auth.userId,
        parseCommunityInput(patchCommunityNotificationPreferencesSchema, input)
      ),
    })
  }
  @Get('events')
  @ConsentCheckedInTransaction()
  @Header('Cache-Control', 'private, no-store')
  async events(@AuthContext() auth: RequestAuthContext, @Query() query: unknown) {
    const input = parseCommunityInput(communityEventsQuerySchema, query)
    return communityEventsResponseSchema.parse({
      data: await this.sync.events(auth.userId, input.mode, input.cursor),
    })
  }
  @Post('targets/resolve')
  @HttpCode(200)
  @ConsentCheckedInTransaction()
  @Header('Cache-Control', 'private, no-store')
  async resolve(@AuthContext() auth: RequestAuthContext, @Body() input: unknown) {
    return resolveCommunityTargetsResponseSchema.parse({
      data: await this.targets.resolve(
        auth.userId,
        parseCommunityInput(resolveCommunityTargetsInputSchema, input)
      ),
    })
  }
}
