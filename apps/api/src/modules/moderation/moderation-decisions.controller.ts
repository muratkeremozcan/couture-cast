// Story 6.11 owner: the moderator write routes in `apps/api/src/modules/moderation/moderation-decisions.controller.ts`.
// Order of checks: bearer, role, flags, input. The moderator is the session: no request field can name one.
import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  moderationAppealInputSchema,
  moderationDecisionInputSchema,
} from '@couture/api-client/contracts/http'
import { AuthContext, Roles } from '../auth/security.decorators.js'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { moderationDecisionError } from './moderation-decision-rules.js'
import { ModerationDecisionsService } from './moderation-decisions.service.js'
import { ModerationSanctionsService } from './moderation-sanctions.service.js'

@Controller('/api/v1/moderation')
@UseGuards(RequestAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
export class ModerationDecisionsController {
  constructor(
    @Inject(ModerationDecisionsService)
    private readonly decisions: ModerationDecisionsService,
    @Inject(ModerationSanctionsService)
    private readonly sanctions: ModerationSanctionsService,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService
  ) {}

  @Post('cases/:caseId/decisions')
  @HttpCode(200)
  async decide(
    @AuthContext() auth: RequestAuthContext,
    @Param('caseId') caseId: string,
    @Body() body: unknown
  ) {
    await this.assertEnabled(auth)
    const parsed = moderationDecisionInputSchema.safeParse(body)
    if (!parsed.success) throw moderationDecisionError('invalid_decision')
    return this.decisions.decide(auth, caseId, parsed.data)
  }

  @Post('sanctions/:sanctionId/appeal')
  @HttpCode(200)
  async appeal(
    @AuthContext() auth: RequestAuthContext,
    @Param('sanctionId') sanctionId: string,
    @Body() body: unknown
  ) {
    await this.assertEnabled(auth)
    const parsed = moderationAppealInputSchema.safeParse(body)
    if (!parsed.success) throw moderationDecisionError('invalid_decision')
    return this.sanctions.recordAppeal(auth, sanctionId, parsed.data)
  }

  /** Both flags must be on. A flag read that fails is a closed route, never a 500. */
  private async assertEnabled(auth: RequestAuthContext): Promise<void> {
    let console = false
    let decisions = false
    try {
      console = await this.flags.getFeatureFlag('moderation_console_enabled', auth.userId)
      decisions = await this.flags.getFeatureFlag(
        'moderation_decisions_enabled',
        auth.userId
      )
    } catch {
      throw moderationDecisionError('moderation_decisions_disabled')
    }
    if (!console) throw moderationDecisionError('moderation_console_disabled')
    if (!decisions) throw moderationDecisionError('moderation_decisions_disabled')
  }
}
