// Story 4.1 Task 5 step 1 owner: expose Wardrobe API endpoints for upload url allocation, binary upload relay, and garment commit
// Story 4.2 Task 5 step 2 owner: expose suggestGarmentTags and updateGarmentTags API endpoints in apps/api/src/modules/wardrobe/wardrobe.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Header,
  Headers,
  HttpCode,
  Get,
  Inject,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { z } from 'zod'
import {
  createGarmentItemInputSchema,
  createGarmentUploadUrlInputSchema,
  garmentIdPathParamsSchema,
  suggestGarmentTagsResponseSchema,
  updateGarmentTagsInputSchema,
  updateGarmentTagsResponseSchema,
} from '@couture/api-client/contracts/http'
import { AuthContext } from '../auth/security.decorators'
import { RequestAuthGuard } from '../auth/security.guards'
import type { RequestAuthContext } from '../auth/security.types'
import { WardrobeUploadGuard } from './wardrobe.guard'
import { WardrobeService } from './wardrobe.service'
import { WardrobeRetentionService } from './wardrobe-retention.service'
import { MAX_GARMENT_IMAGE_BYTES } from './wardrobe-image-validation'

const garmentMimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp'])

function validationMessage(prefix: string, error: z.ZodError): string {
  const details = error.issues
    .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
    .join('; ')
  return `${prefix}: ${details}`
}

@Controller('/api/v1/wardrobe')
@UseGuards(RequestAuthGuard, WardrobeUploadGuard)
export class WardrobeController {
  constructor(
    @Inject(WardrobeService) private readonly wardrobeService: WardrobeService,
    @Inject(WardrobeRetentionService)
    private readonly wardrobeRetentionService: WardrobeRetentionService
  ) {}

  @Get('garments')
  @Header('Cache-Control', 'private, no-store')
  async listGarments(@AuthContext() auth: RequestAuthContext) {
    return await this.wardrobeService.listGarments(auth.userId)
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

  @Put('uploads/:uploadSessionId')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  async uploadBytes(
    @AuthContext() auth: RequestAuthContext,
    @Param('uploadSessionId') uploadSessionId: string,
    @Headers('x-upload-token') uploadToken: string,
    @Headers('content-type') mimeType: string,
    @Headers('content-length') contentLengthHeader: string | undefined,
    @Req() request: Request
  ) {
    if (!uploadToken) {
      throw new BadRequestException('Missing upload token header')
    }

    const parsedMimeType = garmentMimeTypeSchema.safeParse(mimeType)
    if (!parsedMimeType.success) {
      throw new UnsupportedMediaTypeException('UNSUPPORTED_IMAGE_TYPE')
    }

    const rawBody = (request as unknown as { body?: unknown }).body
    const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.alloc(0)
    const contentLength = contentLengthHeader
      ? Number.parseInt(contentLengthHeader, 10)
      : undefined
    if (contentLength !== undefined && contentLength > MAX_GARMENT_IMAGE_BYTES) {
      throw new PayloadTooLargeException('IMAGE_TOO_LARGE')
    }

    await this.wardrobeService.uploadBytes(
      uploadSessionId,
      uploadToken,
      auth.userId,
      auth.role,
      parsedMimeType.data,
      Number.isSafeInteger(contentLength) ? contentLength : undefined,
      bodyBuffer
    )
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

  @Delete('garments/:garmentId')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  async deleteGarment(
    @AuthContext() auth: RequestAuthContext,
    @Param('garmentId') garmentId: string
  ): Promise<void> {
    await this.wardrobeRetentionService.requestDeletion(auth.userId, garmentId)
  }

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

    return suggestGarmentTagsResponseSchema.parse(
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
    @Body() payload: unknown
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

    return updateGarmentTagsResponseSchema.parse(
      await this.wardrobeService.updateGarmentTags(
        auth.userId,
        auth.role,
        parsedPath.data.garmentId,
        parsedBody.data
      )
    )
  }
}
