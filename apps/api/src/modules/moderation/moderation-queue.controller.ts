// Story 6.10 owner: the two read-only moderator routes in `apps/api/src/modules/moderation/moderation-queue.controller.ts`.
// Order of checks: bearer, role, flag, input. A non-moderator never learns the flag state or whether a case exists.
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common'
import { moderationCasesQuerySchema } from '@couture/api-client/contracts/http'
import { AuthContext, Roles } from '../auth/security.decorators.js'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { ModerationQueueService } from './moderation-queue.service.js'

@Controller('/api/v1/moderation')
@UseGuards(RequestAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
export class ModerationQueueController {
  constructor(
    @Inject(ModerationQueueService) private readonly queue: ModerationQueueService,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService
  ) {}

  @Get('cases')
  async listCases(@AuthContext() auth: RequestAuthContext, @Query() rawQuery: unknown) {
    await this.assertEnabled(auth)
    const parsed = moderationCasesQuerySchema.safeParse(rawQuery)
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'invalid_filter',
        message: 'Invalid moderation queue filter.',
      })
    }
    return this.queue.listCases(auth, parsed.data)
  }

  @Get('cases/:caseId')
  async getCase(
    @AuthContext() auth: RequestAuthContext,
    @Param('caseId') caseId: string
  ) {
    await this.assertEnabled(auth)
    return this.queue.getCase(auth, caseId)
  }

  private async assertEnabled(auth: RequestAuthContext): Promise<void> {
    // A flag read that fails is a closed console, never a 500.
    let enabled = false
    try {
      enabled = await this.flags.getFeatureFlag('moderation_console_enabled', auth.userId)
    } catch {
      enabled = false
    }
    if (enabled) return
    throw new ServiceUnavailableException({
      statusCode: 503,
      code: 'moderation_console_disabled',
      message: 'The moderation console is not available.',
    })
  }
}
