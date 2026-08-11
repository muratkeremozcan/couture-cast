import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'
import {
  AffiliateOfferService,
  type AffiliateOutfitSlot,
} from '../src/modules/commerce/affiliate-offer.service.js'
import { CommerceRepository } from '../src/modules/commerce/commerce.repository.js'
import type { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'

/**
 * Real-PostgreSQL coverage for offer selection.
 *
 * The ordering rule and both window boundaries are SQL semantics. A mocked
 * Prisma can only prove that the statement contains the right text, which is
 * worth having (see `commerce.repository.spec.ts`) and is not the same thing as
 * proving the database returns the row the story says it should. Story failure
 * mode 5, a selection that is not totally ordered, produces a green suite and a
 * flaky product, so it is discharged here.
 */

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

/**
 * Probed in `beforeAll` rather than at module scope: these specs compile as
 * CommonJS, where top-level await is not permitted.
 */
let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "AffiliateOffer" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "CommercePartner" LIMIT 1`
    schemaReady = true
  } catch {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[commerce-affiliate-offers.integration] Skipped: PostgreSQL is missing the Story 5.1 commerce schema. ' +
        'Run `npm run db:migrate` to execute this suite.'
    )
  }
}

function requireSchema(context: { skip: () => void }): boolean {
  if (!schemaReady) {
    context.skip()
    return false
  }
  return true
}

describe('5.1 affiliate offer selection against real PostgreSQL', () => {
  const namespace = `commerce-offers-${randomUUID().slice(0, 8)}`
  let repository: CommerceRepository
  let service: AffiliateOfferService
  let userId: string
  let partnerId: string
  /** Ids of globally published seed offers switched off for this file only. */
  let parkedOfferIds: string[] = []

  const featureFlags = { getFeatureFlag: vi.fn().mockResolvedValue(true) }

  /**
   * Cleanup is registered BEFORE the assertions in each test, so a real failure
   * cannot manufacture a second one in a sibling test by leaving catalog rows
   * behind. Deletes are scoped to ids this run created; this database is shared
   * with other sessions and an unscoped delete would destroy their fixtures.
   */
  function cleanupOffers(offerIds: readonly string[]): void {
    onTestFinished(async () => {
      await prisma.affiliateOffer.deleteMany({ where: { id: { in: [...offerIds] } } })
    })
  }

  async function seedOffer(overrides: {
    id: string
    garmentCategory?: 'top' | 'bottom' | 'shoes'
    comfortRange?: 'cold' | 'mild' | null
    localeRegion?: string
    priority?: number
    status?: 'active' | 'inactive'
    effectiveFrom?: Date
    effectiveTo?: Date | null
  }): Promise<string> {
    const offer = await prisma.affiliateOffer.create({
      data: {
        id: `${namespace}-${overrides.id}`,
        partner_id: partnerId,
        garment_category: overrides.garmentCategory ?? 'top',
        comfort_range: overrides.comfortRange ?? null,
        locale_region: overrides.localeRegion ?? 'US',
        title: `Offer ${overrides.id}`,
        deep_link_template: 'https://partner.couturecast.test/shop?cc={clickToken}',
        priority: overrides.priority ?? 0,
        status: overrides.status ?? 'active',
        effective_from: overrides.effectiveFrom ?? new Date('2020-01-01T00:00:00.000Z'),
        effective_to: overrides.effectiveTo ?? null,
      },
    })
    return offer.id
  }

  /**
   * The database clock, truncated to the precision of the columns it is compared
   * against.
   *
   * `now()` carries microseconds while `effective_from` and `effective_to` are
   * `TIMESTAMP(3)`, so an untruncated reading is ROUNDED on write, and roughly
   * half the time it rounds UP. A value rounded up by a few hundred microseconds
   * lands in the future relative to the `now()` the select reads a moment later,
   * which silently inverts both window assertions below. That made these two
   * tests a coin flip rather than a boundary check.
   */
  async function databaseNow(): Promise<Date> {
    const rows = await prisma.$queryRaw<{ now: Date }[]>`
      SELECT date_trunc('milliseconds', now()) AS now
    `
    const now = rows[0]?.now
    if (!now) {
      throw new Error('Could not read the database clock')
    }
    return now
  }

  function outfit(garmentIds: readonly string[]): AffiliateOutfitSlot {
    return { id: 'outfit-morning', scenario: 'morning', garmentIds }
  }

  beforeAll(async () => {
    await probeSchema()
    if (!schemaReady) {
      return
    }

    repository = new CommerceRepository(prisma)
    service = new AffiliateOfferService(
      featureFlags as unknown as FeatureFlagsService,
      repository
    )

    const user = await prisma.user.create({
      data: { email: `${namespace}@synthetic.test` },
    })
    userId = user.id

    const partner = await prisma.commercePartner.create({
      data: {
        slug: `${namespace}-partner`,
        display_name: 'Integration Partner',
        allowed_host: 'partner.couturecast.test',
        status: 'active',
        webhook_secret_ref: 'COMMERCE_PARTNER_INTEGRATION_WEBHOOK_SECRET',
      },
    })
    partnerId = partner.id

    /*
     * Park the globally published catalog for the duration of this file.
     *
     * Decision 14 seeds `sample-partner` with offers at `locale_region: '*'`,
     * and decision 4 makes '*' on a catalog row match EVERY request region.
     * Both are correct and together they mean this database always has an offer
     * that matches any query, so "no offer was selected" is not a statement this
     * suite could otherwise make, and the seed's priority of 30 also outranks
     * every fixture here.
     *
     * Parking rather than deleting, and recording the exact ids rather than
     * re-activating everything at the end, because Playwright and Maestro setup
     * depend on that catalog being present and active. Restored in `afterAll`.
     */
    const globallyPublished = await prisma.affiliateOffer.findMany({
      where: { locale_region: '*', status: 'active', partner_id: { not: partnerId } },
      select: { id: true },
    })
    parkedOfferIds = globallyPublished.map((offer) => offer.id)

    if (parkedOfferIds.length > 0) {
      await prisma.affiliateOffer.updateMany({
        where: { id: { in: parkedOfferIds } },
        data: { status: 'inactive' },
      })
    }
  })

  beforeEach(() => {
    featureFlags.getFeatureFlag.mockResolvedValue(true)
  })

  afterAll(async () => {
    if (schemaReady) {
      // Un-park the globally published catalog first, so a failure in the
      // deletes below cannot leave the shared seed switched off for Playwright.
      if (parkedOfferIds.length > 0) {
        await prisma.affiliateOffer.updateMany({
          where: { id: { in: parkedOfferIds } },
          data: { status: 'active' },
        })
      }

      // Reverse dependency order: clicks and offers before partners and users.
      await prisma.affiliateClick.deleteMany({ where: { user_id: userId } })
      await prisma.affiliateOffer.deleteMany({ where: { partner_id: partnerId } })
      await prisma.commercePreference.deleteMany({ where: { user_id: userId } })
      await prisma.garmentItem.deleteMany({ where: { user_id: userId } })
      await prisma.commercePartner.deleteMany({ where: { id: partnerId } })
      await prisma.user.deleteMany({ where: { id: userId } })
    }
    await prisma.$disconnect()
  })

  describe('total ordering', () => {
    it('prefers an exact comfort range over a wildcard carrying higher priority', async (context) => {
      if (!requireSchema(context)) return

      const wildcard = await seedOffer({ id: 'wildcard', priority: 99 })
      const exact = await seedOffer({ id: 'exact', comfortRange: 'cold', priority: 0 })
      cleanupOffers([wildcard, exact])

      const match = await repository.findBestOffer(
        [{ category: 'top', comfortRange: 'cold' }],
        'US'
      )

      expect(match?.offer_id).toBe(exact)
    })

    it('ranks by priority within the same exactness group', async (context) => {
      if (!requireSchema(context)) return

      const low = await seedOffer({ id: 'low', priority: 1 })
      const high = await seedOffer({ id: 'high', priority: 5 })
      cleanupOffers([low, high])

      const match = await repository.findBestOffer(
        [{ category: 'top', comfortRange: null }],
        'US'
      )

      expect(match?.offer_id).toBe(high)
    })

    it('breaks a remaining tie on id ASC, which is what makes the result total', async (context) => {
      if (!requireSchema(context)) return

      // Seeded in reverse id order so a plan that returns insertion order would
      // pick the wrong row.
      const later = await seedOffer({ id: 'zzz-tie', priority: 7 })
      const earlier = await seedOffer({ id: 'aaa-tie', priority: 7 })
      cleanupOffers([later, earlier])

      const first = await repository.findBestOffer(
        [{ category: 'top', comfortRange: null }],
        'US'
      )
      const second = await repository.findBestOffer(
        [{ category: 'top', comfortRange: null }],
        'US'
      )

      expect(first?.offer_id).toBe(earlier)
      expect(second?.offer_id).toBe(earlier)
    })
  })

  describe('publication window, on the database clock', () => {
    it('excludes an offer whose effective_from has not arrived', async (context) => {
      if (!requireSchema(context)) return

      const now = await databaseNow()
      const future = await seedOffer({
        id: 'future',
        effectiveFrom: new Date(now.getTime() + 60_000),
      })
      cleanupOffers([future])

      const match = await repository.findBestOffer(
        [{ category: 'top', comfortRange: null }],
        'US'
      )

      expect(match).toBeNull()
    })

    it('includes an offer whose effective_from is the database clock reading', async (context) => {
      if (!requireSchema(context)) return

      // `effective_from <= now()` is inclusive; by the time the select runs the
      // clock has advanced past this instant, so this exercises the open side of
      // the boundary rather than an unreachable exact equality.
      const started = await seedOffer({
        id: 'started',
        effectiveFrom: await databaseNow(),
      })
      cleanupOffers([started])

      const match = await repository.findBestOffer(
        [{ category: 'top', comfortRange: null }],
        'US'
      )

      expect(match?.offer_id).toBe(started)
    })

    it('excludes an offer whose effective_to has already passed, exclusively', async (context) => {
      if (!requireSchema(context)) return

      const ended = await seedOffer({ id: 'ended', effectiveTo: await databaseNow() })
      cleanupOffers([ended])

      const match = await repository.findBestOffer(
        [{ category: 'top', comfortRange: null }],
        'US'
      )

      expect(match).toBeNull()
    })

    it('treats a null effective_to as open-ended', async (context) => {
      if (!requireSchema(context)) return

      const open = await seedOffer({ id: 'open', effectiveTo: null })
      cleanupOffers([open])

      const match = await repository.findBestOffer(
        [{ category: 'top', comfortRange: null }],
        'US'
      )

      expect(match?.offer_id).toBe(open)
    })
  })

  describe('predicate', () => {
    it('excludes an inactive offer', async (context) => {
      if (!requireSchema(context)) return

      const inactive = await seedOffer({ id: 'inactive', status: 'inactive' })
      cleanupOffers([inactive])

      const match = await repository.findBestOffer(
        [{ category: 'top', comfortRange: null }],
        'US'
      )

      expect(match).toBeNull()
    })

    it('excludes an offer published to a different locale region', async (context) => {
      if (!requireSchema(context)) return

      const canadian = await seedOffer({ id: 'ca', localeRegion: 'CA' })
      cleanupOffers([canadian])

      expect(
        await repository.findBestOffer([{ category: 'top', comfortRange: null }], 'US')
      ).toBeNull()
      expect(
        (await repository.findBestOffer([{ category: 'top', comfortRange: null }], 'CA'))
          ?.offer_id
      ).toBe(canadian)
    })

    it('excludes an active offer whose partner has been deactivated', async (context) => {
      if (!requireSchema(context)) return

      // The operator runbook pauses a partner by setting exactly this column.
      // Without a partner-status predicate that pause is silent: the offers stay
      // active and keep serving CTAs for a partner the operator believes is off.
      const offer = await seedOffer({ id: 'orphaned' })
      cleanupOffers([offer])

      await prisma.commercePartner.update({
        where: { id: partnerId },
        data: { status: 'inactive' },
      })
      onTestFinished(async () => {
        await prisma.commercePartner.update({
          where: { id: partnerId },
          data: { status: 'active' },
        })
      })

      const match = await repository.findBestOffer(
        [{ category: 'top', comfortRange: null }],
        'US'
      )
      expect(match).toBeNull()

      // And the same offer cannot be clicked through either, even by an id a
      // client is still holding from a payload rendered before the pause.
      await expect(repository.findActiveClickOffer(offer)).resolves.toBeNull()
    })

    it('publishes a globally published offer to every request region', async (context) => {
      if (!requireSchema(context)) return

      // Decision 4: '*' on a catalog row means "published globally". This is the
      // property decision 14's seeded catalog depends on, and it was absent from
      // the first implementation: `locale_region` was compared for exact
      // equality only, so every seeded offer was unreachable to any real user
      // and AC 1's positive path could not be demonstrated anywhere.
      const global = await seedOffer({ id: 'global', localeRegion: '*' })
      cleanupOffers([global])

      for (const region of ['US', 'CA', '419']) {
        const match = await repository.findBestOffer(
          [{ category: 'top', comfortRange: null }],
          region
        )
        expect(match?.offer_id).toBe(global)
      }
    })

    it('matches a request with no resolvable locale against globally published rows', async (context) => {
      if (!requireSchema(context)) return

      // The other direction of the same sentinel: a request that resolves to no
      // region at all also arrives as '*'.
      const global = await seedOffer({ id: 'global-request', localeRegion: '*' })
      const regional = await seedOffer({ id: 'regional', localeRegion: 'US' })
      cleanupOffers([global, regional])

      const match = await repository.findBestOffer(
        [{ category: 'top', comfortRange: null }],
        '*'
      )

      expect(match?.offer_id).toBe(global)
    })

    it('matches a placeholder slot against wildcard rows only', async (context) => {
      if (!requireSchema(context)) return

      const exact = await seedOffer({
        id: 'exact-only',
        comfortRange: 'mild',
        priority: 99,
      })
      cleanupOffers([exact])

      // A `default-{category}` slot carries a null comfort range, and
      // `comfort_range = NULL` is never true, so an exact row cannot match it
      // however high its priority.
      expect(
        await repository.findBestOffer([{ category: 'top', comfortRange: null }], 'US')
      ).toBeNull()
    })

    it('excludes an offer for a garment category the outfit has no slot for', async (context) => {
      if (!requireSchema(context)) return

      const shoes = await seedOffer({ id: 'shoes', garmentCategory: 'shoes' })
      cleanupOffers([shoes])

      expect(
        await repository.findBestOffer([{ category: 'top', comfortRange: null }], 'US')
      ).toBeNull()
    })
  })

  describe('end to end through the eligibility chain', () => {
    it('derives a slot from a real garment row and resolves its offer', async (context) => {
      if (!requireSchema(context)) return

      const garment = await prisma.garmentItem.create({
        data: {
          user_id: userId,
          object_path: `${namespace}/${randomUUID()}.png`,
          category: 'bottom',
          material: 'denim',
          comfort_range: 'cold',
          upload_status: 'ready',
          retention_status: 'active',
        },
      })
      onTestFinished(async () => {
        await prisma.garmentItem.deleteMany({ where: { id: garment.id } })
      })
      const offerId = await seedOffer({
        id: 'bottom-cold',
        garmentCategory: 'bottom',
        comfortRange: 'cold',
      })
      cleanupOffers([offerId])

      const resolved = await service.resolveShopThisLook({
        userId,
        outfits: [outfit([garment.id])],
        requestedLocale: 'en-US',
      })

      expect(resolved.get('outfit-morning')).toMatchObject({
        offerId,
        garmentCategory: 'bottom',
        partnerId: `${namespace}-partner`,
      })
    })

    it('emits null for every outfit once the user has opted out', async (context) => {
      if (!requireSchema(context)) return

      const offerId = await seedOffer({ id: 'opted-out' })
      cleanupOffers([offerId])
      await prisma.commercePreference.create({
        data: { user_id: userId, affiliate_ctas_enabled: false },
      })
      onTestFinished(async () => {
        await prisma.commercePreference.deleteMany({ where: { user_id: userId } })
      })

      const resolved = await service.resolveShopThisLook({
        userId,
        outfits: [outfit(['default-top'])],
        requestedLocale: 'en-US',
      })

      expect(resolved.get('outfit-morning')).toBeNull()
    })

    it('emits null for every outfit while the kill switch is off', async (context) => {
      if (!requireSchema(context)) return

      const offerId = await seedOffer({ id: 'flag-off' })
      cleanupOffers([offerId])
      featureFlags.getFeatureFlag.mockResolvedValue(false)

      const resolved = await service.resolveShopThisLook({
        userId,
        outfits: [outfit(['default-top'])],
        requestedLocale: 'en-US',
      })

      expect(resolved.get('outfit-morning')).toBeNull()
    })
  })
})
