// Story 6.12 owner: the moderator-only SLA read route in `apps/api/src/modules/moderation/moderation-sla.controller.ts`.
// Order of checks: bearer, role, flags. A non-moderator never learns the flag state.
import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common'
import type { ModerationSlaResponse } from '@couture/api-client/contracts/http'
import { AuthContext, Roles } from '../auth/security.decorators.js'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { ModerationSlaService } from './moderation-sla.service.js'

@Controller('/api/v1/moderation')
@UseGuards(RequestAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
export class ModerationSlaController {
  constructor(
    @Inject(ModerationSlaService) private readonly sla: ModerationSlaService,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService
  ) {}

  @Get('sla')
  async getSla(@AuthContext() auth: RequestAuthContext): Promise<ModerationSlaResponse> {
    await this.assertEnabled(auth)
    return this.sla.summary()
  }

  private async assertEnabled(auth: RequestAuthContext): Promise<void> {
    // A flag read that fails is a closed route, never a 500.
    let enabled = false
    try {
      enabled =
        (await this.flags.getFeatureFlag(
          'moderation_sla_monitoring_enabled',
          auth.userId
        )) && (await this.flags.getFeatureFlag('moderation_console_enabled', auth.userId))
    } catch {
      enabled = false
    }
    if (enabled) return
    throw new ServiceUnavailableException({
      statusCode: 503,
      code: 'moderation_sla_disabled',
      message: 'SLA monitoring is not available.',
    })
  }
}
