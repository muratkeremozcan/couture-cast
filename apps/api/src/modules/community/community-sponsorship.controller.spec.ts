// Learning path Step 47: Sponsored community highlights.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-47-sponsored-community-highlights
// Story 6.7b: the opted-in sponsorship projection on the feed, post and
// spotlight routes, and the Vary contract that keeps caches honest about it.
import { describe, expect, it, vi } from 'vitest'
import type {
  CommunityFeed,
  CommunityFeedItem,
  CommunitySpotlight,
  CommunitySponsorship,
} from '@couture/api-client/contracts/http'
import type { Response } from 'express'
import type { RequestAuthContext } from '../auth/security.types'
import type { CommunitySponsorshipService } from '../commerce/community-sponsorship.service'
import { CommunityCacheHeadersMiddleware } from './community-cache-headers.middleware'
import { CommunityController } from './community.controller'
import type { CommunityService } from './community.service'
import type { CommunitySpotlightService } from './community-spotlight.service'

const auth: RequestAuthContext = { token: 't', userId: 'viewer-1', role: 'guardian' }

function item(id: string): CommunityFeedItem {
  return {
    id,
    caption: null,
    altText: 'A look',
    climateBand: 'temperate_dry',
    imageAccess: {
      url: `https://storage.local/community-images/${id}.jpg`,
      expiresAt: '2026-10-24T12:15:00.000Z',
    },
    publishedAt: '2026-10-24T12:00:00.000Z',
    createdAt: '2026-10-24T12:00:00.000Z',
    status: 'published',
    challengeId: null,
    author: { displayName: 'Style Explorer A1B2C3D4', isSelf: false },
  }
}

const BLOCK: CommunitySponsorship = {
  partnerId: 'sample-partner',
  partnerDisplayName: 'Sample Partner',
  offerId: 'offer-1',
  offerTitle: 'Trench coat',
}

const feed: CommunityFeed = {
  items: [item('post-1'), item('post-2')],
  authorStates: [],
  nextCursor: null,
  mode: 'auto',
  viewerBand: 'temperate_dry',
  bandResolved: true,
  bandUnresolvedReason: null,
  experimentVariant: 'auto',
  activeChallenge: null,
}

const spotlight: CommunitySpotlight = {
  level: 'city',
  label: 'Lyon',
  items: [
    { ...item('post-1'), rank: 1 },
    { ...item('post-2'), rank: 2 },
  ],
  nextCursor: null,
}

const res = { setHeader: vi.fn() } as unknown as Response

function setup(blocks: ReadonlyMap<string, CommunitySponsorship> = new Map()) {
  const getFeed = vi.fn().mockResolvedValue(feed)
  const getPost = vi.fn().mockResolvedValue(item('post-1'))
  const getSpotlight = vi.fn().mockResolvedValue(spotlight)
  const resolveForPosts = vi.fn().mockResolvedValue(blocks)
  const subject = new CommunityController(
    { getFeed, getPost } as unknown as CommunityService,
    { getSpotlight } as unknown as CommunitySpotlightService,
    { resolveForPosts } as unknown as CommunitySponsorshipService
  )
  return { subject, resolveForPosts }
}

