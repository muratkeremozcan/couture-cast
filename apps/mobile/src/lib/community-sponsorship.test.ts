// Story 6.7b owner: the mobile community reads opt into the sponsorship block
// and parse the sponsored variants at the trust boundary. Requests go through
// the real SDK to MSW, so the assertions read the headers that left the device.
import { http, HttpResponse } from 'msw'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  COMMUNITY_SPONSORSHIP_HEADER,
  type CommunitySponsoredFeedItem,
  type CommunitySponsorship,
} from '@couture/api-client/contracts/http'
import { server } from '../test-utils/msw/server'
import { setMobileAccessTokenResolver } from './mobile-auth'
import {
  getCommunityFeedFromMobile,
  getCommunityPostFromMobile,
  getCommunitySpotlightFromMobile,
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
