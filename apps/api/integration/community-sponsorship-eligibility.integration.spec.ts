// Story 6.7b: the sponsorship eligibility rule against real PostgreSQL. Every
// data row of the I/O matrix runs through the one batched query the community
// reads and the click re-check share, in a database this file owns.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CommerceRepository } from '../src/modules/commerce/commerce.repository.js'
import { CommunitySponsorshipOperatorService } from '../src/modules/commerce/community-sponsorship-operator.service.js'
import { CommunitySponsorshipService } from '../src/modules/commerce/community-sponsorship.service.js'
import {
  COMMUNITY_SPONSORSHIP_ENDED_EVENT,
  COMMUNITY_SPONSORSHIP_LINKED_EVENT,
} from '../src/modules/commerce/community-sponsorship.constants.js'
import { COMMUNITY_CANARY_USER_ID_PREFIX } from '../src/modules/community/community-analytics.js'
import { CommunityMaintenanceService } from '../src/modules/community/community-maintenance.service.js'
import {
  CommunityRepository,
  PUBLICLY_VISIBLE_POST_WHERE,
  publiclyVisiblePostSql,
} from '../src/modules/community/community.repository.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import type { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  HOUR,
  agreementReference,
  databaseNow,
  insertLink,
  installAuthUsers,
  seedAdmin,
  seedAuthor,
  seedOffer,
  seedPartner,
  seedPost,
  shift,
} from './helpers/community-sponsorship-fixtures.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
/** Logs every statement, so a test can count the sponsorship queries a page costs. */
const loggedPrisma = new PrismaClient({
  datasources: { db: { url: database.url } },
  log: [{ emit: 'event', level: 'query' }],
})
const loggedQueries: string[] = []
loggedPrisma.$on('query', (event) => {
  loggedQueries.push(event.query)
})

const repository = new CommerceRepository(prisma)
const flags = { getFeatureFlag: vi.fn(() => Promise.resolve(true)) }

/**
 * A millisecond-aligned instant the boundary test pins `now()` to. The window
 * columns are `timestamp(3)` while the real `now()` carries microseconds, so a
 * real clock can only equal a stored boundary by chance; the pinned one equals
 * it exactly.
 */
const PINNED_NOW = new Date('2030-06-01T12:00:00.000Z')

let adminId: string
let adminEmail: string
let partner: Awaited<ReturnType<typeof seedPartner>>
let anyRegionOffer: Awaited<ReturnType<typeof seedOffer>>
let author: string

