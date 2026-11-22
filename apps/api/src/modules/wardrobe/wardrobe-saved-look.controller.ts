// Story CC-7.2: Account-backed saved looks REST controller.
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import { z } from 'zod'
import {
  createSavedLookInputSchema,
  listSavedLooksQuerySchema,
  savedLookIdPathParamsSchema,
} from '@couture/api-client/contracts/http'
import { AllowPendingGuardianTeen } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { AuthenticatedRequest } from '../auth/security.types.js'
import {
  formatSavedLookETag,
  WardrobeSavedLookService,
} from './wardrobe-saved-look.service.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseIdempotencyKey(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined
  }
  const value = header.trim()
  if (value.length === 0) {
    throw new BadRequestException('Idempotency-Key must not be empty when supplied')
  }
  if (!UUID_V4.test(value)) {
    throw new BadRequestException('Idempotency-Key must be a UUID v4')
  }
  return value
}

function formatZodBadRequest(prefix: string, error: z.ZodError): BadRequestException {
  const details = error.issues
    .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
    .join('; ')
  return new BadRequestException(`${prefix}: ${details}`)
}

function applyETag(res: Response, savedLookId: string, revision: number): void {
  res.setHeader('ETag', formatSavedLookETag(savedLookId, revision))
}

@Controller('api/v1/wardrobe/saved-looks')
@UseGuards(RequestAuthGuard)
@AllowPendingGuardianTeen()
export class WardrobeSavedLookController {
  constructor(
    @Inject(WardrobeSavedLookService)
    private readonly savedLookService: WardrobeSavedLookService
  ) {}

  @Post()
  async createSavedLook(
    @Req() req: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response
  ) {
    if (!req.auth) {
      throw new UnauthorizedException('Missing or invalid bearer token')
    }

    const parsedBody = createSavedLookInputSchema.safeParse(rawBody)
    if (!parsedBody.success) {
      throw formatZodBadRequest('Invalid saved look payload', parsedBody.error)
    }

    const parsedKey = parseIdempotencyKey(idempotencyKey)
    const result = await this.savedLookService.createSavedLook(
      req.auth,
      parsedBody.data,
      parsedKey
    )

    applyETag(res, result.data.id, result.data.revision)
    res.status(result.isReplay ? HttpStatus.OK : HttpStatus.CREATED)
    return { data: result.data }
  }

  @Get()
  async listSavedLooks(@Req() req: AuthenticatedRequest, @Query() rawQuery: unknown) {
    if (!req.auth) {
      throw new UnauthorizedException('Missing or invalid bearer token')
    }

    const parsedQuery = listSavedLooksQuerySchema.safeParse(rawQuery)
    if (!parsedQuery.success) {
      throw formatZodBadRequest('Invalid saved look query', parsedQuery.error)
    }

    return this.savedLookService.listSavedLooks(req.auth, parsedQuery.data)
  }

  @Get(':savedLookId')
  async getSavedLook(
    @Req() req: AuthenticatedRequest,
    @Param('savedLookId') savedLookIdParam: string,
    @Res({ passthrough: true }) res: Response
  ) {
    if (!req.auth) {
      throw new UnauthorizedException('Missing or invalid bearer token')
    }

    const parsedParams = savedLookIdPathParamsSchema.safeParse({
      savedLookId: savedLookIdParam,
    })
    if (!parsedParams.success) {
      throw formatZodBadRequest('Invalid saved look id', parsedParams.error)
    }

    const result = await this.savedLookService.getSavedLook(
      req.auth,
      parsedParams.data.savedLookId
    )
    applyETag(res, result.data.id, result.data.revision)
    return result
  }

  @Delete(':savedLookId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSavedLook(
    @Req() req: AuthenticatedRequest,
    @Param('savedLookId') savedLookIdParam: string,
    @Headers('if-match') ifMatchHeader: string | undefined
  ): Promise<void> {
    if (!req.auth) {
      throw new UnauthorizedException('Missing or invalid bearer token')
    }

    const parsedParams = savedLookIdPathParamsSchema.safeParse({
      savedLookId: savedLookIdParam,
    })
    if (!parsedParams.success) {
      throw formatZodBadRequest('Invalid saved look id', parsedParams.error)
    }

    await this.savedLookService.deleteSavedLook(
      req.auth,
      parsedParams.data.savedLookId,
      ifMatchHeader
    )
  }
}
