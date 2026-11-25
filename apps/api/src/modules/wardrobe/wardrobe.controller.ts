// Story 4.1 Task 5 step 1 owner: expose Wardrobe API endpoints for upload url allocation and garment commit
// Story 4.2 Task 5 step 2 owner: expose suggestGarmentTags and updateGarmentTags API endpoints in apps/api/src/modules/wardrobe/wardrobe.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import { z } from 'zod'
import {
  createGarmentItemInputSchema,
  createGarmentUploadUrlInputSchema,
  garmentIdPathParamsSchema,
  garmentListWithColorResponseSchema,
  suggestGarmentTagsWireResponseSchema,
  updateGarmentTagsInputSchema,
  updateGarmentTagsResponseSchema,
  updateGarmentTagsWithColorResponseSchema,
  WARDROBE_GARMENT_COLOR_HEADER,
} from '@couture/api-client/contracts/http'
import { AuthContext } from '../auth/security.decorators'
import { RequestAuthGuard } from '../auth/security.guards'
import type { RequestAuthContext } from '../auth/security.types'
import { WardrobeUploadGuard } from './wardrobe.guard'
import { WardrobeService } from './wardrobe.service'

function validationMessage(prefix: string, error: z.ZodError): string {
  const details = error.issues
    .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
    .join('; ')
  return `${prefix}: ${details}`
}

/**
 * Story CC-7.5 D1: only the exact value `1` opts in to `colorFamily`. Anything else, `0`,
 * `true` and an empty value included, keeps the strict legacy shape installed builds parse.
 */
function wantsGarmentColor(header: string | string[] | undefined): boolean {
  return header === '1'
}

@Controller('/api/v1/wardrobe')
@UseGuards(RequestAuthGuard, WardrobeUploadGuard)
export class WardrobeController {
  constructor(
    @Inject(WardrobeService) private readonly wardrobeService: WardrobeService
  ) {}

  @Get('garments')
  @Header('Cache-Control', 'private, no-store')
  async listGarments(
    @AuthContext() auth: RequestAuthContext,
    @Headers(WARDROBE_GARMENT_COLOR_HEADER) colorHeader?: string | string[]
  ) {
    if (!wantsGarmentColor(colorHeader)) {
      return await this.wardrobeService.listGarments(auth.userId)
    }
    return garmentListWithColorResponseSchema.parse(
      await this.wardrobeService.listGarments(auth.userId, { includeColor: true })
    )
  }

  @Post('upload-url')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  async createUploadUrl(
    @AuthContext() auth: RequestAuthContext,
    @Body() payload: unknown,
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) response: Response
  ) {
    const parsed = createGarmentUploadUrlInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new BadRequestException(
        validationMessage('Invalid upload declaration', parsed.error)
      )
    }

    const parsedKey = z.string().uuid().safeParse(idempotencyKey)
    if (!parsedKey.success) {
      throw new BadRequestException('INVALID_IDEMPOTENCY_KEY')
    }
    const result = await this.wardrobeService.createUploadUrl(
      auth.userId,
      auth.role,
      parsed.data,
      parsedKey.data
    )
    response.status(result.replayed ? 200 : 201)
    return result.response
  }

  @Post('garments')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  async commitGarment(
    @AuthContext() auth: RequestAuthContext,
    @Body() payload: unknown,
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) response: Response
  ) {
    const parsed = createGarmentItemInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new BadRequestException(
        validationMessage('Invalid garment commit payload', parsed.error)
      )
    }

    const parsedKey = z.string().uuid().safeParse(idempotencyKey)
    if (!parsedKey.success) {
      throw new BadRequestException('INVALID_IDEMPOTENCY_KEY')
    }
    const result = await this.wardrobeService.commitGarment(
      auth.userId,
      auth.role,
      parsed.data,
      parsedKey.data
    )
    response.status(result.replayed ? 200 : 201)
    return result.response
  }

  // Story CC-7.6 D8: the garment DELETE and its usage read live in
  // `WardrobeGarmentRemovalController`, which skips the guardian upload-consent guard so a
  // member can always delete their own data.

  @Post('garments/:garmentId/suggest-tags')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async suggestGarmentTags(
    @AuthContext() auth: RequestAuthContext,
    @Param('garmentId') garmentId: string
  ) {
    const parsedPath = garmentIdPathParamsSchema.safeParse({ garmentId })
    if (!parsedPath.success) {
      throw new BadRequestException(
        validationMessage('Invalid garment id', parsedPath.error)
      )
    }

    // Validate against the wire shape: a `suggested` answer stays the original, `mode`-free body.
    return suggestGarmentTagsWireResponseSchema.parse(
      await this.wardrobeService.suggestGarmentTags(
        auth.userId,
        auth.role,
        parsedPath.data.garmentId
      )
    )
  }

  @Patch('garments/:garmentId/tags')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async updateGarmentTags(
    @AuthContext() auth: RequestAuthContext,
    @Param('garmentId') garmentId: string,
    @Body() payload: unknown,
    @Headers(WARDROBE_GARMENT_COLOR_HEADER) colorHeader?: string | string[]
  ) {
    const parsedPath = garmentIdPathParamsSchema.safeParse({ garmentId })
    if (!parsedPath.success) {
      throw new BadRequestException(
        validationMessage('Invalid garment id', parsedPath.error)
      )
    }

    const parsedBody = updateGarmentTagsInputSchema.safeParse(payload)
    if (!parsedBody.success) {
      throw new BadRequestException(
        validationMessage('Invalid garment tags', parsedBody.error)
      )
    }

    if (!wantsGarmentColor(colorHeader)) {
      return updateGarmentTagsResponseSchema.parse(
        await this.wardrobeService.updateGarmentTags(
          auth.userId,
          auth.role,
          parsedPath.data.garmentId,
          parsedBody.data
        )
      )
    }
    return updateGarmentTagsWithColorResponseSchema.parse(
      await this.wardrobeService.updateGarmentTags(
        auth.userId,
        auth.role,
        parsedPath.data.garmentId,
        parsedBody.data,
        { includeColor: true }
      )
    )
  }
}
