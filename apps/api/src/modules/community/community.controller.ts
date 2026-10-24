import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Header,
  Put,
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
  communityReactionFeedResponseSchema,
  communityReactionPostResponseSchema,
  communityReactionResponseSchema,
  setCommunityReactionInputSchema,
  type CommunityReactionResponse,
  communityHeadersSchema,
  communityPostResponseSchema,
  createCommunityChallengeInputSchema,
  publishCommunityPostInputSchema,
  publishCommunityPostResponseSchema,
  openCommunityPostInputSchema,
  openCommunityPostResponseSchema,
  isSpotlightOpenInput,
  communitySpotlightQuerySchema,
  communitySpotlightResponseSchema,
  communityReactionSpotlightResponseSchema,
  communitySponsoredFeedResponseSchema,
  communitySponsoredPostResponseSchema,
  communitySponsoredSpotlightResponseSchema,
  COMMUNITY_SPONSORSHIP_HEADER,
  type CommunitySponsorship,
  type CommunitySpotlightResponse,
  reportCommunityPostInputSchema,
  reportCommunityPostResponseSchema,
  updateCommunityChallengeInputSchema,
  withdrawCommunityPostResponseSchema,
  type AllocateCommunityPostResponse,
  type CommunityChallengeResponse,
  type CommunityFeedResponse,
  type CommunityPostResponse,
  type OpenCommunityPostResponse,
  type PublishCommunityPostResponse,
  type ReportCommunityPostResponse,
  type WithdrawCommunityPostResponse,
} from '@couture/api-client/contracts/http'
import {
  AuthContext,
  Roles,
  ConsentCheckedInTransaction,
} from '../auth/security.decorators.js'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { CommunitySponsorshipService } from '../commerce/community-sponsorship.service.js'
import { CommunityRateLimitException } from './community-rate-limit.exception.js'
import { CommunityService } from './community.service.js'
import { CommunitySpotlightService } from './community-spotlight.service.js'

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

/**
 * Story 6.7b: every public community read negotiates the sponsorship block with
 * this header and must say so to caches.
 */
const COMMUNITY_READ_VARY =
  'x-couture-reactions, x-couture-sponsorship, x-couture-platform, Authorization'

type WithSponsorship<T> = T & { sponsorship?: CommunitySponsorship }

@Controller('/api/v1/community')
@UseGuards(RequestAuthGuard)
export class CommunityController {
  constructor(
    @Inject(CommunityService)
    private readonly communityService: CommunityService,
    @Inject(CommunitySpotlightService)
    private readonly spotlightService: CommunitySpotlightService,
    @Inject(CommunitySponsorshipService)
    private readonly sponsorships: CommunitySponsorshipService
  ) {}

  /**
   * Story 6.7b: attaches the per-viewer sponsorship block to items that have
   * one, after the community read (and so after the spotlight read model) has
   * produced them. The service fails closed, so a sponsorship fault never fails
   * the read; it only removes the blocks.
   */
  private async attachSponsorships<T extends { id: string }>(
    items: readonly T[],
    userId: string,
    acceptLanguage: string | undefined
  ): Promise<WithSponsorship<T>[]> {
    const blocks = await this.sponsorships.resolveForPosts({
      userId,
      postIds: items.map((item) => item.id),
      acceptLanguage,
    })
    return items.map((item) => {
      const sponsorship = blocks.get(item.id)
      return sponsorship ? { ...item, sponsorship } : item
    })
  }

