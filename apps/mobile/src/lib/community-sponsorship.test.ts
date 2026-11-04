// Learning path Step 47: Sponsored community highlights.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-47-sponsored-community-highlights
// Story 6.7b owner: the mobile community reads opt into the sponsorship block
// and parse the sponsored variants at the trust boundary. Requests go through
// the real SDK to MSW, so the assertions read the headers that left the device.
// Story 6.11 test owner: U-MOB-D-DENIED. `community_banned` reads by code as the existing denied state (TEA-22, D15).
import { http, HttpResponse } from 'msw'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  COMMUNITY_BANNED_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMMUNITY_SELF_REPORT_MESSAGE,
  COMMUNITY_SPONSORSHIP_HEADER,
  type CommunityBannedError,
  type CommunitySponsoredFeedItem,
  type CommunitySponsorship,
} from '@couture/api-client/contracts/http'
import enUS from '../../assets/locales/en-US.json'
import { server } from '../test-utils/msw/server'
import { setMobileAccessTokenResolver } from './mobile-auth'
import {
  communityCommentsRootsFromMobile,
  communityFailureReason,
  getCommunityFeedFromMobile,
  getCommunityPostFromMobile,
  getCommunitySpotlightFromMobile,
  recordCommunityCardOpenedFromMobile,
  setCommunityReactionFromMobile,
} from './community'

const SPONSORSHIP: CommunitySponsorship = {
  partnerId: 'atelier-north',
  partnerDisplayName: 'Atelier North',
  offerId: 'offer-coat',
  offerTitle: 'Wool overcoat',
}

function post(id: string, extra: Partial<CommunitySponsoredFeedItem> = {}) {
  return {
    id,
    caption: null,
    altText: 'A charcoal wool coat.',
    climateBand: 'temperate_wet',
    imageAccess: {
      url: `https://storage.local/community/${id}.jpg`,
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
    publishedAt: '2026-10-22T09:00:00.000Z',
    createdAt: '2026-10-22T08:59:00.000Z',
    status: 'published',
    challengeId: null,
    author: { displayName: 'Ana', isSelf: false },
    ...extra,
  }
}

const reactions = {
  counts: { applause: 1, love: 0, inspiration: 0 },
  total: 1,
  viewerReaction: null,
  revision: 1,
  generation: 1,
}

describe('mobile community reads opt into sponsorship (Story 6.7b)', () => {
  let restoreAccessToken: (() => void) | undefined
  let headers: Headers[]

  beforeAll(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  })

  beforeEach(() => {
    restoreAccessToken = setMobileAccessTokenResolver(() => 'session-token')
    headers = []
  })

  afterEach(() => {
    restoreAccessToken?.()
    restoreAccessToken = undefined
  })

  it('6.7b-MOB-030 sends both opt-in headers on a feed read and keeps the block', async () => {
    server.use(
      http.get('*/api/v1/community/feed', ({ request }) => {
        headers.push(request.headers)
        return HttpResponse.json({
          data: {
            items: [
              post('post-a', { reactions, sponsorship: SPONSORSHIP }),
              post('post-b'),
            ],
            authorStates: [],
            nextCursor: null,
            mode: 'auto',
            viewerBand: 'temperate_wet',
            bandResolved: true,
            bandUnresolvedReason: null,
            experimentVariant: 'auto',
            activeChallenge: null,
          },
        })
      })
    )

    const feed = await getCommunityFeedFromMobile({ mode: 'auto' })

    expect(headers[0]?.get(COMMUNITY_SPONSORSHIP_HEADER)).toBe('1')
    expect(headers[0]?.get('x-couture-reactions')).toBe('1')
    expect(feed.items[0]?.sponsorship).toEqual(SPONSORSHIP)
    expect(feed.items[0]?.reactions?.total).toBe(1)
    // No block means no field: the parser never invents one.
    expect(feed.items[1]).not.toHaveProperty('sponsorship')
  })

  it('6.7b-MOB-031 sends the header on a single-post read and parses the block', async () => {
    server.use(
      http.get('*/api/v1/community/posts/:postId', ({ request, params }) => {
        headers.push(request.headers)
        return HttpResponse.json({
          data: post(String(params.postId), { sponsorship: SPONSORSHIP }),
        })
      })
    )

    const item = await getCommunityPostFromMobile('post-a')

    expect(headers[0]?.get(COMMUNITY_SPONSORSHIP_HEADER)).toBe('1')
    expect(item.sponsorship).toEqual(SPONSORSHIP)
  })

  it.each([undefined, 'home_teaser' as const])(
    '6.7b-MOB-032 sends the header on a spotlight read (surface %s)',
    async (surface) => {
      server.use(
        http.get('*/api/v1/community/spotlight', ({ request }) => {
          headers.push(request.headers)
          return HttpResponse.json({
            data: {
              level: 'city',
              label: 'Lisbon',
              items: [{ ...post('post-a', { sponsorship: SPONSORSHIP }), rank: 1 }],
              nextCursor: null,
            },
          })
        })
      )

      const page = await getCommunitySpotlightFromMobile({ limit: 1, surface })

      expect(headers[0]?.get(COMMUNITY_SPONSORSHIP_HEADER)).toBe('1')
      expect(page.items[0]?.sponsorship).toEqual(SPONSORSHIP)
    }
  )

  it('6.7b-MOB-033 refuses a block carrying anything beyond the contract', async () => {
    server.use(
      http.get('*/api/v1/community/posts/:postId', () =>
        HttpResponse.json({
          data: post('post-a', {
            sponsorship: {
              ...SPONSORSHIP,
              url: 'https://partner.example/coat',
            } as CommunitySponsorship,
          }),
        })
      )
    )

    // Strict at the trust boundary: an offer URL never reaches a client.
    await expect(getCommunityPostFromMobile('post-a')).rejects.toMatchObject({
      reason: 'unknown',
    })
  })
})