describe('6.7b sponsored community reads', () => {
  it('6.7b-UNIT-001 the opted-in feed carries the block only on the sponsored item', async () => {
    const { subject, resolveForPosts } = setup(new Map([['post-2', BLOCK]]))

    const response = await subject.getFeed(auth, 'web', 'fr-CA', {}, undefined, '1')

    expect(resolveForPosts).toHaveBeenCalledWith({
      userId: 'viewer-1',
      postIds: ['post-1', 'post-2'],
      acceptLanguage: 'fr-CA',
    })
    expect(response.data.items[0]).not.toHaveProperty('sponsorship')
    expect(response.data.items[1]).toEqual({ ...item('post-2'), sponsorship: BLOCK })
  })

  it('6.7b-UNIT-002 a request without the header gets today’s shape and no lookup', async () => {
    const { subject, resolveForPosts } = setup(new Map([['post-1', BLOCK]]))

    const feedResponse = await subject.getFeed(auth, 'web', 'en-US', {})
    const postResponse = await subject.getPost(auth, 'post-1', 'web')
    const spotlightResponse = await subject.getSpotlight(auth, 'web', {}, res)
    // Any value other than exactly `1` is not an opt-in.
    await subject.getFeed(auth, 'web', 'en-US', {}, undefined, 'true')

    expect(resolveForPosts).not.toHaveBeenCalled()
    for (const entry of [
      ...feedResponse.data.items,
      postResponse.data,
      ...spotlightResponse.data.items,
    ]) {
      expect(entry).not.toHaveProperty('sponsorship')
    }
  })

  it('6.7b-UNIT-003 the post route projects the block with its accept-language', async () => {
    const { subject, resolveForPosts } = setup(new Map([['post-1', BLOCK]]))

    const response = await subject.getPost(
      auth,
      'post-1',
      'mobile',
      undefined,
      'es-MX',
      '1'
    )

    expect(resolveForPosts).toHaveBeenCalledWith({
      userId: 'viewer-1',
      postIds: ['post-1'],
      acceptLanguage: 'es-MX',
    })
    expect(response.data).toEqual({ ...item('post-1'), sponsorship: BLOCK })
  })

  it('6.7b-UNIT-004 the spotlight and the home teaser project the block after the read model', async () => {
    const { subject, resolveForPosts } = setup(new Map([['post-1', BLOCK]]))

    const community = await subject.getSpotlight(
      auth,
      'web',
      {},
      res,
      undefined,
      'pt-PT',
      '1'
    )
    const teaser = await subject.getSpotlight(
      auth,
      'mobile',
      { limit: '1', surface: 'home_teaser' },
      res,
      '1',
      'pt-PT',
      '1'
    )

    expect(resolveForPosts).toHaveBeenCalledWith({
      userId: 'viewer-1',
      postIds: ['post-1', 'post-2'],
      acceptLanguage: 'pt-PT',
    })
    expect(community.data.items[0]).toEqual({ ...spotlight.items[0], sponsorship: BLOCK })
    expect(community.data.items[1]).not.toHaveProperty('sponsorship')
    expect(teaser.data.items[0]).toMatchObject({ rank: 1, sponsorship: BLOCK })
  })

  it('6.7b-UNIT-005 an empty block map leaves every item without a CTA', async () => {
    const { subject } = setup()

    const response = await subject.getFeed(auth, 'web', 'en-US', {}, '1', '1')

    for (const entry of response.data.items) {
      expect(entry).not.toHaveProperty('sponsorship')
    }
  })

  it('6.7b-UNIT-006 every public read route varies on the sponsorship header', () => {
    const prototype = CommunityController.prototype as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >
    for (const route of ['getFeed', 'getSpotlight', 'getPost']) {
      const headers = Reflect.getMetadata('__headers__', prototype[route]!) as {
        name: string
        value: string
      }[]
      const vary = headers.find((header) => header.name === 'Vary')?.value ?? ''
      expect(vary.split(',').map((part) => part.trim())).toEqual(
        expect.arrayContaining([
          'x-couture-reactions',
          'x-couture-sponsorship',
          'x-couture-platform',
          'Authorization',
        ])
      )
    }
  })

  it('6.7b-UNIT-007 the community middleware varies on the sponsorship header for refusals too', () => {
    const vary = vi.fn()
    const next = vi.fn()
    new CommunityCacheHeadersMiddleware().use(
      {} as never,
      { setHeader: vi.fn(), vary } as unknown as Response,
      next
    )
    expect(vary).toHaveBeenCalledWith('x-couture-sponsorship')
    expect(next).toHaveBeenCalledOnce()
  })
})