beforeAll(async () => {
  await database.migrate()
  // Schema probe: this suite fails when the migration is absent.
  await prisma.$queryRaw`SELECT 1 FROM "CommunityPostSponsorship" LIMIT 1`
  await installAuthUsers(prisma)
  // The pinned clock for 6.7b-INT-003. Only a transaction that puts this schema
  // ahead of pg_catalog on its search_path sees it.
  await prisma.$executeRawUnsafe('CREATE SCHEMA cc67b_clock')
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION cc67b_clock.now() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT '${PINNED_NOW.toISOString()}'::timestamptz $$`
  )
  ;({ userId: adminId, email: adminEmail } = await seedAdmin(prisma))
  partner = await seedPartner(prisma, { displayName: 'Atelier Partner' })
  anyRegionOffer = await seedOffer(prisma, partner.id)
  author = await seedAuthor(prisma)
}, 60_000)

afterAll(async () => {
  try {
    await prisma.$disconnect()
    await loggedPrisma.$disconnect()
  } finally {
    await database.drop()
  }
})

/** A public post by the shared adult author, linked live to `offerId`. */
async function livePost(
  offerId = anyRegionOffer.id,
  window: { startsAt?: Date; endsAt?: Date | null } = {}
): Promise<{ postId: string; linkId: string }> {
  const now = await databaseNow(prisma)
  const postId = await seedPost(prisma, author)
  const linkId = await insertLink(prisma, {
    postId,
    offerId,
    createdById: adminId,
    startsAt: window.startsAt ?? shift(now, -HOUR),
    endsAt: window.endsAt ?? null,
  })
  return { postId, linkId }
}

async function eligiblePostIds(
  postIds: readonly string[],
  region = 'US',
  client: CommerceRepository = repository
): Promise<string[]> {
  const rows = await client.findEligibleCommunitySponsorships(postIds, region)
  return rows.map((row) => row.post_id).sort()
}

describe('6.7b eligibility rule (real SQL)', () => {
  it('6.7b-INT-001 a live link on a public post, active in-window offer and active partner qualifies', async () => {
    const { postId } = await livePost()
    const rows = await repository.findEligibleCommunitySponsorships([postId], 'US')
    expect(rows).toEqual([
      {
        post_id: postId,
        offer_id: anyRegionOffer.id,
        offer_title: anyRegionOffer.title,
        partner_slug: partner.slug,
        partner_display_name: 'Atelier Partner',
      },
    ])
  })

  it('6.7b-INT-002 a link before its starts_at, after its ends_at, or ended does not qualify', async () => {
    const now = await databaseNow(prisma)
    const future = await livePost(undefined, { startsAt: shift(now, HOUR) })
    const expired = await livePost(undefined, {
      startsAt: shift(now, -2 * HOUR),
      endsAt: shift(now, -HOUR),
    })
    const ended = await livePost()
    await prisma.communityPostSponsorship.update({
      where: { id: ended.linkId },
      data: { ended_at: now, ended_by_id: adminId, end_reason: 'campaign_ended' },
    })
    const control = await livePost()
    expect(
      await eligiblePostIds([future.postId, expired.postId, ended.postId, control.postId])
    ).toEqual([control.postId])
  })

  it('6.7b-INT-003 starts_at is inclusive and ends_at exclusive, for the link and the offer, on one constant clock', async () => {
    const at = PINNED_NOW
    const atOffer = await seedOffer(prisma, partner.id, { effectiveFrom: at })
    const closedOffer = await seedOffer(prisma, partner.id, { effectiveTo: at })
    const links = {
      startsAtNow: await livePost(undefined, { startsAt: at }),
      startsJustAfter: await livePost(undefined, { startsAt: shift(at, 1) }),
      endsAtNow: await livePost(undefined, { startsAt: shift(at, -HOUR), endsAt: at }),
      endsJustAfter: await livePost(undefined, {
        startsAt: shift(at, -HOUR),
        endsAt: shift(at, 1),
      }),
      offerOpensNow: await livePost(atOffer.id, { startsAt: shift(at, -HOUR) }),
      offerClosesNow: await livePost(closedOffer.id, { startsAt: shift(at, -HOUR) }),
    }
    const postIds = Object.values(links).map((link) => link.postId)

    const eligible = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SET LOCAL search_path TO cc67b_clock, pg_catalog, public'
      )
      const txRepository = new CommerceRepository(tx as unknown as PrismaClient)
      // The pin is in force: every comparison below reads exactly this instant.
      expect(await databaseNow(tx)).toEqual(at)
      const first = await eligiblePostIds(postIds, 'US', txRepository)
      const second = await eligiblePostIds(postIds, 'US', txRepository)
      expect(second).toEqual(first)
      return first
    })

    expect(eligible).toEqual(
      [
        links.startsAtNow.postId,
        links.endsJustAfter.postId,
        links.offerOpensNow.postId,
      ].sort()
    )
  })

  it('6.7b-INT-004 an inactive offer, an offer before effective_from or at/after effective_to, and an inactive partner do not qualify', async () => {
    const now = await databaseNow(prisma)
    const inactive = await seedOffer(prisma, partner.id, { status: 'inactive' })
    const notOpen = await seedOffer(prisma, partner.id, {
      effectiveFrom: shift(now, HOUR),
    })
    const closed = await seedOffer(prisma, partner.id, { effectiveTo: shift(now, -1) })
    const inactivePartner = await seedPartner(prisma, { status: 'inactive' })
    const partnerOffer = await seedOffer(prisma, inactivePartner.id)
    const posts = await Promise.all(
      [inactive, notOpen, closed, partnerOffer].map((offer) => livePost(offer.id))
    )
    const control = await livePost()
    expect(
      await eligiblePostIds([...posts.map((post) => post.postId), control.postId])
    ).toEqual([control.postId])
  })

  it("6.7b-INT-005 a region-specific offer needs an exact region match while '*' matches every region", async () => {
    const usOffer = await seedOffer(prisma, partner.id, { localeRegion: 'US' })
    const frOffer = await seedOffer(prisma, partner.id, { localeRegion: 'FR' })
    const us = await livePost(usOffer.id)
    const fr = await livePost(frOffer.id)
    const global = await livePost(anyRegionOffer.id)
    const all = [us.postId, fr.postId, global.postId]
    expect(await eligiblePostIds(all, 'US')).toEqual([us.postId, global.postId].sort())
    expect(await eligiblePostIds(all, 'FR')).toEqual([fr.postId, global.postId].sort())
    expect(await eligiblePostIds(all, 'TR')).toEqual([global.postId])
    expect(await eligiblePostIds(all, '*')).toEqual([global.postId])
  })

  it('6.7b-INT-006 an advisor offer linked directly in the table never qualifies', async () => {
    const advisor = await seedOffer(prisma, partner.id, { advisor: true })
    const { postId } = await livePost(advisor.id)
    expect(
      await prisma.communityPostSponsorship.count({ where: { post_id: postId } })
    ).toBe(1)
    expect(await eligiblePostIds([postId], 'US')).toEqual([])
    expect(await eligiblePostIds([postId], '*')).toEqual([])
    expect(
      await repository.findEligibleCommunitySponsorships([postId], 'US', advisor.id)
    ).toEqual([])
  })

  it('6.7b-INT-007 withdrawn, flagged, pending, anonymized, erasure-requested and canary-author posts give no row', async () => {
    const now = await databaseNow(prisma)
    const canary = await seedAuthor(prisma, {
      id: `${COMMUNITY_CANARY_USER_ID_PREFIX}${randomUUID()}`,
    })
    const hidden: string[] = []
    for (const overrides of [
      { status: 'withdrawn' as const },
      { status: 'flagged' as const },
      { status: 'pending_review' as const, publishedAt: null },
      { anonymizedAt: now },
      { erasureRequestedAt: now },
    ]) {
      const postId = await seedPost(prisma, author, overrides)
      await insertLink(prisma, {
        postId,
        offerId: anyRegionOffer.id,
        createdById: adminId,
        startsAt: shift(now, -HOUR),
      })
      hidden.push(postId)
    }
    const canaryPost = await seedPost(prisma, canary)
    await insertLink(prisma, {
      postId: canaryPost,
      offerId: anyRegionOffer.id,
      createdById: adminId,
      startsAt: shift(now, -HOUR),
    })
    hidden.push(canaryPost)
    const control = await livePost()

    expect(await eligiblePostIds([...hidden, control.postId])).toEqual([control.postId])
  })

  it('6.7b-INT-008 the raw visibility predicate selects exactly the posts PUBLICLY_VISIBLE_POST_WHERE selects', async () => {
    const now = await databaseNow(prisma)
    const canary = await seedAuthor(prisma, {
      id: `${COMMUNITY_CANARY_USER_ID_PREFIX}${randomUUID()}`,
    })
    const ids = [
      await seedPost(prisma, author),
      await seedPost(prisma, author),
      await seedPost(prisma, author, { status: 'withdrawn' }),
      await seedPost(prisma, author, { status: 'flagged' }),
      await seedPost(prisma, author, { status: 'review_failed' }),
      await seedPost(prisma, author, { status: 'consent_suspended' }),
      await seedPost(prisma, author, { status: 'draft', publishedAt: null }),
      await seedPost(prisma, author, { status: 'pending_review', publishedAt: null }),
      await seedPost(prisma, author, { status: 'withdrawn', publishedAt: null }),
      await seedPost(prisma, author, { anonymizedAt: now }),
      await seedPost(prisma, author, { erasureRequestedAt: now }),
      await seedPost(prisma, canary),
    ]
    const prismaSelected = (
      await prisma.lookbookPost.findMany({
        where: { id: { in: ids }, ...PUBLICLY_VISIBLE_POST_WHERE },
        select: { id: true },
      })
    )
      .map((row) => row.id)
      .sort()
    const sqlSelected = (
      await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT lp.id FROM "LookbookPost" lp
        WHERE lp.id IN (${Prisma.join(ids)}) AND ${publiclyVisiblePostSql('lp')}
      `)
    )
      .map((row) => row.id)
      .sort()

    expect(sqlSelected).toEqual(prismaSelected)
    // Not vacuous: the set is split, so a predicate that kept or dropped
    // everything would fail.
    expect(sqlSelected).toEqual([ids[0]!, ids[1]!].sort())
  })

  it('6.7b-INT-009 one statement resolves a whole page and returns only the sponsored posts', async () => {
    const sponsored = [await livePost(), await livePost()]
    const plain = [
      await seedPost(prisma, author),
      await seedPost(prisma, author),
      await seedPost(prisma, author),
      await seedPost(prisma, author),
    ]
    const viewer = await seedAuthor(prisma)
    const service = new CommunitySponsorshipService(
      flags as unknown as FeatureFlagsService,
      new CommerceRepository(loggedPrisma as unknown as PrismaClient)
    )
    const pageIds = [
      plain[0]!,
      sponsored[0]!.postId,
      plain[1]!,
      plain[2]!,
      sponsored[1]!.postId,
      plain[3]!,
    ]
    loggedQueries.splice(0)

    const blocks = await service.resolveForPosts({
      userId: viewer,
      postIds: pageIds,
      acceptLanguage: 'en-US',
    })

    expect([...blocks.keys()].sort()).toEqual(sponsored.map((link) => link.postId).sort())
    expect(blocks.get(sponsored[0]!.postId)).toEqual({
      partnerId: partner.slug,
      partnerDisplayName: 'Atelier Partner',
      offerId: anyRegionOffer.id,
      offerTitle: anyRegionOffer.title,
    })
    expect(
      loggedQueries.filter((query) => query.includes('"CommunityPostSponsorship"'))
    ).toHaveLength(1)
  })

  it('6.7b-INT-010 the click re-check narrows to the offer it is asked about', async () => {
    const other = await seedOffer(prisma, partner.id)
    const { postId } = await livePost()
    const service = new CommunitySponsorshipService(
      flags as unknown as FeatureFlagsService,
      repository
    )
    const check = (offerId: string) =>
      service.isClickable({ postId, offerId, locale: undefined, acceptLanguage: 'en-US' })
    expect(await check(anyRegionOffer.id)).toBe(true)
    expect(await check(other.id)).toBe(false)
  })
})

