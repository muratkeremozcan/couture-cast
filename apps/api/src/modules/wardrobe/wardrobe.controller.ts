// Story 4.1 Task 5 step 1 owner: expose Wardrobe API endpoints for upload url allocation, binary upload relay, and garment commit
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import {
  createGarmentItemInputSchema,
  createGarmentUploadUrlInputSchema,
} from '@couture/api-client/contracts/http'
import { AuthContext } from '../auth/security.decorators'
import { RequestAuthGuard } from '../auth/security.guards'
import type { RequestAuthContext } from '../auth/security.types'
import { WardrobeUploadGuard } from './wardrobe.guard'
import { WardrobeService } from './wardrobe.service'

@Controller('/api/v1/wardrobe')
@UseGuards(RequestAuthGuard, WardrobeUploadGuard)
export class WardrobeController {
  constructor(
    @Inject(WardrobeService) private readonly wardrobeService: WardrobeService
  ) {}

  @Post('upload-url')
  @HttpCode(201)
  async createUploadUrl(
    @AuthContext() auth: RequestAuthContext,
    @Body() payload: unknown,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    const parsed = createGarmentUploadUrlInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new BadRequestException('Invalid upload declaration')
    }

    return this.wardrobeService.createUploadUrl(auth.userId, parsed.data, idempotencyKey)
  }

  @Put('uploads/:uploadSessionId')
  @HttpCode(204)
  async uploadBytes(
    @AuthContext() auth: RequestAuthContext,
    @Param('uploadSessionId') uploadSessionId: string,
    @Headers('x-upload-token') uploadToken: string,
    @Headers('content-type') mimeType: string,
    @Req() request: Request
  ) {
    if (!uploadToken) {
      throw new BadRequestException('Missing upload token header')
    }

    const rawBody =
      (request as unknown as { rawBody?: Buffer }).rawBody ??
      (request as unknown as { body: Buffer }).body
    const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '')

    await this.wardrobeService.uploadBytes(
      uploadSessionId,
      uploadToken,
      auth.userId,
      mimeType,
      bodyBuffer
    )
  }

  @Post('garments')
  @HttpCode(201)
  async commitGarment(
    @AuthContext() auth: RequestAuthContext,
    @Body() payload: unknown,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    const parsed = createGarmentItemInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new BadRequestException('Invalid garment commit payload')
    }

    return this.wardrobeService.commitGarment(auth.userId, parsed.data, idempotencyKey)
  }
}
