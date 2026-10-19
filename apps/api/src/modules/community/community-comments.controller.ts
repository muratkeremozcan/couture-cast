// Story 6.4 owner: validated independent comment routes.
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import type { z } from 'zod'
import {
  communityHeadersSchema,
  communityCommentsQuerySchema,
  communityCommentsResponseSchema,
  communityCommentSubmissionResponseSchema,
  communityCommentSubmissionsResponseSchema,
  createCommunityCommentInputSchema,
  reportCommunityCommentInputSchema,
  reportCommunityCommentResponseSchema,
} from '@couture/api-client/contracts/http'
import { AuthContext, ConsentCheckedInTransaction } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { CommunityRateLimitException } from './community-rate-limit.exception.js'
import { CommunityCommentsService } from './community-comments.service.js'

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success)
    throw new BadRequestException(
      result.error.issues.map((issue) => issue.message).join('; ')
    )
  return result.data
}
function platform(header: string | undefined) {
  return parse(communityHeadersSchema, { 'x-couture-platform': header })[
    'x-couture-platform'
  ]
}
async function limited<T>(response: Response, work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof CommunityRateLimitException)
      response.setHeader('Retry-After', error.retryAfterSeconds)
    throw error
  }
}

@Controller('/api/v1/community/posts/:postId')
@UseGuards(RequestAuthGuard)
export class CommunityCommentsController {
  constructor(
    @Inject(CommunityCommentsService) private readonly comments: CommunityCommentsService
  ) {}

  @Get('comments')
  @ConsentCheckedInTransaction()
  @Header('Cache-Control', 'private, no-store')
  async roots(
    @AuthContext() auth: RequestAuthContext,
    @Param('postId') postId: string,
    @Headers('x-couture-platform') header: string | undefined,
    @Query() query: unknown
  ) {
    platform(header)
    const data = await this.comments.list({
      userId: auth.userId,
      postId,
      parentId: null,
      ...parse(communityCommentsQuerySchema, query),
    })
    return communityCommentsResponseSchema.parse({ data })
  }

  @Get('comments/:commentId/replies')
  @ConsentCheckedInTransaction()
  @Header('Cache-Control', 'private, no-store')
  async replies(
    @AuthContext() auth: RequestAuthContext,
    @Param('postId') postId: string,
    @Param('commentId') parentId: string,
    @Headers('x-couture-platform') header: string | undefined,
    @Query() query: unknown
  ) {
    platform(header)
    const data = await this.comments.list({
      userId: auth.userId,
      postId,
      parentId,
      ...parse(communityCommentsQuerySchema, query),
    })
    return communityCommentsResponseSchema.parse({ data })
  }

  @Get('comment-submissions')
  @ConsentCheckedInTransaction()
  @Header('Cache-Control', 'private, no-store')
  async submissions(
    @AuthContext() auth: RequestAuthContext,
    @Param('postId') postId: string,
    @Headers('x-couture-platform') header: string | undefined,
    @Query() query: unknown
  ) {
    platform(header)
    const data = await this.comments.submissions({
      userId: auth.userId,
      postId,
      ...parse(communityCommentsQuerySchema, query),
    })
    return communityCommentSubmissionsResponseSchema.parse({ data })
  }

  @Post('comments')
  @HttpCode(200)
  @ConsentCheckedInTransaction()
  @Header('Cache-Control', 'private, no-store')
  async create(
    @AuthContext() auth: RequestAuthContext,
    @Param('postId') postId: string,
    @Headers('x-couture-platform') header: string | undefined,
    @Body() raw: unknown,
    @Res({ passthrough: true }) response: Response
  ) {
    const params = {
      userId: auth.userId,
      postId,
      platform: platform(header),
      input: parse(createCommunityCommentInputSchema, raw),
    }
    const data = await limited(response, () => this.comments.create(params))
    return communityCommentSubmissionResponseSchema.parse({ data })
  }

  @Delete('comments/:commentId')
  @ConsentCheckedInTransaction()
  @Header('Cache-Control', 'private, no-store')
  async delete(
    @AuthContext() auth: RequestAuthContext,
    @Param('postId') postId: string,
    @Param('commentId') commentId: string,
    @Headers('x-couture-platform') header: string | undefined
  ) {
    const data = await this.comments.delete({
      userId: auth.userId,
      postId,
      commentId,
      platform: platform(header),
    })
    return communityCommentSubmissionResponseSchema.parse({ data })
  }

  @Post('comments/:commentId/report')
  @HttpCode(200)
  @ConsentCheckedInTransaction()
  @Header('Cache-Control', 'private, no-store')
  async report(
    @AuthContext() auth: RequestAuthContext,
    @Param('postId') postId: string,
    @Param('commentId') commentId: string,
    @Headers('x-couture-platform') header: string | undefined,
    @Body() raw: unknown,
    @Res({ passthrough: true }) response: Response
  ) {
    const params = {
      userId: auth.userId,
      postId,
      commentId,
      platform: platform(header),
      ...parse(reportCommunityCommentInputSchema, raw),
    }
    const data = await limited(response, () => this.comments.report(params))
    return reportCommunityCommentResponseSchema.parse({ data })
  }
}