describe('U-MOB-D-DENIED: community_banned is the existing denied state', () => {
  let restoreToken: (() => void) | undefined

  beforeAll(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  })
  beforeEach(() => {
    restoreToken = setMobileAccessTokenResolver(() => 'session-token')
  })
  afterEach(() => {
    restoreToken?.()
    restoreToken = undefined
  })

  const banned = (message: string = COMMUNITY_BANNED_MESSAGE): CommunityBannedError => ({
    statusCode: 403,
    code: 'community_banned',
    message,
    sanction: {
      kind: 'temporary',
      expiresAt: '2026-11-10T12:00:00.000Z',
      appealStatus: 'not_requested',
    },
  })
  const refuseEverything = (body: object = banned()) => {
    const calls: string[] = []
    const refuse = ({ request }: { request: Request }) => {
      calls.push(new URL(request.url).pathname)
      return HttpResponse.json(body, { status: 403 })
    }
    server.use(
      http.get('*/api/v1/community/*', refuse),
      http.post('*/api/v1/community/*', refuse),
      http.put('*/api/v1/community/*', refuse)
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

  it.each<[string, () => Promise<unknown>]>([
    ['the feed', () => getCommunityFeedFromMobile({ mode: 'auto' })],
    ['a single post', () => getCommunityPostFromMobile('post-a')],
    ['the spotlight', () => getCommunitySpotlightFromMobile()],
    [
      'the home teaser',
      () => getCommunitySpotlightFromMobile({ surface: 'home_teaser' }),
    ],
    ['a card open', () => recordCommunityCardOpenedFromMobile('post-a', 'auto')],
    ['comment roots', () => communityCommentsRootsFromMobile('post-a')],
  ])('%s reads as disabled, with one request and no retry', async (_route, run) => {
    const calls = refuseEverything()
    const failure = await failureOf(run)
    expect(communityFailureReason(failure)).toBe('disabled')
    expect(calls).toHaveLength(1)
  })

  it('a reaction reads as the same denied state, ahead of the eligibility rule', async () => {
    refuseEverything()
    const failure = await failureOf(() =>
      setCommunityReactionFromMobile('post-a', {
        selection: 'love',
        mutationId: '00000000-0000-4000-8000-000000000001',
        baseRevision: 0,
      })
    )
    expect(communityFailureReason(failure)).toBe('disabled')
  })

  it.each([
    ['the age gate', COMMUNITY_AGE_GATE_DENIED_MESSAGE],
    ['a self report', COMMUNITY_SELF_REPORT_MESSAGE],
    ['the rollout', COMMUNITY_FEED_DISABLED_MESSAGE],
  ])('reads the code ahead of the %s message rule', async (_rule, message) => {
    refuseEverything(banned(message))
    const failure = await failureOf(() => getCommunityFeedFromMobile({ mode: 'auto' }))
    expect(communityFailureReason(failure)).toBe('disabled')
  })

  it('reads the code, so a body a newer server extended still reads as denied', async () => {
    const body = banned(COMMUNITY_SELF_REPORT_MESSAGE)
    refuseEverything({ ...body, sanction: { ...body.sanction, addedLater: 'x' } })
    const failure = await failureOf(() => getCommunityFeedFromMobile({ mode: 'auto' }))
    expect(communityFailureReason(failure)).toBe('disabled')
  })

  it('leaves another 403 to its own rule', async () => {
    refuseEverything({
      statusCode: 403,
      code: 'denied',
      message: COMMUNITY_AGE_GATE_DENIED_MESSAGE,
    })
    const failure = await failureOf(() => getCommunityFeedFromMobile({ mode: 'auto' }))
    expect(communityFailureReason(failure)).toBe('age_gate')
  })

  it('adds no banned string to the mobile catalogs', () => {
    expect(enUS.community).toBeDefined()
    expect(enUS.community).not.toHaveProperty('banned')
  })
})
