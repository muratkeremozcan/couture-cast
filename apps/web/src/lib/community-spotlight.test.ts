// Story 6.6: the web City Spotlight wrappers against MSW.
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
} from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../test-utils/msw/runtime'
import {
  communityFailureReason,
  getCommunityFeedFromWeb,
  getCommunitySpotlightFromWeb,
  openCommunitySpotlightPostFromWeb,
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
    const calls: Record<string, number> = { spotlight: 0, feed: 0 }
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
    await expect(getCommunityFeedFromWeb({ mode: 'all' })).rejects.toBeInstanceOf(Error)
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

  it('6.6-WEB-013 records a spotlight open with its rank and no experiment arm', async () => {
    const bodies: unknown[] = []
    useMswHandlers(
      http.post('/api/v1/community/posts/:postId/opened', async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ tracked: true })
      })
    )
    await openCommunitySpotlightPostFromWeb('post-9', 9)
    expect(bodies).toEqual([{ surface: 'spotlight', rank: 9 }])
  })
})
