import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  photoAiConsentResponseSchema,
  revokePhotoAiConsentInputSchema,
  type PhotoAiConsentResponse,
} from '@couture/api-client/contracts/http'
import { toBadRequest } from '../../controllers/error-helpers.js'
import { PHOTO_AI_CONSENT_ROUTE } from '../../logger/request-context.js'
import { AllowPendingGuardianTeen, AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { PhotoAiGrantGate } from './photo-ai-grant-gate.js'

@Controller(PHOTO_AI_CONSENT_ROUTE)
@UseGuards(RequestAuthGuard)
@AllowPendingGuardianTeen()
export class PhotoAiConsentController {
  constructor(@Inject(PhotoAiGrantGate) private readonly gate: PhotoAiGrantGate) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@AuthContext() auth: RequestAuthContext): Promise<PhotoAiConsentResponse> {
    const grants = await this.gate.list(auth.userId)
    return photoAiConsentResponseSchema.parse({
      data: {
        externalProcessingEnabled: false,
        grants: grants.map((grant) => ({
          id: grant.id,
          feature: grant.feature,
          inputClass: grant.input_class,
          provider: grant.provider,
          policyVersion: grant.policy_version,
          expiresAt: grant.expires_at.toISOString(),
        })),
      },
    })
  }

  @Post('revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async revoke(
    @AuthContext() auth: RequestAuthContext,
    @Body() body: unknown
  ): Promise<PhotoAiConsentResponse> {
    const parsed = revokePhotoAiConsentInputSchema.safeParse(body)
    if (!parsed.success) return toBadRequest(parsed.error)
    await this.gate.revoke(auth.userId, parsed.data.grantId)
    return this.list(auth)
  }
}
