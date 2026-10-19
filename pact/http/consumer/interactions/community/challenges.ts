import {
  CHALLENGES_PATH,
  CHALLENGE_ID,
  CREATED_AT,
  VIEWER_BAND,
  CHALLENGE_TIME_ZONE,
  CHALLENGE_STARTS_AT,
  CHALLENGE_ENDS_AT,
  CHALLENGE_WRONG_SPAN_ENDS_AT,
  CHALLENGE_NON_MONDAY_STARTS_AT,
  CHALLENGE_NON_MONDAY_ENDS_AT,
  CHALLENGE_INVALID_TIME_ZONE,
  IANA_TIME_ZONE_INVALID_MESSAGE,
  CHALLENGE_SLUG,
  CHALLENGE_COPY,
} from './fixtures'
import { type PactV4, type V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import {
  COMMUNITY_CHALLENGE_OVERLAP_MESSAGE,
  COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import {
  isoTimestamp,
  like,
  pactAdminAuth,
  pactAdminHeaders,
  regex,
  string,
  type CreateClient,
} from '../shared'

// --- Challenges (admin) ----------------------------------------------------
const createChallengeRequestBody = {
  slug: CHALLENGE_SLUG,
  climateBand: VIEWER_BAND,
  startsAt: CHALLENGE_STARTS_AT,
  endsAt: CHALLENGE_ENDS_AT,
  timeZone: CHALLENGE_TIME_ZONE,
  copy: CHALLENGE_COPY,
  isActive: true,
}

/**
 * The only interaction that uses the admin identity (`pactAdminAuth`), which
 * exists so `RolesGuard` runs for real here.
 *
 * IT DRIVES THE GENERATED SDK, AND THAT IS THE POINT. The generated
 * `CommunityChallengeCopy` model used to project
 * `z.record(supportedLocaleSchema, ...)` as a fixed object with camelCased
 * optional locale tags (`enUS?`, `enCA?`, `es419?`) while the SDK passed the
 * body through with no `ToJSON` mapping. A client following that type sent
 * `{ enUS: ... }`, which the API rejects because `enUS` is not a supported
 * locale tag, and the `en-US` fallback the schema requires could not be
 * expressed at all. The projection is now a free-form map keyed by the real
 * hyphenated tag. Calling `apiV1CommunityChallengesPost` here is what makes
 * this a regression test for that defect: revert the projection and this stops
 * compiling.
 */
export async function verifyCreateCommunityChallengeInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'An administrator may create a community challenge',
        params: { userId: pactAdminAuth.userId },
      })
    )
    .uponReceiving('a request to create a Monday-anchored community challenge')
    .withRequest(
      'POST',
      CHALLENGES_PATH,
      setJsonContent({
        headers: pactAdminHeaders,
        body: createChallengeRequestBody,
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            id: string(CHALLENGE_ID),
            slug: string(CHALLENGE_SLUG),
            climateBand: string(VIEWER_BAND),
            startsAt: isoTimestamp(CHALLENGE_STARTS_AT),
            endsAt: isoTimestamp(CHALLENGE_ENDS_AT),
            timeZone: string(CHALLENGE_TIME_ZONE),
            copy: {
              'en-US': {
                title: like(CHALLENGE_COPY['en-US'].title),
                body: like(CHALLENGE_COPY['en-US'].body),
              },
            },
            isActive: like(true),
            createdAt: isoTimestamp(CREATED_AT),
            updatedAt: isoTimestamp(CREATED_AT),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityChallengesPost({
        createCommunityChallengeInput: createChallengeRequestBody,
      })

      expect(response.data.id).toBe(CHALLENGE_ID)
      // The window is only interpretable with its zone, so the zone is part of
      // the response as well as the request. Dropping it would leave every
      // client re-deriving the Monday boundary in whatever zone it happens to
      // be running in.
      expect(response.data.timeZone).toBe(CHALLENGE_TIME_ZONE)
      expect(response.data.startsAt).toBe(CHALLENGE_STARTS_AT)
      expect(response.data.endsAt).toBe(CHALLENGE_ENDS_AT)
      // The locale keys on the wire are the real hyphenated tags.
      expect(response.data.copy).toHaveProperty('en-US')
      expect(response.data.copy).not.toHaveProperty('enUS')
    })
}

