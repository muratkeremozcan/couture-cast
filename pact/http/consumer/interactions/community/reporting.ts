import {
  MISSING_POST_ID,
  REPORTED_POST_ID,
  OWN_POST_ID,
  communityHeaders,
} from './fixtures'
import { type PactV4, type V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import {
  COMMUNITY_POST_NOT_FOUND_MESSAGE,
  COMMUNITY_REPORT_REASON_CHANGED_MESSAGE,
  COMMUNITY_SELF_REPORT_MESSAGE,
  type CommunityPlatform,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import { like, pactEventAuth, regex, string, type CreateClient } from '../shared'

// --- Reporting -------------------------------------------------------------

/**
 * `trackedResponseSchema` is `.strict()` over exactly `{ tracked: true }`: a
 * report tells the reporter nothing about the moderation outcome, deliberately.
 */
export async function verifyReportCommunityPostInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A visible community post can be reported by the caller',
        params: { userId: pactEventAuth.userId, postId: REPORTED_POST_ID },
      })
    )
    .uponReceiving('a request to report a visible community post')
    .withRequest(
      'POST',
      `/api/v1/community/posts/${REPORTED_POST_ID}/report`,
      setJsonContent({
        headers: communityHeaders(platform),
        body: { reason: 'harassment', details: 'Targeted comments about the author.' },
      })
    )
    .willRespondWith(200, setJsonContent({ body: { tracked: like(true) } }))
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityPostsPostIdReportPost(
        {
          postId: REPORTED_POST_ID,
          xCouturePlatform: platform,
          reportCommunityPostInput: {
            reason: 'harassment',
            details: 'Targeted comments about the author.',
          },
        }
      )

      // The whole response, so an added field leaking moderation state fails
      // here.
      expect(response).toEqual({ tracked: true })
    })
}

/**
 * The three ways a report is refused. A same-reason replay is deliberately
 * absent: it is the 200 {@link verifyReportCommunityPostInteraction} already
 * pins, because a reporter who taps twice has done nothing wrong. A CHANGED
 * reason is the conflict, since the stored report is the record a moderator
 * acts on and silently rewriting it would rewrite that record.
 */
export type CommunityReportRejection = {
  description: string
  state: string
  postId: string
  body: { reason: string; details?: string }
  status: number
  message: string
  error: string
}

export const communityReportRejections: CommunityReportRejection[] = [
  {
    description: 'rejects a report against a post the caller cannot see',
    state: 'The reported community post is not visible to the caller',
    postId: MISSING_POST_ID,
    body: { reason: 'spam' },
    status: 404,
    message: COMMUNITY_POST_NOT_FOUND_MESSAGE,
    error: 'Not Found',
  },
  {
    description: 'rejects a second report that changes the reason',
    state: 'The caller already reported this community post for another reason',
    postId: REPORTED_POST_ID,
    body: { reason: 'spam' },
    status: 409,
    message: COMMUNITY_REPORT_REASON_CHANGED_MESSAGE,
    error: 'Conflict',
  },
  {
    description: 'rejects a report the caller filed against their own post',
    state: 'The reported community post belongs to the caller',
    postId: OWN_POST_ID,
    body: { reason: 'other' },
    status: 403,
    message: COMMUNITY_SELF_REPORT_MESSAGE,
    error: 'Forbidden',
  },
]

export async function verifyReportCommunityPostRejectionInteraction(
  pact: PactV4,
  rejection: CommunityReportRejection,
  platform: CommunityPlatform
) {
  const path = `/api/v1/community/posts/${rejection.postId}/report`

  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: rejection.state,
        params: { userId: pactEventAuth.userId, postId: rejection.postId },
      })
    )
    .uponReceiving(`a community report that ${rejection.description}`)
    .withRequest(
      'POST',
      path,
      setJsonContent({
        headers: communityHeaders(platform),
        body: rejection.body,
      })
    )
    .willRespondWith(
      rejection.status,
      setJsonContent({
        body: {
          statusCode: like(rejection.status),
          message: string(rejection.message),
          error: string(rejection.error),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on these statuses, so the request goes out
      // directly: what matters is the envelope the clients branch on.
      const response = await fetch(`${mockServer.url}${path}`, {
        method: 'POST',
        headers: {
          ...communityHeaders(platform),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rejection.body),
      })

      expect(response.status).toBe(rejection.status)

      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.message).toBe(rejection.message)
      expect(payload.error).toBe(rejection.error)
    })
}

/**
 * The reporting ABUSE limit is a different budget from the posting limit, so it
 * gets its own interaction outside {@link communityRateLimitInteractions}.
 */
export async function verifyReportCommunityPostRateLimitInteraction(
  pact: PactV4,
  platform: CommunityPlatform
) {
  const path = `/api/v1/community/posts/${REPORTED_POST_ID}/report`
  const body = { reason: 'spam' as const }

  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The caller has reached the community reporting abuse limit',
        params: { userId: pactEventAuth.userId, postId: REPORTED_POST_ID },
      })
    )
    .uponReceiving('a community report that exceeds the reporting abuse limit')
    .withRequest(
      'POST',
      path,
      setJsonContent({ headers: communityHeaders(platform), body })
    )
    .willRespondWith(
      429,
      setJsonContent({
        headers: { 'Retry-After': regex(/^[1-9][0-9]*$/, '900') },
        body: {
          statusCode: like(429),
          message: like('Too many reports. Please try again later.'),
          error: string('Too Many Requests'),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on 429, so the request goes out directly.
      const response = await fetch(`${mockServer.url}${path}`, {
        method: 'POST',
        headers: {
          ...communityHeaders(platform),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      expect(response.status).toBe(429)

      const retryAfter = response.headers.get('retry-after')
      expect(retryAfter).toMatch(/^[1-9][0-9]*$/)
      expect(Number(retryAfter)).toBeGreaterThan(0)

      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.error).toBe('Too Many Requests')
    })
}
