// Story 4.4 Task 3 + 4: silhouette sliders and "My Form" photo HTTP surface
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
  Res,
  UnsupportedMediaTypeException,
  UseGuards,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { z } from 'zod'
import {
  commitSilhouettePhotoInputSchema,
  createSilhouetteUploadUrlInputSchema,
  silhouetteUploadSessionPathParamsSchema,
  updateSilhouetteSlidersInputSchema,
} from '@couture/api-client/contracts/http'
import { AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { WardrobeUploadGuard } from './wardrobe.guard.js'
import { MAX_SILHOUETTE_PHOTO_BYTES } from './wardrobe-silhouette-image-validation.js'
import {
  formatSilhouetteETag,
  WardrobeSilhouetteService,
} from './wardrobe-silhouette.service.js'

const silhouetteMimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp'])

function validationMessage(prefix: string, error: z.ZodError): string {
  const details = error.issues
    .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
    .join('; ')
  return `${prefix}: ${details}`
}

/**
 * Decision 7: `WardrobeUploadGuard` applies class-level, exactly like
 * `WardrobeController`, so slider reads/writes are gated the same as My
 * Form routes -- not only upload-url/commit. `Cache-Control` is applied by
 * `CapsuleCacheHeadersMiddleware` in `wardrobe.module.ts` (reused as-is)
 * so it survives guard- and validation-raised error responses too.
 */
@Controller('api/v1/wardrobe/silhouette')
@UseGuards(RequestAuthGuard, WardrobeUploadGuard)
export class WardrobeSilhouetteController {
  constructor(
    @Inject(WardrobeSilhouetteService)
    private readonly silhouetteService: WardrobeSilhouetteService
  ) {}

  @Get()
  async getProfile(
    @AuthContext() auth: RequestAuthContext,
    @Res({ passthrough: true }) res: Response
  ) {
    const { response, etag } = await this.silhouetteService.getProfile(auth.userId)
    res.setHeader('ETag', etag)
    return response
  }

  @Put()
  async updateSliders(
    @AuthContext() auth: RequestAuthContext,
    @Headers('if-match') ifMatchHeader: string | undefined,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response
  ) {
    const input = updateSilhouetteSlidersInputSchema.parse(rawBody)
    const { response } = await this.silhouetteService.updateSliders(
      auth.userId,
      ifMatchHeader,
      input
    )
    res.setHeader('ETag', formatSilhouetteETag(auth.userId, response.data.revision))
    return response
  }

  @Post('my-form/upload-url')
  @HttpCode(201)
  async createMyFormUploadUrl(
    @AuthContext() auth: RequestAuthContext,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response
  ) {
    const parsed = createSilhouetteUploadUrlInputSchema.safeParse(rawBody)
    if (!parsed.success) {
      throw new BadRequestException(
        validationMessage('Invalid upload declaration', parsed.error)
      )
    }
    const parsedKey = z.string().uuid().safeParse(idempotencyKey)
    if (!parsedKey.success) {
      throw new BadRequestException('INVALID_IDEMPOTENCY_KEY')
    }

    const result = await this.silhouetteService.createMyFormUploadUrl(
      auth.userId,
      auth.role,
      parsed.data,
      parsedKey.data
    )
    res.status(result.replayed ? 200 : 201)
    return result.response
  }

  @Put('my-form/uploads/:uploadSessionId')
  @HttpCode(204)
  async uploadMyFormBytes(
    @AuthContext() auth: RequestAuthContext,
    @Param('uploadSessionId') uploadSessionIdParam: string,
    @Headers('x-upload-token') uploadToken: string,
    @Headers('content-type') mimeType: string,
    @Headers('content-length') contentLengthHeader: string | undefined,
    @Req() request: Request
  ) {
    const { uploadSessionId } = silhouetteUploadSessionPathParamsSchema.parse({
      uploadSessionId: uploadSessionIdParam,
    })

    if (!uploadToken) {
      throw new BadRequestException('Missing upload token header')
    }
    const parsedMimeType = silhouetteMimeTypeSchema.safeParse(mimeType)
    if (!parsedMimeType.success) {
      throw new UnsupportedMediaTypeException('UNSUPPORTED_IMAGE_TYPE')
    }

    const rawBody = (request as unknown as { body?: unknown }).body
    const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.alloc(0)
    const contentLength = contentLengthHeader
      ? Number.parseInt(contentLengthHeader, 10)
      : undefined
    if (contentLength !== undefined && contentLength > MAX_SILHOUETTE_PHOTO_BYTES) {
      throw new PayloadTooLargeException('IMAGE_TOO_LARGE')
    }

    await this.silhouetteService.uploadMyFormBytes(
      uploadSessionId,
      uploadToken,
      auth.userId,
      auth.role,
      parsedMimeType.data,
      Number.isSafeInteger(contentLength) ? contentLength : undefined,
      bodyBuffer
    )
  }

  @Post('my-form/commit')
  async commitMyForm(
    @AuthContext() auth: RequestAuthContext,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response
  ) {
    const input = commitSilhouettePhotoInputSchema.parse(rawBody)
    const parsedKey = z.string().uuid().safeParse(idempotencyKey)
    if (!parsedKey.success) {
      throw new BadRequestException('INVALID_IDEMPOTENCY_KEY')
    }

    const result = await this.silhouetteService.commitMyForm(
      auth.userId,
      auth.role,
      input,
      parsedKey.data
    )
    res.setHeader(
      'ETag',
      formatSilhouetteETag(auth.userId, result.response.data.revision)
    )
    res.status(result.replayed ? 200 : 201)
    return result.response
  }

  @Delete('my-form')
  async deleteMyForm(
    @AuthContext() auth: RequestAuthContext,
    @Headers('if-match') ifMatchHeader: string | undefined,
    @Res({ passthrough: true }) res: Response
  ) {
    const { response } = await this.silhouetteService.deleteMyForm(
      auth.userId,
      ifMatchHeader
    )
    res.setHeader('ETag', formatSilhouetteETag(auth.userId, response.data.revision))
    return response
  }
}
