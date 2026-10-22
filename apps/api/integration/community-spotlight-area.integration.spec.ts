// Story 6.6: area components reach a post only at submission, hold only a
// hierarchical prefix, and leave the post exactly when its location key does.
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { CommunityMaintenanceService } from '../src/modules/community/community-maintenance.service.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import { GuardianService } from '../src/modules/guardian/guardian.service.js'
import {
  hoursBeforeAsOf,
  spotlightTestContext,
} from './helpers/community-spotlight-context.js'

const ctx = spotlightTestContext('area')

const AREA_SELECT = {
  area_country: true,
  area_region: true,
  area_city: true,
  location_key: true,
} as const

async function draft(author: string) {
  const fixture = createLookbookPost({
    userId: author,
    status: 'draft',
    publishedAt: null,
    submittedAt: null,
    altTextConfirmedAt: null,
    locationKey: null,
  })
  await ctx.prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(fixture) })
  return fixture.id
}

async function submit(author: string, postId: string) {
  const location = await ctx.repository.findAreaLocation(author)
  return ctx.repository.publishWithinQuota({
    userId: author,
    postId,
    cap: 10,
    data: {
      altText: 'Layered look',
      caption: null,
      climateBand: null,
      locale: 'en-US',
      challengeId: null,
      area: location?.area ?? { country: null, region: null, city: null },
    },
  })
}

describe('6.6 area stamping', () => {
  it("6.6-INT-050 stamps only the normalized components of the author's chosen location", async () => {
    const author = await ctx.member({
      country: '  PORTUGAL ',
      region: 'Lisboa',
      city: 'Ｌｉｓｂｏｎ',
    })
    const postId = await draft(author)
    await expect(submit(author, postId)).resolves.toMatchObject({ kind: 'published' })
    const row = await ctx.prisma.lookbookPost.findUniqueOrThrow({
      where: { id: postId },
      select: { ...AREA_SELECT, caption: true, locale: true },
    })
    expect(row).toMatchObject({
      area_country: 'portugal',
      area_region: 'lisboa',
      area_city: 'lisbon',
      location_key: null,
    })
  })

  it('6.6-INT-051 stores only the prefix whose parents exist, and nothing without a country', async () => {
    const partial = await ctx.member({
      country: 'Portugal',
      region: null,
      city: 'Lisbon',
    })
    const partialPost = await draft(partial)
    await submit(partial, partialPost)
    await expect(
      ctx.prisma.lookbookPost.findUniqueOrThrow({
        where: { id: partialPost },
        select: AREA_SELECT,
      })
    ).resolves.toMatchObject({
      area_country: 'portugal',
      area_region: null,
      area_city: null,
    })

    const nowhere = await ctx.member({ country: null, region: 'Lisboa', city: 'Lisbon' })
    const nowherePost = await draft(nowhere)
    await submit(nowhere, nowherePost)
    await expect(
      ctx.prisma.lookbookPost.findUniqueOrThrow({
        where: { id: nowherePost },
        select: AREA_SELECT,
      })
    ).resolves.toMatchObject({ area_country: null, area_region: null, area_city: null })
  })

  it('6.6-INT-052 the database refuses a city without a region and an anonymized row with an area', async () => {
    const author = await ctx.member()
    const id = await draft(author)
    await expect(
      ctx.prisma
        .$executeRaw`UPDATE "LookbookPost" SET area_country = 'x', area_city = 'y' WHERE id = ${id}`
    ).rejects.toThrow(/LookbookPost_area_hierarchical/)
    await expect(
      ctx.prisma
        .$executeRaw`UPDATE "LookbookPost" SET area_country = 'x', anonymized_at = now() WHERE id = ${id}`
    ).rejects.toThrow(/LookbookPost_area_cleared_when_anonymized/)
  })
})

describe('6.6 area clearing', () => {
  async function publishedInArea(author: string) {
    const area = ctx.area(randomUUID())
    const fixture = createLookbookPost({
      userId: author,
      publishedAt: hoursBeforeAsOf(1),
      locationKey: 'legacy-key',
      areaCountry: area.country.toLowerCase(),
      areaRegion: area.region.toLowerCase(),
      areaCity: area.city.toLowerCase(),
    })
    await ctx.prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(fixture) })
    return fixture.id
  }

  it('6.6-INT-053 erasure clears the components in the same update that clears location_key', async () => {
    const author = await ctx.member()
    const postId = await publishedInArea(author)
    await ctx.repository.withdrawPostAndRequestErasure(postId, new Date())
    const maintenance = new CommunityMaintenanceService(
      ctx.prisma,
      new InMemoryCommunityStorage()
    )
    await maintenance.sweepErasureRequests(new Date())
    await expect(
      ctx.prisma.lookbookPost.findUniqueOrThrow({
        where: { id: postId },
        select: { ...AREA_SELECT, anonymized_at: true },
      })
    ).resolves.toMatchObject({
      area_country: null,
      area_region: null,
      area_city: null,
      location_key: null,
      anonymized_at: expect.any(Date) as Date,
    })
  })

  it('6.6-INT-054 author withdrawal keeps the components; visibility alone hides the post', async () => {
    const author = await ctx.member()
    const postId = await publishedInArea(author)
    await ctx.repository.withdrawPostAndRequestErasure(postId, new Date())
    await expect(
      ctx.prisma.lookbookPost.findUniqueOrThrow({
        where: { id: postId },
        select: AREA_SELECT,
      })
    ).resolves.toMatchObject({
      area_country: expect.any(String) as string,
      area_city: expect.any(String) as string,
    })
  })

  it('6.6-INT-055 guardian consent suspension keeps the components on the suspended post', async () => {
    const guardianId = await ctx.member()
    const teen = await ctx.prisma.user.create({
      data: {
        email: `cc66-teen-${randomUUID()}@synthetic.test`,
        profile: {
          create: {
            birthdate: new Date('2012-01-01T00:00:00Z'),
            preferences: { compliance: { accountStatus: 'active' } },
          },
        },
      },
    })
    await ctx.prisma.guardianConsent.create({
      data: { guardian_id: guardianId, teen_id: teen.id, status: 'granted' },
    })
    const postId = await publishedInArea(teen.id)
    const guardian = new GuardianService(
      { capture: vi.fn() },
      ctx.prisma,
      { markTeenAccessRevoked: vi.fn(), markTeenAccessGranted: vi.fn() } as never,
      { invalidateUserSessions: vi.fn().mockResolvedValue(undefined) } as never
    )
    await guardian.revokeConsent(guardianId, teen.id)
    await expect(
      ctx.prisma.lookbookPost.findUniqueOrThrow({
        where: { id: postId },
        select: { ...AREA_SELECT, status: true },
      })
    ).resolves.toMatchObject({
      status: 'consent_suspended',
      area_country: expect.any(String) as string,
    })
  })
})
