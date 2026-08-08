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
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import {
  capsuleIdPathParamsSchema,
  createOutfitCapsuleInputSchema,
  favoriteOutfitCapsuleInputSchema,
  listOutfitCapsulesQuerySchema,
  ownerUserIdPathParamsSchema,
  updateOutfitCapsuleInputSchema,
} from '@couture/api-client'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { AuthenticatedRequest } from '../auth/security.types.js'
import { formatCapsuleETag, WardrobeCapsuleService } from './wardrobe-capsule.service.js'

/**
 * `Cache-Control` is applied by {@link CapsuleCacheHeadersMiddleware} so that it
 * survives error paths. Only the entity tag is set here, because it is knowable
 * solely from a successful result.
 */
function applyETag(res: Response, capsuleId: string, revision: number): void {
  res.setHeader('ETag', formatCapsuleETag(capsuleId, revision))
}

/**
 * `Idempotency-Key` is optional, but when supplied it must be a UUID v4. The
 * value is persisted under a unique constraint, so an unvalidated header would
 * let an arbitrary caller-chosen string become a durable key.
 */
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

@Controller('api/v1/wardrobe/:ownerUserId/capsules')
@UseGuards(RequestAuthGuard)
export class WardrobeCapsuleController {
  constructor(
    @Inject(WardrobeCapsuleService)
    private readonly capsuleService: WardrobeCapsuleService
  ) {}

  @Post()
  async createCapsule(
    @Req() req: AuthenticatedRequest,
    @Param('ownerUserId') ownerUserIdParam: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response
  ) {
    if (!req.auth) {
      throw new UnauthorizedException('Missing or invalid bearer token')
    }

    const { ownerUserId } = ownerUserIdPathParamsSchema.parse({
      ownerUserId: ownerUserIdParam,
    })
    const body = createOutfitCapsuleInputSchema.parse(rawBody)

    const result = await this.capsuleService.createCapsule(
      req.auth,
      ownerUserId,
      body,
      parseIdempotencyKey(idempotencyKey)
    )

    applyETag(res, result.data.id, result.data.revision)
    res.status(result.isReplay ? HttpStatus.OK : HttpStatus.CREATED)
    /**
     * `isReplay` is transport metadata expressed by the status code, not part of
     * the response contract. Returning it would violate the strict response
     * schema that clients parse against.
     */
    return { data: result.data }
  }

  @Get()
  async listCapsules(
    @Req() req: AuthenticatedRequest,
    @Param('ownerUserId') ownerUserIdParam: string,
    @Query() rawQuery: unknown
  ) {
    if (!req.auth) {
      throw new UnauthorizedException('Missing or invalid bearer token')
    }

    const { ownerUserId } = ownerUserIdPathParamsSchema.parse({
      ownerUserId: ownerUserIdParam,
    })
    const query = listOutfitCapsulesQuerySchema.parse(rawQuery)

    const result = await this.capsuleService.listCapsules(req.auth, ownerUserId, query)

    return result
  }

  @Get(':capsuleId')
  async getCapsule(
    @Req() req: AuthenticatedRequest,
    @Param('ownerUserId') ownerUserIdParam: string,
    @Param('capsuleId') capsuleIdParam: string,
    @Res({ passthrough: true }) res: Response
  ) {
    if (!req.auth) {
      throw new UnauthorizedException('Missing or invalid bearer token')
    }

    const { ownerUserId, capsuleId } = capsuleIdPathParamsSchema.parse({
      ownerUserId: ownerUserIdParam,
      capsuleId: capsuleIdParam,
    })

    const result = await this.capsuleService.getCapsule(req.auth, ownerUserId, capsuleId)

    applyETag(res, result.data.id, result.data.revision)
    return result
  }

  @Patch(':capsuleId')
  async updateCapsule(
    @Req() req: AuthenticatedRequest,
    @Param('ownerUserId') ownerUserIdParam: string,
    @Param('capsuleId') capsuleIdParam: string,
    @Headers('if-match') ifMatchHeader: string | undefined,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response
  ) {
    if (!req.auth) {
      throw new UnauthorizedException('Missing or invalid bearer token')
    }

    const { ownerUserId, capsuleId } = capsuleIdPathParamsSchema.parse({
      ownerUserId: ownerUserIdParam,
      capsuleId: capsuleIdParam,
    })
    const body = updateOutfitCapsuleInputSchema.parse(rawBody)

    const result = await this.capsuleService.updateCapsule(
      req.auth,
      ownerUserId,
      capsuleId,
      ifMatchHeader,
      body
    )

    applyETag(res, result.data.id, result.data.revision)
    return result
  }

  @Patch(':capsuleId/favorite')
  async setFavoriteStatus(
    @Req() req: AuthenticatedRequest,
    @Param('ownerUserId') ownerUserIdParam: string,
    @Param('capsuleId') capsuleIdParam: string,
    @Headers('if-match') ifMatchHeader: string | undefined,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response
  ) {
    if (!req.auth) {
      throw new UnauthorizedException('Missing or invalid bearer token')
    }

    const { ownerUserId, capsuleId } = capsuleIdPathParamsSchema.parse({
      ownerUserId: ownerUserIdParam,
      capsuleId: capsuleIdParam,
    })
    const body = favoriteOutfitCapsuleInputSchema.parse(rawBody)

    const result = await this.capsuleService.setFavoriteStatus(
      req.auth,
      ownerUserId,
      capsuleId,
      ifMatchHeader,
      body
    )

    applyETag(res, result.data.id, result.data.revision)
    return result
  }

  @Delete(':capsuleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCapsule(
    @Req() req: AuthenticatedRequest,
    @Param('ownerUserId') ownerUserIdParam: string,
    @Param('capsuleId') capsuleIdParam: string,
    @Headers('if-match') ifMatchHeader: string | undefined
  ) {
    if (!req.auth) {
      throw new UnauthorizedException('Missing or invalid bearer token')
    }

    const { ownerUserId, capsuleId } = capsuleIdPathParamsSchema.parse({
      ownerUserId: ownerUserIdParam,
      capsuleId: capsuleIdParam,
    })

    await this.capsuleService.deleteCapsule(
      req.auth,
      ownerUserId,
      capsuleId,
      ifMatchHeader
    )
  }
}
