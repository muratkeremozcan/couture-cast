import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import {
  allocateCommunityPostInputSchema,
  allocateCommunityPostResponseSchema,
  communityChallengeResponseSchema,
  communityFeedQuerySchema,
  communityFeedResponseSchema,
  communityHeadersSchema,
  communityPostResponseSchema,
  createCommunityChallengeInputSchema,
  publishCommunityPostInputSchema,
  publishCommunityPostResponseSchema,
  reportCommunityPostInputSchema,
  reportCommunityPostResponseSchema,
  updateCommunityChallengeInputSchema,
  withdrawCommunityPostResponseSchema,
  type AllocateCommunityPostResponse,
  type CommunityChallengeResponse,
  type CommunityFeedResponse,
  type CommunityPostResponse,
  type PublishCommunityPostResponse,
  type ReportCommunityPostResponse,
  type WithdrawCommunityPostResponse,
} from '@couture/api-client/contracts/http'
import { AuthContext, Roles } from '../auth/security.decorators.js'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { CommunityRateLimitException } from './community-rate-limit.exception.js'
import { CommunityService } from './community.service.js'

/**
 * Runs `work` and, if it is refused by a rolling-window limiter, stamps
 * `Retry-After` on the response before letting the exception continue to the
 * global `ApiExceptionFilter`.
 *
 * `passthrough: true` keeps Nest in charge of serialising the response, so the
 * error envelope and the `api_error_occurred` telemetry the global filter
 * records are both preserved; only the header is added here.
 */
async function withRetryAfterHeader<T>(
  response: Response,
  work: () => Promise<T>
): Promise<T> {
  try {
    return await work()
  } catch (error: unknown) {
    if (error instanceof CommunityRateLimitException) {
      response.setHeader('Retry-After', String(error.retryAfterSeconds))
    }
    throw error
  }
}

@Controller('/api/v1/community')
@UseGuards(RequestAuthGuard)
export class CommunityController {
  constructor(
    @Inject(CommunityService)
    private readonly communityService: CommunityService
  ) {}

  @Get('feed')
  async getFeed(
    @AuthContext() auth: RequestAuthContext,
    @Headers('x-couture-platform') platformHeader: string | undefined,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Query() rawQuery: Record<string, unknown>
  ): Promise<CommunityFeedResponse> {
    const headersResult = communityHeadersSchema.safeParse({
      'x-couture-platform': platformHeader,
    })
    if (!headersResult.success) {
      throw new BadRequestException(
        headersResult.error.issues.map((i) => i.message).join('; ')
      )
    }

    const queryResult = communityFeedQuerySchema.safeParse(rawQuery)
    if (!queryResult.success) {
      throw new BadRequestException(
        queryResult.error.issues.map((i) => i.message).join('; ')
      )
    }

    const { mode, cursor, limit } = queryResult.data

    const data = await this.communityService.getFeed({
      userId: auth.userId,
      platform: headersResult.data['x-couture-platform'],
      mode,
      cursor,
      limit,
      acceptLanguage,
    })

    return communityFeedResponseSchema.parse({ data })
  }

  /**
   * Resolves one post directly. A deep link outside the first page and an
   * author polling their own post until it reaches a terminal state both land
   * here rather than walking the feed.
   */
  @Get('posts/:postId')
  async getPost(
    @AuthContext() auth: RequestAuthContext,
    @Param('postId') postId: string,
    @Headers('x-couture-platform') platformHeader: string | undefined
  ): Promise<CommunityPostResponse> {
    const headersResult = communityHeadersSchema.safeParse({
      'x-couture-platform': platformHeader,
    })
    if (!headersResult.success) {
      throw new BadRequestException(
        headersResult.error.issues.map((i) => i.message).join('; ')
      )
    }

    const data = await this.communityService.getPost({
      userId: auth.userId,
      postId,
    })

    return communityPostResponseSchema.parse({ data })
  }