/**
 * The ways a challenge write is refused.
 *
 * The two window fixtures each break exactly ONE rule in
 * `refineChallengeWindow`, so the controller's `issues.join('; ')` equals
 * `COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE` exactly. A fixture that broke two
 * rules at once would produce a joined string no constant matches, and the
 * assertion would have to be loosened to survive it. The bad-zone row is the one
 * loosened row, because its field-level refine can fire alongside a window
 * issue; `messagePattern` below carries the reason.
 */
export type CommunityChallengeRejection = {
  description: string
  state: string
  body: unknown
  status: number
  message: string
  /**
   * Present where the controller may join a SECOND Zod issue onto the one this
   * row is about, so the message is matched as a substring. Absent means the
   * fixture provokes exactly one issue and the message is pinned whole.
   */
  messagePattern?: RegExp
  error: string
}

export const communityChallengeRejections: CommunityChallengeRejection[] = [
  {
    description: 'rejects a challenge window that is not exactly seven days',
    state: 'An administrator may create a community challenge',
    body: { ...createChallengeRequestBody, endsAt: CHALLENGE_WRONG_SPAN_ENDS_AT },
    status: 400,
    message: COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE,
    error: 'Bad Request',
  },
  {
    description:
      'rejects a challenge that starts on a Monday in UTC but not in its own zone',
    state: 'An administrator may create a community challenge',
    body: {
      ...createChallengeRequestBody,
      startsAt: CHALLENGE_NON_MONDAY_STARTS_AT,
      endsAt: CHALLENGE_NON_MONDAY_ENDS_AT,
    },
    status: 400,
    message: COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE,
    error: 'Bad Request',
  },
  {
    description: 'rejects a challenge naming a time zone the tz database does not know',
    state: 'An administrator may create a community challenge',
    body: { ...createChallengeRequestBody, timeZone: CHALLENGE_INVALID_TIME_ZONE },
    status: 400,
    message: IANA_TIME_ZONE_INVALID_MESSAGE,
    messagePattern: /Time zone must be a valid IANA zone identifier\./,
    error: 'Bad Request',
  },
  {
    description: 'rejects a challenge overlapping an active one in the same band',
    state: 'An active community challenge already covers this band and window',
    body: createChallengeRequestBody,
    status: 409,
    message: COMMUNITY_CHALLENGE_OVERLAP_MESSAGE,
    error: 'Conflict',
  },
]

/**
 * The 400s come from `createCommunityChallengeInputSchema`'s `superRefine`,
 * which runs in the controller before the service is reached. The 409 comes
 * from the overlap check, which considers global (null-band) rows as well as
 * rows in the same band.
 */
export async function verifyCreateCommunityChallengeRejectionInteraction(
  pact: PactV4,
  rejection: CommunityChallengeRejection
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: rejection.state,
        params: { userId: pactAdminAuth.userId },
      })
    )
    .uponReceiving(`a community challenge write that ${rejection.description}`)
    .withRequest(
      'POST',
      CHALLENGES_PATH,
      setJsonContent({ headers: pactAdminHeaders, body: rejection.body })
    )
    .willRespondWith(
      rejection.status,
      setJsonContent({
        body: {
          statusCode: like(rejection.status),
          message:
            rejection.messagePattern === undefined
              ? string(rejection.message)
              : regex(rejection.messagePattern, rejection.message),
          error: string(rejection.error),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on these statuses, so the request goes out
      // directly: what matters is the envelope the admin client branches on.
      const response = await fetch(`${mockServer.url}${CHALLENGES_PATH}`, {
        method: 'POST',
        headers: { ...pactAdminHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(rejection.body),
      })

      expect(response.status).toBe(rejection.status)

      const payload = (await response.json()) as Record<string, unknown>
      if (rejection.messagePattern === undefined) {
        expect(payload.message).toBe(rejection.message)
      } else {
        expect(String(payload.message)).toContain(rejection.message)
      }
      expect(payload.error).toBe(rejection.error)
    })
}