describe('6.7b per-viewer chain (real SQL)', () => {
  const service = new CommunitySponsorshipService(
    flags as unknown as FeatureFlagsService,
    new CommerceRepository(loggedPrisma as unknown as PrismaClient)
  )

  it('6.7b-INT-011 the flag off yields no blocks and runs no sponsorship query', async () => {
    const { postId } = await livePost()
    const viewer = await seedAuthor(prisma)
    flags.getFeatureFlag.mockResolvedValueOnce(false)
    loggedQueries.splice(0)
    const blocks = await service.resolveForPosts({ userId: viewer, postIds: [postId] })
    expect(blocks.size).toBe(0)
    expect(flags.getFeatureFlag).toHaveBeenLastCalledWith(
      'commerce_affiliate_enabled',
      viewer
    )
    expect(
      loggedQueries.filter((query) => query.includes('"CommunityPostSponsorship"'))
    ).toHaveLength(0)
  })

  it('6.7b-INT-012 an opted-out viewer gets no blocks; a missing preference row reads as opted in', async () => {
    const { postId } = await livePost()
    const missing = await seedAuthor(prisma)
    const optedOut = await seedAuthor(prisma)
    const optedIn = await seedAuthor(prisma)
    await prisma.commercePreference.create({
      data: { user_id: optedOut, affiliate_ctas_enabled: false },
    })
    await prisma.commercePreference.create({
      data: { user_id: optedIn, affiliate_ctas_enabled: true },
    })
    expect(await prisma.commercePreference.count({ where: { user_id: missing } })).toBe(0)

    const read = (userId: string) =>
      service.resolveForPosts({ userId, postIds: [postId] })
    expect((await read(optedOut)).size).toBe(0)
    expect([...(await read(missing)).keys()]).toEqual([postId])
    expect([...(await read(optedIn)).keys()]).toEqual([postId])
  })

  it('6.7b-INT-013 the region comes from the saved locale, else Accept-Language, on identical inputs to the click', async () => {
    const frOffer = await seedOffer(prisma, partner.id, { localeRegion: 'FR' })
    const { postId } = await livePost(frOffer.id)
    const savedFrench = await seedAuthor(prisma, { locale: 'fr-FR' })
    const noLocale = await seedAuthor(prisma)
    const read = (userId: string, acceptLanguage?: string) =>
      service.resolveForPosts({ userId, postIds: [postId], acceptLanguage })

    expect((await read(savedFrench, 'en-US')).has(postId)).toBe(true)
    expect((await read(noLocale, 'fr-FR,fr;q=0.9')).has(postId)).toBe(true)
    expect((await read(noLocale, 'en-US')).has(postId)).toBe(false)
    expect((await read(noLocale)).has(postId)).toBe(false)
    const click = (locale: string | undefined, acceptLanguage: string | undefined) =>
      service.isClickable({ postId, offerId: frOffer.id, locale, acceptLanguage })
    expect(await click(undefined, 'fr-FR,fr;q=0.9')).toBe(true)
    expect(await click(undefined, 'en-US')).toBe(false)
    expect(await click('fr-FR', 'en-US')).toBe(true)
  })
})

