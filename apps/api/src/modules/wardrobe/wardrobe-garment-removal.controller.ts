// Story CC-7.6: garment delete and the usage read that names what a delete affects.
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import {
  garmentIdPathParamsSchema,
  garmentUsageResponseSchema,
  type GarmentUsageResponse,
} from '@couture/api-client/contracts/http'
import { AllowPendingGuardianTeen, AuthContext } from '../auth/security.decorators'
import { RequestAuthGuard } from '../auth/security.guards'
import type { RequestAuthContext } from '../auth/security.types'
import { WardrobeService } from './wardrobe.service'
import { WardrobeRetentionService } from './wardrobe-retention.service'
// The `.js` specifier matches `wardrobe-saved-look.controller.ts`, so test harnesses that import
// the service that way inject the same class object.
import { WardrobeSavedLookService } from './wardrobe-saved-look.service.js'

function parseGarmentId(garmentId: string): string {
  const parsed = garmentIdPathParamsSchema.safeParse({ garmentId })
  if (!parsed.success) {
    throw new BadRequestException(invalidGarmentIdMessage(parsed.error))
  }
  return parsed.data.garmentId
}

function invalidGarmentIdMessage(error: z.ZodError): string {
  const details = error.issues
    .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
    .join('; ')
  return `Invalid garment id: ${details}`
}

/**
 * Story CC-7.6 D8: a member can always delete their own data. These routes skip the guardian
 * upload-consent check (`WardrobeUploadGuard`) the other wardrobe routes run; authentication
 * and ownership stay. A guardian-pending teen passes, as on the other non-upload member
 * surfaces; a suspended account stays blocked by `RequestAuthGuard`.
 */
@Controller('/api/v1/wardrobe')
@UseGuards(RequestAuthGuard)
@AllowPendingGuardianTeen()
export class WardrobeGarmentRemovalController {
  constructor(
    @Inject(WardrobeService) private readonly wardrobeService: WardrobeService,
    @Inject(WardrobeRetentionService)
    private readonly wardrobeRetentionService: WardrobeRetentionService,
    @Inject(WardrobeSavedLookService)
    private readonly wardrobeSavedLookService: WardrobeSavedLookService
  ) {}

  /**
   * D2/D3: the saved looks and capsules a delete would affect. 404 `GARMENT_NOT_FOUND` unless
   * the garment is the caller's own ready, active garment with no recorded deletion request;
   * clients treat that as already gone. Another member's garment answers the same 404.
   */
  @Get('garments/:garmentId/usage')
  @Header('Cache-Control', 'private, no-store')
  async getGarmentUsage(
    @AuthContext() auth: RequestAuthContext,
    @Param('garmentId') garmentId: string
  ): Promise<GarmentUsageResponse> {
    const id = parseGarmentId(garmentId)
    const { capsuleCount } = await this.wardrobeService.countGarmentCapsules(
      auth.userId,
      id
    )
    const savedLookCount =
      await this.wardrobeSavedLookService.countSavedLooksUsingGarment(auth.userId, id)
    return garmentUsageResponseSchema.parse({
      garmentId: id,
      savedLookCount,
      capsuleCount,
    })
  }

  /**
   * Idempotent: a garment that does not exist or is another member's answers 204 and changes
   * nothing. Under a legal hold the request is recorded (D4); a purge that throws after the
   * flip is finished by the hourly sweep (D5).
   */
  @Delete('garments/:garmentId')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  async deleteGarment(
    @AuthContext() auth: RequestAuthContext,
    @Param('garmentId') garmentId: string
  ): Promise<void> {
    await this.wardrobeRetentionService.requestDeletion(
      auth.userId,
      parseGarmentId(garmentId)
    )
  }
}
