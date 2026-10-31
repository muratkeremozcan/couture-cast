// Story 6.3 negotiation owner: send `x-couture-reactions: 1` when a client opts in, in `packages/api-client/src/client.ts`
import {
  communityCommentsResponseSchema,
  communityCommentSubmissionResponseSchema,
  communityCommentSubmissionsResponseSchema,
  reportCommunityCommentResponseSchema,
  type CreateCommunityCommentInput,
  type CommunityReportReason,
} from './contracts/http/community'
import { Configuration, DefaultApi, type ConfigurationParameters } from './generated'

export type ApiClientAccessToken = Exclude<
  ConfigurationParameters['accessToken'],
  undefined
>

export type ApiClientOptions = Pick<
  ConfigurationParameters,
  'accessToken' | 'credentials' | 'fetchApi' | 'headers'
> & { communityReactions?: boolean }

function isPromiseLike(value: unknown): value is Promise<string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  )
}

function normalizeClientOptions(
  accessTokenOrOptions?: ApiClientAccessToken | ApiClientOptions
): ApiClientOptions {
  if (
    typeof accessTokenOrOptions === 'string' ||
    typeof accessTokenOrOptions === 'function' ||
    isPromiseLike(accessTokenOrOptions)
  ) {
    return { accessToken: accessTokenOrOptions }
  }

  return accessTokenOrOptions ?? {}
}

// Story 0.9 Task 3 step 4 owner:
// expose one stable client factory here so apps do not need to import generator internals.
//
// Why this step matters:
// generated code changes shape over time. This wrapper keeps the package entrypoint small and lets
// web/mobile code depend on a consistent API surface.
export function createApiClient(
  baseURL: string,
  accessToken?: ApiClientAccessToken
): DefaultApi
export function createApiClient(baseURL: string, options?: ApiClientOptions): DefaultApi
export function createApiClient(
  baseURL: string,
  accessTokenOrOptions?: ApiClientAccessToken | ApiClientOptions
) {
  const options = normalizeClientOptions(accessTokenOrOptions)
  const config = new Configuration({
    basePath: baseURL,
    accessToken: options.accessToken,
    credentials: options.credentials,
    fetchApi: options.fetchApi,
    headers: {
      ...options.headers,
      ...(options.communityReactions ? { 'x-couture-reactions': '1' } : {}),
    },
  })

  return new DefaultApi(config)
}

type CommunityCommentsApi = Pick<
  DefaultApi,
  | 'getCommunityComments'
  | 'getCommunityCommentReplies'
  | 'getCommunityCommentSubmissions'
  | 'createCommunityComment'
  | 'deleteCommunityComment'
  | 'reportCommunityComment'
>

// Story 6.4 owner: apps consume generated transport through validated thread operations.
export function communityCommentsClient(
  api: CommunityCommentsApi,
  platform: 'web' | 'mobile',
  requestInit?: RequestInit
) {
  return {
    roots: async (postId: string, cursor?: string) =>
      communityCommentsResponseSchema.parse(
        await api.getCommunityComments(
          { postId, cursor, xCouturePlatform: platform },
          requestInit
        )
      ).data,
    replies: async (postId: string, parentId: string, cursor?: string) =>
      communityCommentsResponseSchema.parse(
        await api.getCommunityCommentReplies(
          {
            postId,
            commentId: parentId,
            cursor,
            xCouturePlatform: platform,
          },
          requestInit
        )
      ).data,
    submissions: async (postId: string, cursor?: string) =>
      communityCommentSubmissionsResponseSchema.parse(
        await api.getCommunityCommentSubmissions(
          {
            postId,
            cursor,
            xCouturePlatform: platform,
          },
          requestInit
        )
      ).data,
    create: async (postId: string, input: CreateCommunityCommentInput) =>
      communityCommentSubmissionResponseSchema.parse(
        await api.createCommunityComment(
          {
            postId,
            xCouturePlatform: platform,
            createCommunityCommentInput: input,
          },
          requestInit
        )
      ).data,
    delete: async (postId: string, commentId: string) =>
      communityCommentSubmissionResponseSchema.parse(
        await api.deleteCommunityComment(
          {
            postId,
            commentId,
            xCouturePlatform: platform,
          },
          requestInit
        )
      ).data,
    report: async (postId: string, commentId: string, reason: CommunityReportReason) =>
      reportCommunityCommentResponseSchema.parse(
        await api.reportCommunityComment(
          {
            postId,
            commentId,
            xCouturePlatform: platform,
            reportCommunityCommentInput: { reason },
          },
          requestInit
        )
      ).data,
  }
}
