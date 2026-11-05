// Story 6.13 owner: the erasure and evidence routes in `apps/api/src/modules/moderation/moderation-history.controller.ts`.
// Order of checks: bearer, role, flags, input. A non-moderator never learns the flag state.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import {
  moderationErasureRequestSchema,
  moderationEvidenceExportRequestSchema,
  type ModerationErasureResponse,
  type ModerationEvidenceAvailabilityResponse,
  type ModerationEvidenceBundle,
} from '@couture/api-client/contracts/http'
import { AuthContext, Roles } from '../auth/security.decorators.js'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import {
  moderationHistoryError,
  ModerationHistoryService,
} from './moderation-history.service.js'

@Controller('/api/v1/moderation')
@UseGuards(RequestAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
export class ModerationHistoryController {
  constructor(
    @Inject(ModerationHistoryService) private readonly history: ModerationHistoryService,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService
  ) {}

  @Get('evidence-exports/availability')
  async evidenceAvailability(
    @AuthContext() auth: RequestAuthContext
  ): Promise<ModerationEvidenceAvailabilityResponse> {
    await this.assertEnabled(auth)
    return { data: { rangeExport: auth.role === 'admin' } }
  }

  @Post('erasure-requests')
  async requestErasure(
    @AuthContext() auth: RequestAuthContext,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response
  ): Promise<ModerationErasureResponse> {
    if (auth.role !== 'admin') throw moderationHistoryError('admin_required')
    await this.assertEnabled(auth)
    const parsed = moderationErasureRequestSchema.safeParse(body)
    if (!parsed.success) throw moderationHistoryError('invalid_request')
    const data = await this.history.requestErasure(auth, parsed.data.memberId)
    response.status(data.replayed ? 200 : 201)
    return { data }
  }

  @Post('evidence-exports')
  @HttpCode(200)
  async exportEvidence(
    @AuthContext() auth: RequestAuthContext,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response
  ): Promise<ModerationEvidenceBundle> {
    await this.assertEnabled(auth)
    const parsed = moderationEvidenceExportRequestSchema.safeParse(body)
    if (!parsed.success) throw moderationHistoryError('invalid_request')
    const bundle = await this.history.exportEvidence(auth, parsed.data)
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="moderation-evidence-${bundle.exportId}.json"`
    )
    return bundle
  }

  private async assertEnabled(auth: RequestAuthContext): Promise<void> {
    // A flag read that fails is a closed route, never a 500.
    let enabled = false
    try {
      enabled =
        (await this.flags.getFeatureFlag('moderation_history_enabled', auth.userId)) &&
        (await this.flags.getFeatureFlag('moderation_console_enabled', auth.userId))
    } catch {
      enabled = false
    }
    if (!enabled) throw moderationHistoryError('moderation_history_disabled')
  }
}