describe('6.7b link lifetime follows the post (real SQL)', () => {
  it('6.7b-INT-014 hard-deleting a post cascades its links', async () => {
    const { postId, linkId } = await livePost()
    await prisma.lookbookPost.delete({ where: { id: postId } })
    expect(await prisma.communityPostSponsorship.count({ where: { id: linkId } })).toBe(0)
  })

  it('6.7b-INT-015 the erasure sweep removes every link of an erased post while the audit rows stay', async () => {
    const erasedAuthor = await seedAuthor(prisma)
    const postId = await seedPost(prisma, erasedAuthor)
    const operator = new CommunitySponsorshipOperatorService(prisma)
    const link = (reason: string) =>
      operator.link({
        actorEmail: adminEmail,
        postId,
        offerId: anyRegionOffer.id,
        reason,
        authorAgreement: agreementReference(),
        dryRun: false,
      })
    const first = await link('partner_campaign')
    await operator.end({
      actorEmail: adminEmail,
      postId,
      reason: 'correction',
      dryRun: false,
    })
    const second = await link('owner_pick')
    const sponsorshipIds = [first.sponsorshipId!, second.sponsorshipId!]
    const auditWhere = {
      event_type: {
        in: [COMMUNITY_SPONSORSHIP_LINKED_EVENT, COMMUNITY_SPONSORSHIP_ENDED_EVENT],
      },
      OR: sponsorshipIds.map((id) => ({
        event_data: { path: ['sponsorshipId'], equals: id },
      })),
    }
    expect(
      await prisma.communityPostSponsorship.count({ where: { post_id: postId } })
    ).toBe(2)
    expect(await prisma.auditLog.count({ where: auditWhere })).toBe(3)

    await new CommunityRepository(prisma).requestErasureForUser(erasedAuthor, new Date())
    // The link outlives the request itself; the sweep is what removes it.
    expect(
      await prisma.communityPostSponsorship.count({ where: { post_id: postId } })
    ).toBe(2)
    const storage = new InMemoryCommunityStorage()
    const result = await new CommunityMaintenanceService(
      prisma,
      storage
    ).sweepErasureRequests()

    expect(result.anonymized).toBeGreaterThanOrEqual(1)
    expect(await prisma.lookbookPost.findUnique({ where: { id: postId } })).toMatchObject(
      {
        status: 'withdrawn',
        anonymized_at: expect.any(Date) as Date,
      }
    )
    expect(
      await prisma.communityPostSponsorship.count({
        where: { id: { in: sponsorshipIds } },
      })
    ).toBe(0)
    expect(await prisma.auditLog.count({ where: auditWhere })).toBe(3)
  })
})
