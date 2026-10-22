// Story 6.6 HTTP boundary: the actual controller route, its headers, the opened
// endpoint's two branches, the shared read gate and privacy-safe analytics.
import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  communityReactionSpotlightResponseSchema,
  communitySpotlightResponseSchema,
} from '@couture/api-client/contracts/http'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { CommunityController } from '../src/modules/community/community.controller.js'
import { CommunityService } from '../src/modules/community/community.service.js'
import { CommunitySpotlightService } from '../src/modules/community/community-spotlight.service.js'
import { communitySubjectToken } from '../src/modules/community/community-analytics.js'
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

  it('6.6-HTTP-011 a spotlight open records only community_spotlight_opened, with no raw identifier anywhere', async () => {
    const { viewer, cohort, area } = await seeded('opened')
    const other = await ctx.member(area)
    const [postId, secondPostId] = [cohort.expectedOrder[2]!, cohort.expectedOrder[3]!]
    const open = (member: string, post: string, rank: number) =>
      request(url)
        .post(`/api/v1/community/posts/${post}/opened`)
        .set(as(member))
        .send({ surface: 'spotlight', rank, level: 'city' })
    ctx.analytics.splice(0)
    const response = await open(viewer, postId, 3)
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ tracked: true })
    expect(ctx.analytics.map((event) => event.event)).toEqual([
      'community_spotlight_opened',
    ])
    const key = ctx.analytics[0]!.properties!.dedupe_key
    expect(ctx.analytics[0]!.properties).toEqual({
      platform: 'web',
      dedupe_key: expect.any(String) as string,
      level: 'city',
      rank: 3,
      $ip: null,
    })
    // Event name, then opaque hex components, then the surface. The member
    // component is the shared HMAC subject token and the post component is an
    // HMAC of the post id, so neither raw identifier can appear.
    expect(key).toMatch(/^community_spotlight_opened:([0-9a-f]{16,64}:){2}spotlight$/)
    const components = String(key).split(':').slice(1, -1)
    const subject = communitySubjectToken(viewer)
    expect(components).toContain(subject)
    const postComponent = components.find((component) => component !== subject)!
    expect(postComponent).toBeDefined()

    // Deterministic per (post, viewer, surface): a repeat collapses, while a
    // different post or a different viewer yields a different key whose post
    // component tracks the post alone.
    await open(viewer, postId, 3).expect(200)
    await open(viewer, secondPostId, 4).expect(200)
    await open(other, postId, 3).expect(200)
    const keys = ctx.analytics.map((event) => String(event.properties!.dedupe_key))
    expect(keys[1]).toBe(key)
    expect(keys[2]).not.toBe(key)
    expect(keys[2]!.split(':')).not.toContain(postComponent)
    expect(keys[3]).not.toBe(key)
    expect(keys[3]!.split(':')).toContain(postComponent)
    expect(keys[3]!.split(':')).toContain(communitySubjectToken(other))

    // Nothing is stripped before this check: the dedupe key travels to the
    // analytics sink with every other property.
    const serialized = JSON.stringify(ctx.analytics).toLowerCase()
    for (const forbidden of [
      viewer,
      other,
      postId,
      secondPostId,
      area.city,
      area.region,
      area.country,
    ])
      expect(serialized).not.toContain(forbidden.toLowerCase())
  })

  it('6.6-HTTP-012 refuses a bad rank, a bad or missing level, a mixed body and a hidden post', async () => {
    const { viewer, cohort } = await seeded('opened-bad', 5)
    const postId = cohort.expectedOrder[0]!
    for (const body of [
      { surface: 'spotlight', rank: 0, level: 'city' },
      { surface: 'spotlight', rank: 61, level: 'city' },
      { surface: 'spotlight', level: 'city' },
      { surface: 'spotlight', rank: 1 },
      { surface: 'spotlight', rank: 1, level: 'none' },
      { surface: 'spotlight', rank: 1, level: 'planet' },
      { surface: 'spotlight', rank: 2, level: 'city', experimentVariant: 'auto' },
      { experimentVariant: 'auto', level: 'city' },
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
      .send({ surface: 'spotlight', rank: 1, level: 'city' })
      .expect(404)
  })

  it('6.6-HTTP-014 records the served level from the body and runs no cohort query on open', async () => {
    const { viewer, cohort } = await seeded('opened-level')
    ctx.analytics.splice(0)
    const cohorts = vi.spyOn(ctx.spotlightRepository, 'cohorts')
    const cohortAt = vi.spyOn(ctx.spotlightRepository, 'cohortAt')
    try {
      // The viewer resolves to `city` today; the served level wins regardless.
      await request(url)
        .post(`/api/v1/community/posts/${cohort.expectedOrder[0]!}/opened`)
        .set(as(viewer))
        .send({ surface: 'spotlight', rank: 1, level: 'region' })
        .expect(200)
      expect(cohorts).not.toHaveBeenCalled()
      expect(cohortAt).not.toHaveBeenCalled()
      expect(ctx.analytics.map((event) => event.properties!.level)).toEqual(['region'])
    } finally {
      cohorts.mockRestore()
      cohortAt.mockRestore()
    }
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
