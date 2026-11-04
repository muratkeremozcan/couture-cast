// Learning path Step 44: Community city spotlight.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-44-community-city-spotlight
// Story 6.6: the web City Spotlight wrappers against MSW.
// Story 6.11 test owner: U-WEB-D-CLIENT. `community_banned` is read by code on every route (TEA-22).
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  COMMUNITY_BANNED_MESSAGE,
  COMMUNITY_COMMENT_SELF_REPORT_MESSAGE,
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMMUNITY_SELF_REPORT_MESSAGE,
  type CommunityBannedError,
} from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../test-utils/msw/runtime'
import {
  communityCommentsRepliesFromWeb,
  communityCommentsRootsFromWeb,
  communityCommentsSubmissionsFromWeb,
  communityFailureReason,
  communitySanctionOf,
  getCommunityFeedFromWeb,
  getCommunityPostFromWeb,
  getCommunitySpotlightFromWeb,
  isCommunityPostVisibleFromWeb,
  openCommunityPostFromWeb,
  openCommunitySpotlightPostFromWeb,
  reportCommunityPostFromWeb,
  setCommunityReactionFromWeb,
} from './community'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'

const SPOTLIGHT_PATH = '/api/v1/community/spotlight'

const page = {
  level: 'region',
  label: 'Lisboa',
  items: [],
  nextCursor: null,
}

describe('City Spotlight web wrappers (Story 6.6)', () => {
  beforeEach(() => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
  })

  it('6.6-WEB-010 negotiates reactions and forwards the cursor and limit', async () => {
    const seen: { reactions: string | null; platform: string | null; query: string }[] =
      []
    useMswHandlers(
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        seen.push({
          reactions: request.headers.get('x-couture-reactions'),
          platform: request.headers.get('x-couture-platform'),
          query: new URL(request.url).search,
        })
        return HttpResponse.json({ data: page })
      })
    )

    await expect(
      getCommunitySpotlightFromWeb({ cursor: 'next', limit: 12 })
    ).resolves.toEqual(page)
    await getCommunitySpotlightFromWeb()
    expect(seen).toEqual([
      { reactions: '1', platform: 'web', query: '?cursor=next&limit=12' },
      { reactions: '1', platform: 'web', query: '?limit=6' },
    ])
  })

  it('6.6-WEB-014 retries the feed and the spotlight once after a gate unavailable 503', async () => {
    const calls = { spotlight: 0, feed: 0 }
    const refusal = () =>
      HttpResponse.json(
        {
          statusCode: 503,
          code: 'unavailable',
          retryAfterSeconds: 0,
          message: 'Access could not be verified.',
        },
        { status: 503 }
      )
    useMswHandlers(
      http.get(SPOTLIGHT_PATH, () =>
        calls.spotlight++ === 0 ? refusal() : HttpResponse.json({ data: page })
      ),
      http.get('/api/v1/community/feed', () => {
        calls.feed += 1
        return refusal()
      })
    )
    await expect(getCommunitySpotlightFromWeb()).resolves.toEqual(page)
    expect(calls.spotlight).toBe(2)
    // A second refusal is surfaced, once, as the classified failure.
    const failure: unknown = await getCommunityFeedFromWeb({ mode: 'all' }).catch(
      (error: unknown) => error
    )
    expect(failure).toMatchObject({
      name: 'CommunityRequestError',
      httpStatus: 503,
      message: 'Access could not be verified.',
    })
    // A gate outage that carries no disabled copy stays a generic, retryable failure.
    expect(communityFailureReason(failure)).toBe('unknown')
    expect(calls.feed).toBe(2)
  })

  it('6.6-WEB-011 refuses a response the strict contract does not accept', async () => {
    useMswHandlers(
      http.get(SPOTLIGHT_PATH, () =>
        HttpResponse.json({ data: { ...page, cohortSize: 7 } })
      )
    )
    const failure: unknown = await getCommunitySpotlightFromWeb().catch(
      (error: unknown) => error
    )
    expect(communityFailureReason(failure)).toBe('unknown')
  })

  it('6.6-WEB-012 classifies the read rollout refusal and a stale cursor', async () => {
    useMswHandlers(
      http.get(SPOTLIGHT_PATH, ({ request }) =>
        new URL(request.url).searchParams.get('cursor')
          ? HttpResponse.json(
              {
                statusCode: 400,
                code: 'invalid_cursor',
                message: COMMUNITY_CURSOR_INVALID_MESSAGE,
              },
              { status: 400 }
            )
          : HttpResponse.json(
              {
                statusCode: 403,
                code: 'denied',
                message: COMMUNITY_FEED_DISABLED_MESSAGE,
              },
              { status: 403 }
            )
      )
    )
    const denied: unknown = await getCommunitySpotlightFromWeb().catch(
      (error: unknown) => error
    )
    const stale: unknown = await getCommunitySpotlightFromWeb({ cursor: 'old' }).catch(
      (error: unknown) => error
    )
    expect(communityFailureReason(denied)).toBe('disabled')
    expect(communityFailureReason(stale)).toBe('cursor_invalid')
  })

  it('6.6-WEB-013 records a spotlight open with its rank, served level and no experiment arm', async () => {
    const bodies: unknown[] = []
    useMswHandlers(
      http.post('/api/v1/community/posts/:postId/opened', async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ tracked: true })
      })
    )
    await openCommunitySpotlightPostFromWeb('post-9', 9, 'region')
    expect(bodies).toEqual([{ surface: 'spotlight', rank: 9, level: 'region' }])
  })

  it('6.6-WEB-015 a refused spotlight open surfaces the classified failure', async () => {
    useMswHandlers(
      http.post('/api/v1/community/posts/:postId/opened', () =>
        HttpResponse.json(
          { statusCode: 404, error: 'Not Found', message: 'Post not found.' },
          { status: 404 }
        )
      )
    )
    const failure: unknown = await openCommunitySpotlightPostFromWeb(
      'post-gone',
      1,
      'city'
    ).catch((error: unknown) => error)
    expect(communityFailureReason(failure)).toBe('not_found')
  })
})