  @Get('feed')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', COMMUNITY_READ_VARY)
  async getFeed(
    @AuthContext() auth: RequestAuthContext,
    @Headers('x-couture-platform') platformHeader: string | undefined,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Query() rawQuery: Record<string, unknown>,
    @Headers('x-couture-reactions') reactionsHeader?: string,
    @Headers(COMMUNITY_SPONSORSHIP_HEADER) sponsorshipHeader?: string
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
      ...(reactionsHeader === '1' ? { reactions: true } : {}),
    })

    if (sponsorshipHeader === '1') {
      return communitySponsoredFeedResponseSchema.parse({
        data: {
          ...data,
          items: await this.attachSponsorships(data.items, auth.userId, acceptLanguage),
        },
      })
    }

    return (
      reactionsHeader === '1'
        ? communityReactionFeedResponseSchema
        : communityFeedResponseSchema
    ).parse({ data })
  }

  /**
   * Story 6.6: the City Spotlight. Reaction summaries negotiate exactly like
   * the feed and are always computed live; responses are never cached.
   */
  @Get('spotlight')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', COMMUNITY_READ_VARY)
  async getSpotlight(
    @AuthContext() auth: RequestAuthContext,
    @Headers('x-couture-platform') platformHeader: string | undefined,
    @Query() rawQuery: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
    @Headers('x-couture-reactions') reactionsHeader?: string,
    @Headers('accept-language') acceptLanguage?: string,
    @Headers(COMMUNITY_SPONSORSHIP_HEADER) sponsorshipHeader?: string
  ): Promise<CommunitySpotlightResponse> {
    const headersResult = communityHeadersSchema.safeParse({
      'x-couture-platform': platformHeader,
    })
    if (!headersResult.success) {
      throw new BadRequestException(
        headersResult.error.issues.map((i) => i.message).join('; ')
      )
    }
    const queryResult = communitySpotlightQuerySchema.safeParse(rawQuery)
    if (!queryResult.success) {
      throw new BadRequestException(
        queryResult.error.issues.map((i) => i.message).join('; ')
      )
    }
    const reactions = reactionsHeader === '1'
    const data = await withRetryAfterHeader(response, () =>
      this.spotlightService.getSpotlight({
        userId: auth.userId,
        platform: headersResult.data['x-couture-platform'],
        cursor: queryResult.data.cursor,
        limit: queryResult.data.limit,
        surface: queryResult.data.surface,
        ...(reactions ? { reactions: true } : {}),
      })
    )
    if (sponsorshipHeader === '1') {
      return communitySponsoredSpotlightResponseSchema.parse({
        data: {
          ...data,
          items: await this.attachSponsorships(data.items, auth.userId, acceptLanguage),
        },
      })
    }
    return (
      reactions
        ? communityReactionSpotlightResponseSchema
        : communitySpotlightResponseSchema
    ).parse({ data })
  }

  /**
   * Resolves one post directly. A deep link outside the first page and an
   * author polling their own post until it reaches a terminal state both land
   * here rather than walking the feed.
   */
  @Get('posts/:postId')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', COMMUNITY_READ_VARY)
  async getPost(
    @AuthContext() auth: RequestAuthContext,
    @Param('postId') postId: string,
    @Headers('x-couture-platform') platformHeader: string | undefined,
    @Headers('x-couture-reactions') reactionsHeader?: string,
    @Headers('accept-language') acceptLanguage?: string,
    @Headers(COMMUNITY_SPONSORSHIP_HEADER) sponsorshipHeader?: string
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
      ...(reactionsHeader === '1' ? { reactions: true } : {}),
    })

    if (sponsorshipHeader === '1') {
      const [item] = await this.attachSponsorships([data], auth.userId, acceptLanguage)
      return communitySponsoredPostResponseSchema.parse({ data: item })
    }

    return (
      reactionsHeader === '1'
        ? communityReactionPostResponseSchema
        : communityPostResponseSchema
    ).parse({ data })
  }

  @Put('posts/:postId/reaction')
  @ConsentCheckedInTransaction()
  @Header('Cache-Control', 'private, no-store')
  async setReaction(
    @AuthContext() auth: RequestAuthContext,
    @Param('postId') postId: string,
    @Headers('x-couture-platform') platformHeader: string | undefined,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) response: Response
  ): Promise<CommunityReactionResponse> {
    const headers = communityHeadersSchema.safeParse({
      'x-couture-platform': platformHeader,
    })
    const input = setCommunityReactionInputSchema.safeParse(rawBody)
    if (!headers.success || !input.success)
      throw new BadRequestException('Invalid reaction request.')
    return withRetryAfterHeader(response, async () =>
      communityReactionResponseSchema.parse({
        data: await this.communityService.setReaction({
          userId: auth.userId,
          postId,
          input: input.data,
          platform: headers.data['x-couture-platform'],
        }),
      })
    )
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

  /**
   * Records a card open.
   *
   * The event this writes is the ONLY input to AC7's advance condition, a 10%
   * relative non-self card-open lift, and until this route existed nothing could
   * emit it: eight endpoints were registered and none was card-open, so the beta
   * gate was unmeasurable at any traffic volume.
   *
   * Read-gated rather than write-gated. Opening a card is reading the feed, and
   * a viewer browsing during a posting freeze still generates the measurement
   * the freeze is being evaluated against.
   *
   * There is no 403 on this path by design. Any viewer may open any post they
   * can see, and a post they cannot see answers 404, so a 403 would confirm that
   * a hidden post exists.
   */
  @Post('posts/:postId/opened')
  @HttpCode(200)
  async openPost(
    @AuthContext() auth: RequestAuthContext,
    @Param('postId') postId: string,
    @Headers('x-couture-platform') platformHeader: string | undefined,
    @Body() rawBody: unknown
  ): Promise<OpenCommunityPostResponse> {
    const headersResult = communityHeadersSchema.safeParse({
      'x-couture-platform': platformHeader,
    })
    if (!headersResult.success) {
      throw new BadRequestException(
        headersResult.error.issues.map((i) => i.message).join('; ')
      )
    }

    const bodyResult = openCommunityPostInputSchema.safeParse(rawBody)
    if (!bodyResult.success) {
      throw new BadRequestException(
        bodyResult.error.issues.map((i) => i.message).join('; ')
      )
    }

    const input = bodyResult.data
    const result = isSpotlightOpenInput(input)
      ? await this.spotlightService.recordOpened({
          userId: auth.userId,
          postId,
          platform: headersResult.data['x-couture-platform'],
          surface: input.surface,
          rank: input.rank,
          level: input.level,
        })
      : await this.communityService.recordCardOpened({
          userId: auth.userId,
          postId,
          platform: headersResult.data['x-couture-platform'],
          input,
        })

    return openCommunityPostResponseSchema.parse(result)
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