  @Post('posts/allocate')
  @HttpCode(200)
  async allocatePost(
    @AuthContext() auth: RequestAuthContext,
    @Headers('x-couture-platform') platformHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) response: Response
  ): Promise<AllocateCommunityPostResponse> {
    const headersResult = communityHeadersSchema.safeParse({
      'x-couture-platform': platformHeader,
    })
    if (!headersResult.success) {
      throw new BadRequestException(
        headersResult.error.issues.map((i) => i.message).join('; ')
      )
    }

    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header is required')
    }

    const bodyResult = allocateCommunityPostInputSchema.safeParse(rawBody)
    if (!bodyResult.success) {
      throw new BadRequestException(
        bodyResult.error.issues.map((i) => i.message).join('; ')
      )
    }

    const data = await withRetryAfterHeader(response, () =>
      this.communityService.allocatePost({
        userId: auth.userId,
        role: auth.role,
        idempotencyKey: idempotencyKey.trim(),
        platform: headersResult.data['x-couture-platform'],
        input: bodyResult.data,
      })
    )

    return allocateCommunityPostResponseSchema.parse({ data })
  }

  @Post('posts/publish')
  @HttpCode(200)
  async publishPost(
    @AuthContext() auth: RequestAuthContext,
    @Headers('x-couture-platform') platformHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) response: Response
  ): Promise<PublishCommunityPostResponse> {
    const headersResult = communityHeadersSchema.safeParse({
      'x-couture-platform': platformHeader,
    })
    if (!headersResult.success) {
      throw new BadRequestException(
        headersResult.error.issues.map((i) => i.message).join('; ')
      )
    }

    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header is required')
    }

    const bodyResult = publishCommunityPostInputSchema.safeParse(rawBody)
    if (!bodyResult.success) {
      throw new BadRequestException(
        bodyResult.error.issues.map((i) => i.message).join('; ')
      )
    }

    const data = await withRetryAfterHeader(response, () =>
      this.communityService.publishPost({
        userId: auth.userId,
        role: auth.role,
        platform: headersResult.data['x-couture-platform'],
        input: bodyResult.data,
      })
    )

    return publishCommunityPostResponseSchema.parse({ data })
  }

  @Post('posts/:postId/report')
  @HttpCode(200)
  async reportPost(
    @AuthContext() auth: RequestAuthContext,
    @Param('postId') postId: string,
    @Headers('x-couture-platform') platformHeader: string | undefined,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) response: Response
  ): Promise<ReportCommunityPostResponse> {
    const headersResult = communityHeadersSchema.safeParse({
      'x-couture-platform': platformHeader,
    })
    if (!headersResult.success) {
      throw new BadRequestException(
        headersResult.error.issues.map((i) => i.message).join('; ')
      )
    }

    const bodyResult = reportCommunityPostInputSchema.safeParse(rawBody)
    if (!bodyResult.success) {
      throw new BadRequestException(
        bodyResult.error.issues.map((i) => i.message).join('; ')
      )
    }

    const result = await withRetryAfterHeader(response, () =>
      this.communityService.reportPost({
        userId: auth.userId,
        postId,
        platform: headersResult.data['x-couture-platform'],
        input: bodyResult.data,
      })
    )

    return reportCommunityPostResponseSchema.parse(result)
  }

  @Post('posts/:postId/withdraw')
  @HttpCode(200)
  async withdrawPost(
    @AuthContext() auth: RequestAuthContext,
    @Param('postId') postId: string,
    @Headers('x-couture-platform') platformHeader: string | undefined
  ): Promise<WithdrawCommunityPostResponse> {
    const headersResult = communityHeadersSchema.safeParse({
      'x-couture-platform': platformHeader,
    })
    if (!headersResult.success) {
      throw new BadRequestException(
        headersResult.error.issues.map((i) => i.message).join('; ')
      )
    }

    const result = await this.communityService.withdrawPost({
      userId: auth.userId,
      postId,
      platform: headersResult.data['x-couture-platform'],
    })

    return withdrawCommunityPostResponseSchema.parse(result)
  }

  @Post('challenges')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles('admin')
  async createChallenge(@Body() rawBody: unknown): Promise<CommunityChallengeResponse> {
    const bodyResult = createCommunityChallengeInputSchema.safeParse(rawBody)
    if (!bodyResult.success) {
      throw new BadRequestException(
        bodyResult.error.issues.map((i) => i.message).join('; ')
      )
    }

    const data = await this.communityService.createChallenge(bodyResult.data)
    return communityChallengeResponseSchema.parse({ data })
  }

  @Patch('challenges/:id')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles('admin')
  async updateChallenge(
    @Param('id') id: string,
    @Body() rawBody: unknown
  ): Promise<CommunityChallengeResponse> {
    const bodyResult = updateCommunityChallengeInputSchema.safeParse(rawBody)
    if (!bodyResult.success) {
      throw new BadRequestException(
        bodyResult.error.issues.map((i) => i.message).join('; ')
      )
    }

    const data = await this.communityService.updateChallenge(id, bodyResult.data)
    return communityChallengeResponseSchema.parse({ data })
  }
}
