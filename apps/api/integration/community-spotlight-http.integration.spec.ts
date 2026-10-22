// Story 6.6 HTTP boundary: the actual controller route, its headers, the opened
// endpoint's two branches, the shared read gate and privacy-safe analytics.
import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  communityReactionSpotlightResponseSchema,
  communitySpotlightResponseSchema,
} from '@couture/api-client/contracts/http'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { CommunityController } from '../src/modules/community/community.controller.js'
import { CommunityService } from '../src/modules/community/community.service.js'
import { CommunitySpotlightService } from '../src/modules/community/community-spotlight.service.js'
import { listenHttpApp } from './helpers/loopback-http-app.js'
import { spotlightTestContext } from './helpers/community-spotlight-context.js'

const ctx = spotlightTestContext('http')
let app: INestApplication
let url: string

const as = (userId: string) => ({
  authorization: `Bearer ${userId}`,
  'x-couture-platform': 'web',
})

beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [CommunityController],
    providers: [
      { provide: CommunityService, useValue: ctx.community },
      { provide: CommunitySpotlightService, useValue: ctx.service },
      {
        provide: GuardianConsentStateService,
        useValue: { canTeenAccess: () => Promise.resolve(true) },
      },
      {
        provide: AccessTokenIdentityService,
        useValue: {
          resolveIdentity: (token: string) =>
            Promise.resolve({ userId: token, role: 'adult' }),
        },
      },
    ],
  }).compile()
  app = module.createNestApplication()
  app.useLogger(false)
  url = await listenHttpApp(app)
}, 60_000)
afterAll(async () => {
  await app?.close()
})

async function seeded(label: string, authors = 8) {
  const area = ctx.area(label)
  const cohort = await ctx.cohort(area, authors)
  const viewer = await ctx.member(area)
  return { area, cohort, viewer }
}

describe('6.6 spotlight HTTP route', () => {
  it('6.6-HTTP-001 serves a private, no-store, strict page with a default limit of six', async () => {
    const { viewer } = await seeded('route')
    const response = await request(url).get('/api/v1/community/spotlight').set(as(viewer))
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.headers.vary).toContain('x-couture-reactions')
    const body = communitySpotlightResponseSchema.parse(response.body)
    expect(body.data.items).toHaveLength(6)
    expect(body.data.items.every((item) => !('reactions' in item))).toBe(true)
  })

  it('6.6-HTTP-002 negotiates live reaction summaries through x-couture-reactions', async () => {
    const { viewer, cohort } = await seeded('reactions')
    const response = await request(url)
      .get('/api/v1/community/spotlight?limit=12')
      .set({ ...as(viewer), 'x-couture-reactions': '1' })
    const body = communityReactionSpotlightResponseSchema.parse(response.body)
    const top = body.data.items[0]!
    expect(top.id).toBe(cohort.expectedOrder[0])
    expect(top.reactions?.total).toBe(
      cohort.reactions.filter((r) => r.postId === top.id).length
    )
  })

  it('6.6-HTTP-003 refuses limits outside 1 to 12 and a malformed cursor', async () => {
    const { viewer } = await seeded('limits', 5)
    for (const query of ['limit=0', 'limit=13', 'unexpected=1'])
      await request(url)
        .get(`/api/v1/community/spotlight?${query}`)
        .set(as(viewer))
        .expect(400)
    const cursor = await request(url)
      .get('/api/v1/community/spotlight?cursor=not-a-cursor')
      .set(as(viewer))
    expect(cursor.status).toBe(400)
    expect(cursor.body).toEqual({
      statusCode: 400,
      code: 'invalid_cursor',
      message: 'Invalid pagination cursor.',
    })
  })

  it('6.6-HTTP-004 a disabled read rollout refuses exactly like the feed', async () => {
    const { viewer } = await seeded('disabled', 5)
    ctx.analytics.splice(0)
    const denied = {
      value: false,
      expiresAt: new Date(),
      validUntil: performance.now() + 60_000,
    }
    ctx.flags.communityReadEvaluation.mockResolvedValueOnce(denied)
    const feed = await request(url).get('/api/v1/community/feed').set(as(viewer))
    ctx.flags.communityReadEvaluation.mockResolvedValueOnce(denied)
    const spotlight = await request(url)
      .get('/api/v1/community/spotlight')
      .set(as(viewer))
    expect(feed.status).toBe(403)
    expect(spotlight.status).toBe(feed.status)
    expect(spotlight.body).toEqual(feed.body)
    expect(ctx.analytics).toEqual([])
  })
})

