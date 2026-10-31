// Learning path Step 47: Sponsored community highlights.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-47-sponsored-community-highlights
// Story 6.7b: the web community reads opt in to sponsorship blocks, and the
// commerce helper keys the shown event by the server's region rule.
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CommunitySponsorship } from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../test-utils/msw/runtime'
import { feed, item } from '../test-utils/community-lookbook-grid'
import {
  getCommunityFeedFromWeb,
  getCommunityPostFromWeb,
  getCommunitySpotlightFromWeb,
  sponsorshipOf,
} from './community'
import { GLOBAL_LOCALE_REGION, resolveAffiliateLocaleRegion } from './commerce'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'

const SPONSORSHIP: CommunitySponsorship = {
  partnerId: 'atelier-north',
  partnerDisplayName: 'Atelier North',
  offerId: 'offer-community-coat',
  offerTitle: 'Charcoal wool coat',
}

const REACTIONS = {
  counts: { applause: 1, love: 0, inspiration: 0 },
  total: 1,
  revision: 1,
  generation: 1,
  viewerReaction: null,
}

interface SeenHeaders {
  route: string
  sponsorship: string | null
  reactions: string | null
  surface: string | null
}

describe('Community sponsorship opt-in (Story 6.7b)', () => {
  beforeEach(() => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
  })

  it('6.7b-WEB-001 sends the sponsorship and reactions opt-ins on feed, post, spotlight and teaser reads', async () => {
    const seen: SeenHeaders[] = []
    const record = (route: string, request: Request) =>
      seen.push({
        route,
        sponsorship: request.headers.get('x-couture-sponsorship'),
        reactions: request.headers.get('x-couture-reactions'),
        surface: new URL(request.url).searchParams.get('surface'),
      })
    useMswHandlers(
      http.get('/api/v1/community/feed', ({ request }) => {
        record('feed', request)
        return HttpResponse.json({ data: feed({ items: [] }) })
      }),
      http.get('/api/v1/community/posts/:postId', ({ request }) => {
        record('post', request)
        return HttpResponse.json({ data: item() })
      }),
      http.get('/api/v1/community/spotlight', ({ request }) => {
        record('spotlight', request)
        return HttpResponse.json({
          data: { level: 'none', label: null, items: [], nextCursor: null },
        })
      })
    )

    await getCommunityFeedFromWeb({ mode: 'all' })
    await getCommunityPostFromWeb('post-1')
    await getCommunitySpotlightFromWeb()
    await getCommunitySpotlightFromWeb({ limit: 1, surface: 'home_teaser' })

    expect(seen).toEqual([
      { route: 'feed', sponsorship: '1', reactions: '1', surface: null },
      { route: 'post', sponsorship: '1', reactions: '1', surface: null },
      { route: 'spotlight', sponsorship: '1', reactions: '1', surface: null },
      { route: 'spotlight', sponsorship: '1', reactions: '1', surface: 'home_teaser' },
    ])
  })

  it('6.7b-WEB-002 parses the sponsored variant with and without reactions or a block', async () => {
    const sponsored = { ...item(), sponsorship: SPONSORSHIP }
    const withReactions = { ...item({ id: 'post-2' }), reactions: REACTIONS }
    const both = {
      ...item({ id: 'post-3' }),
      reactions: REACTIONS,
      sponsorship: SPONSORSHIP,
    }
    useMswHandlers(
      http.get('/api/v1/community/feed', () =>
        HttpResponse.json({ data: feed({ items: [sponsored, withReactions, both] }) })
      ),
      http.get('/api/v1/community/posts/:postId', () =>
        HttpResponse.json({ data: sponsored })
      ),
      http.get('/api/v1/community/spotlight', () =>
        HttpResponse.json({
          data: {
            level: 'city',
            label: 'Lisbon',
            items: [{ ...both, rank: 1 }],
            nextCursor: null,
          },
        })
      )
    )

    const page = await getCommunityFeedFromWeb({ mode: 'all' })
    expect(page.items.map((entry) => sponsorshipOf(entry) ?? null)).toEqual([
      SPONSORSHIP,
      null,
      SPONSORSHIP,
    ])
    expect(page.items[2]?.reactions).toEqual(REACTIONS)
    expect(sponsorshipOf(await getCommunityPostFromWeb('post-1'))).toEqual(SPONSORSHIP)
    const spotlight = await getCommunitySpotlightFromWeb()
    expect(spotlight.items[0]?.sponsorship).toEqual(SPONSORSHIP)
  })

  it('6.7b-WEB-003 refuses a block carrying a field the strict contract does not allow', async () => {
    useMswHandlers(
      http.get('/api/v1/community/posts/:postId', () =>
        HttpResponse.json({
          data: {
            ...item(),
            sponsorship: { ...SPONSORSHIP, url: 'https://partner.example/offer' },
          },
        })
      )
    )

    await expect(getCommunityPostFromWeb('post-1')).rejects.toMatchObject({
      name: 'CommunityRequestError',
      reason: 'unknown',
    })
  })

  it('6.7b-WEB-004 derives the shown-event region with the server rule', () => {
    expect(resolveAffiliateLocaleRegion('en-US')).toBe('US')
    expect(resolveAffiliateLocaleRegion('fr-ca')).toBe('CA')
    expect(resolveAffiliateLocaleRegion('es-419')).toBe('419')
    expect(resolveAffiliateLocaleRegion('en')).toBe(GLOBAL_LOCALE_REGION)
    expect(resolveAffiliateLocaleRegion('zh-Hant-TW')).toBe(GLOBAL_LOCALE_REGION)
    expect(resolveAffiliateLocaleRegion('')).toBe('*')
  })
})