describe('U-WEB-D-CLIENT: community_banned reads by code (TEA-22)', () => {
  beforeEach(() => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
  })

  const sanction: CommunityBannedError['sanction'] = {
    kind: 'temporary',
    expiresAt: '2026-11-10T12:00:00.000Z',
    appealStatus: 'not_requested',
  }
  const banned = (message: string = COMMUNITY_BANNED_MESSAGE): CommunityBannedError => ({
    statusCode: 403,
    code: 'community_banned',
    message,
    sanction,
  })
  /** Every community route answers the same refusal, and counts what reached it. */
  const refuseEverything = (body: object = banned()) => {
    const calls: string[] = []
    const refuse = ({ request }: { request: Request }) => {
      calls.push(new URL(request.url).pathname)
      return HttpResponse.json(body, { status: 403 })
    }
    const install = useMswHandlers
    install(
      http.get('/api/v1/community/*', refuse),
      http.post('/api/v1/community/*', refuse),
      http.put('/api/v1/community/*', refuse)
    )
    return calls
  }
  const failureOf = (run: () => Promise<unknown>) =>
    run().then(
      () => {
        throw new Error('expected the request to be refused')
      },
      (error: unknown) => error
    )

  const READ_ROUTES: [string, () => Promise<unknown>][] = [
    ['the feed', () => getCommunityFeedFromWeb({ mode: 'auto' })],
    ['a single post', () => getCommunityPostFromWeb('post-1')],
    ['the spotlight', () => getCommunitySpotlightFromWeb()],
    ['the home teaser', () => getCommunitySpotlightFromWeb({ surface: 'home_teaser' })],
    ['a card open', () => openCommunityPostFromWeb('post-1', 'auto')],
    ['a spotlight open', () => openCommunitySpotlightPostFromWeb('post-1', 1, 'city')],
    ['comment roots', () => communityCommentsRootsFromWeb('post-1')],
    ['comment replies', () => communityCommentsRepliesFromWeb('post-1', 'comment-1')],
    ['own submissions', () => communityCommentsSubmissionsFromWeb('post-1')],
  ]

  it.each(READ_ROUTES)('%s reaches the banned state, once', async (_route, run) => {
    const calls = refuseEverything()
    const failure = await failureOf(run)
    expect(communityFailureReason(failure)).toBe('banned')
    expect(communitySanctionOf(failure)).toEqual(sanction)
    expect(calls).toHaveLength(1)
  })

  it('a report reaches the banned state', async () => {
    refuseEverything()
    const failure = await failureOf(() => reportCommunityPostFromWeb('post-1', 'spam'))
    expect(communityFailureReason(failure)).toBe('banned')
  })

  it('a reaction reaches the banned state ahead of the eligibility rule', async () => {
    refuseEverything()
    const failure = await failureOf(() =>
      setCommunityReactionFromWeb('post-1', {
        selection: 'love',
        mutationId: '00000000-0000-4000-8000-000000000001',
        baseRevision: 0,
      })
    )
    expect(communityFailureReason(failure)).toBe('banned')
    expect(communitySanctionOf(failure)).toEqual(sanction)
  })

  it('a deep link answers false, and asks once', async () => {
    const calls = refuseEverything()
    await expect(isCommunityPostVisibleFromWeb('post-1')).resolves.toBe(false)
    expect(calls).toHaveLength(1)
  })

  it.each([
    ['the age gate', COMMUNITY_AGE_GATE_DENIED_MESSAGE],
    ['the rollout', COMMUNITY_FEED_DISABLED_MESSAGE],
    ['a self report', COMMUNITY_SELF_REPORT_MESSAGE],
    ['a comment self report', COMMUNITY_COMMENT_SELF_REPORT_MESSAGE],
  ])('beats the %s message rule', async (_rule, message) => {
    refuseEverything(banned(message))
    const failure = await failureOf(() => getCommunityFeedFromWeb({ mode: 'auto' }))
    expect(communityFailureReason(failure)).toBe('banned')
    expect(communitySanctionOf(failure)).toEqual(sanction)
  })

  it('keeps the message distinct from the rollout and age gate copy', () => {
    for (const copy of [
      COMMUNITY_FEED_DISABLED_MESSAGE,
      COMMUNITY_AGE_GATE_DENIED_MESSAGE,
    ]) {
      expect(COMMUNITY_BANNED_MESSAGE).not.toContain(copy)
      expect(copy).not.toContain(COMMUNITY_BANNED_MESSAGE)
    }
  })

  it('reads the code, so a body a newer server extended still reaches the banned state', async () => {
    refuseEverything({
      ...banned(COMMUNITY_FEED_DISABLED_MESSAGE),
      sanction: { ...sanction, addedLater: 'x' },
    })
    const failure = await failureOf(() => getCommunityFeedFromWeb({ mode: 'auto' }))
    expect(communityFailureReason(failure)).toBe('banned')
  })

  it('leaves every other 403 to its own rule, and no sanction on it', async () => {
    refuseEverything({
      statusCode: 403,
      code: 'denied',
      message: COMMUNITY_FEED_DISABLED_MESSAGE,
    })
    const rollout = await failureOf(() => getCommunityFeedFromWeb({ mode: 'auto' }))
    expect(communityFailureReason(rollout)).toBe('disabled')
    expect(communitySanctionOf(rollout)).toBeNull()

    refuseEverything({ statusCode: 403, message: COMMUNITY_BANNED_MESSAGE })
    const noCode = await failureOf(() => getCommunityFeedFromWeb({ mode: 'auto' }))
    expect(communityFailureReason(noCode)).toBe('unknown')
    expect(communitySanctionOf(noCode)).toBeNull()
  })

  it('never reads a ban from any status but 403', async () => {
    useMswHandlers(
      http.get('/api/v1/community/feed', () =>
        HttpResponse.json({ ...banned(), statusCode: 500 }, { status: 500 })
      )
    )
    const failure = await failureOf(() => getCommunityFeedFromWeb({ mode: 'auto' }))
    expect(communityFailureReason(failure)).toBe('unknown')
  })
})