describe('6.6 spotlight analytics', () => {
  it('6.6-HTTP-010 page one records one deduplicated, privacy-safe view; later pages record none', async () => {
    const { viewer, area, cohort } = await seeded('viewed')
    const first = communitySpotlightResponseSchema.parse(
      (await request(url).get('/api/v1/community/spotlight').set(as(viewer))).body
    )
    await request(url).get('/api/v1/community/spotlight').set(as(viewer))
    await request(url)
      .get(
        `/api/v1/community/spotlight?cursor=${encodeURIComponent(first.data.nextCursor!)}`
      )
      .set(as(viewer))
    const views = ctx.analytics.filter(
      (event) => event.event === 'community_spotlight_viewed'
    )
    expect(views).toHaveLength(2)
    expect(views[0]!.properties).toEqual({
      platform: 'web',
      dedupe_key: expect.stringMatching(
        /^community_spotlight_viewed:[0-9a-f]{16}:\d+$/
      ) as string,
      level: 'city',
      item_count: 6,
      $ip: null,
    })
    expect(views[1]!.properties!.dedupe_key).toBe(views[0]!.properties!.dedupe_key)
    const serialized = JSON.stringify(views).toLowerCase()
    for (const forbidden of [
      viewer,
      area.city,
      area.region,
      area.country,
      ...cohort.posts.map((post) => post.id),
      ...cohort.posts.map((post) => post.caption ?? ''),
    ])
      expect(serialized).not.toContain(forbidden.toLowerCase())
    const rows = await ctx.prisma.telemetryEvent.findMany({
      where: { event_type: 'community_spotlight_viewed' },
    })
    expect(rows.every((row) => row.user_id === null)).toBe(true)
  })

  it('6.6-HTTP-011 a spotlight open records only community_spotlight_opened', async () => {
    const { viewer, cohort, area } = await seeded('opened')
    ctx.analytics.splice(0)
    const postId = cohort.expectedOrder[2]!
    const response = await request(url)
      .post(`/api/v1/community/posts/${postId}/opened`)
      .set(as(viewer))
      .send({ surface: 'spotlight', rank: 3 })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ tracked: true })
    expect(ctx.analytics.map((event) => event.event)).toEqual([
      'community_spotlight_opened',
    ])
    expect(ctx.analytics[0]!.properties).toEqual({
      platform: 'web',
      dedupe_key: expect.stringMatching(
        /^community_spotlight_opened:.+:[0-9a-f]{16}:spotlight$/
      ) as string,
      level: 'city',
      rank: 3,
      $ip: null,
    })
    const serialized = JSON.stringify(ctx.analytics).toLowerCase()
    for (const forbidden of [viewer, postId, area.city, area.region, area.country])
      expect(serialized.replace(/"dedupe_key":"[^"]*"/, '')).not.toContain(
        forbidden.toLowerCase()
      )
  })

  it('6.6-HTTP-012 refuses a bad rank, a mixed body and a hidden post', async () => {
    const { viewer, cohort } = await seeded('opened-bad', 5)
    const postId = cohort.expectedOrder[0]!
    for (const body of [
      { surface: 'spotlight', rank: 0 },
      { surface: 'spotlight', rank: 61 },
      { surface: 'spotlight' },
      { surface: 'spotlight', rank: 2, experimentVariant: 'auto' },
      {},
    ])
      await request(url)
        .post(`/api/v1/community/posts/${postId}/opened`)
        .set(as(viewer))
        .send(body)
        .expect(400)
    await request(url)
      .post('/api/v1/community/posts/missing-post/opened')
      .set(as(viewer))
      .send({ surface: 'spotlight', rank: 1 })
      .expect(404)
  })

  it('6.6-HTTP-013 an installed client open keeps exactly the old community_card_opened', async () => {
    const { viewer, cohort } = await seeded('legacy', 5)
    ctx.analytics.splice(0)
    const post = cohort.posts[0]!
    const response = await request(url)
      .post(`/api/v1/community/posts/${post.id}/opened`)
      .set(as(viewer))
      .send({ experimentVariant: 'all' })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ tracked: true })
    expect(ctx.analytics.map((event) => event.event)).toEqual(['community_card_opened'])
    expect(ctx.analytics[0]!.properties).toEqual({
      platform: 'web',
      dedupe_key: expect.stringMatching(
        /^community_card_opened:.+:[0-9a-f]{16}$/
      ) as string,
      climate_band: post.climateBand,
      is_self: false,
      experiment_variant: 'all',
      $ip: null,
    })
  })
})
