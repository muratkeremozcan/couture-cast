// Story 5.4 Task 5/6: the palette advisor HTTP surface, mirroring
// wardrobe-silhouette.controller.ts's route shape and premium-theme.controller.ts's
// response-schema-parsing-in-the-handler discipline.
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
  Query,
  Req,
  Res,
  UnsupportedMediaTypeException,
  UseGuards,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { z } from 'zod'
import {
  analyzePaletteInputSchema,
  analyzePaletteResponseSchema,
  commitPaletteSelfieInputSchema,
  createPaletteSelfieUploadUrlInputSchema,
  deletePaletteAdvisorResponseSchema,
  paletteAdvisorProfileResponseSchema,
  paletteSelfieUploadSessionPathParamsSchema,
  setPaletteConsentInputSchema,
  setPaletteConsentResponseSchema,
  updateAdvisorRecommendationInputSchema,
} from '../../contracts/http.js'
import { AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { WardrobeUploadGuard } from '../wardrobe/wardrobe.guard.js'
import { PremiumEntitlementGuard } from './premium-entitlement.guard.js'
import { PaletteAdvisorService } from './palette-advisor.service.js'

const MAX_SELFIE_BYTES = 10_485_760
const selfieMimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp'])

function validationMessage(prefix: string, error: z.ZodError): string {
  const details = error.issues
    .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
    .join('; ')
  return `${prefix}: ${details}`
}

@Controller('api/v1/commerce/premium/palette')
export class PaletteAdvisorController {
  constructor(
    @Inject(PaletteAdvisorService)
    private readonly advisorService: PaletteAdvisorService
  ) {}

  @Get()
  @UseGuards(RequestAuthGuard)
  async getProfile(
    @AuthContext() auth: RequestAuthContext,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Query('locale') requestedLocale: string | undefined
  ) {
    const data = await this.advisorService.getProfile(
      auth.userId,
      acceptLanguage,
      requestedLocale
    )
    return paletteAdvisorProfileResponseSchema.parse({ data })
  }

  /**
   * `@HttpCode(200)` because Nest answers 201 for a `@Post` by default and this
   * route creates nothing a client can address: it flips a persisted consent
   * fact on the caller's single `PaletteProfile` row and answers the same
   * profile shape the `GET` does. The published contract says 200, and Pact
   * caught the mismatch -- 201 here would have told every client that a new
   * resource existed.
   */
  @Post('consent')
  @HttpCode(200)
  @UseGuards(RequestAuthGuard, PremiumEntitlementGuard)
  async setConsent(@AuthContext() auth: RequestAuthContext, @Body() rawBody: unknown) {
    const parsed = setPaletteConsentInputSchema.safeParse(rawBody)
    if (!parsed.success) {
      throw new BadRequestException(
        validationMessage('Invalid consent payload', parsed.error)
      )
    }
    const data = await this.advisorService.setConsent(auth.userId, parsed.data.granted)
    return setPaletteConsentResponseSchema.parse({ data })
  }

  @Post('analyze')
  @HttpCode(202)
  @UseGuards(RequestAuthGuard, PremiumEntitlementGuard)
  async analyze(@AuthContext() auth: RequestAuthContext, @Body() rawBody: unknown) {
    const parsed = analyzePaletteInputSchema.safeParse(rawBody)
    if (!parsed.success) {
      throw new BadRequestException(
        validationMessage('Invalid analyze payload', parsed.error)
      )
    }
    const data = await this.advisorService.analyzeWardrobe(auth.userId)
    return analyzePaletteResponseSchema.parse({ data })
  }

  @Post('selfie/upload-url')
  @HttpCode(201)
  @UseGuards(RequestAuthGuard, PremiumEntitlementGuard, WardrobeUploadGuard)
  async createSelfieUploadUrl(
    @AuthContext() auth: RequestAuthContext,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response
  ) {
    const parsed = createPaletteSelfieUploadUrlInputSchema.safeParse(rawBody)
    if (!parsed.success) {
      throw new BadRequestException(
        validationMessage('Invalid upload declaration', parsed.error)
      )
    }
    const parsedKey = z.string().uuid().safeParse(idempotencyKey)
    if (!parsedKey.success) {
      throw new BadRequestException('INVALID_IDEMPOTENCY_KEY')
    }

    const result = await this.advisorService.createSelfieUploadUrl(
      auth.userId,
      auth.role,
      parsed.data,
      parsedKey.data
    )
    res.status(result.replayed ? 200 : 201)
    return result.response
  }

  @Put('selfie/uploads/:uploadSessionId')
  @HttpCode(204)
  @UseGuards(RequestAuthGuard)
  async uploadSelfieBytes(
    @AuthContext() auth: RequestAuthContext,
    @Param('uploadSessionId') uploadSessionIdParam: string,
    @Headers('x-upload-token') uploadToken: string,
    @Headers('content-type') mimeType: string,
    @Headers('content-length') contentLengthHeader: string | undefined,
    @Req() request: Request
  ) {
    const { uploadSessionId } = paletteSelfieUploadSessionPathParamsSchema.parse({
      uploadSessionId: uploadSessionIdParam,
    })

    if (!uploadToken) {
      throw new BadRequestException('Missing upload token header')
    }
    const parsedMimeType = selfieMimeTypeSchema.safeParse(mimeType)
    if (!parsedMimeType.success) {
      throw new UnsupportedMediaTypeException('UNSUPPORTED_IMAGE_TYPE')
    }

    const rawBody = (request as unknown as { body?: unknown }).body
    const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.alloc(0)
    const contentLength = contentLengthHeader
      ? Number.parseInt(contentLengthHeader, 10)
      : undefined
    if (contentLength !== undefined && contentLength > MAX_SELFIE_BYTES) {
      throw new PayloadTooLargeException('IMAGE_TOO_LARGE')
    }

    await this.advisorService.uploadSelfieBytes(
      uploadSessionId,
      uploadToken,
      auth.userId,
      auth.role,
      parsedMimeType.data,
      Number.isSafeInteger(contentLength) ? contentLength : undefined,
      bodyBuffer
    )
  }

  @Post('selfie/commit')
  @UseGuards(RequestAuthGuard, PremiumEntitlementGuard, WardrobeUploadGuard)
  async commitSelfie(
    @AuthContext() auth: RequestAuthContext,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response
  ) {
    const parsed = commitPaletteSelfieInputSchema.safeParse(rawBody)
    if (!parsed.success) {
      throw new BadRequestException(
        validationMessage('Invalid commit payload', parsed.error)
      )
    }
    const parsedKey = z.string().uuid().safeParse(idempotencyKey)
    if (!parsedKey.success) {
      throw new BadRequestException('INVALID_IDEMPOTENCY_KEY')
    }

    const result = await this.advisorService.commitSelfie(
      auth.userId,
      auth.role,
      parsed.data,
      parsedKey.data
    )
    res.status(result.replayed ? 200 : 201)
    return result.response
  }

  @Put('recommendations')
  @UseGuards(RequestAuthGuard, PremiumEntitlementGuard)
  async updateRecommendation(
    @AuthContext() auth: RequestAuthContext,
    @Body() rawBody: unknown
  ) {
    const parsed = updateAdvisorRecommendationInputSchema.safeParse(rawBody)
    if (!parsed.success) {
      throw new BadRequestException(
        validationMessage('Invalid recommendation payload', parsed.error)
      )
    }
    const data = await this.advisorService.updateRecommendation(auth.userId, parsed.data)
    return paletteAdvisorProfileResponseSchema.parse({ data })
  }

  /**
   * Deliberately NOT entitlement-gated (Decision 7/9): a lapsed subscriber
   * must always be able to erase their data.
   */
  @Delete()
  @UseGuards(RequestAuthGuard)
  async erase(@AuthContext() auth: RequestAuthContext) {
    const data = await this.advisorService.erase(auth.userId)
    return deletePaletteAdvisorResponseSchema.parse({ data })
  }
}
