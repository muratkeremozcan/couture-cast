import { beforeEach, describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import { createMockPrisma, type MockPrisma } from '../../testing/prisma-mock.js'
import { CommerceRepository, type CommerceOfferSlot } from './commerce.repository.js'

/** The `Prisma.Sql` handed to `$queryRaw`, with `$1`-style placeholders. */
function lastRawQuery(mock: MockPrisma): Prisma.Sql {
  const call = mock.$queryRaw.mock.calls.at(-1)
  if (!call) {
    throw new Error('$queryRaw was never called')
  }
  return call[0] as Prisma.Sql
}

/** Collapses the formatting whitespace so assertions read as SQL, not layout. */
function normalizeSql(sql: Prisma.Sql): string {
  return sql.text.replace(/\s+/g, ' ').trim()
}

const TOP_SLOT: CommerceOfferSlot = { category: 'top', comfortRange: 'cold' }

describe('CommerceRepository', () => {
  let prisma: MockPrisma
  let repository: CommerceRepository

  beforeEach(() => {
    prisma = createMockPrisma()
    repository = new CommerceRepository(prisma.asPrismaClient())
  })

  describe('findAffiliateCtasEnabled', () => {
    it('returns null when the user has no stored row', async () => {
      prisma.commercePreference.findUnique.mockResolvedValue(null)

      await expect(repository.findAffiliateCtasEnabled('user-1')).resolves.toBeNull()
    })

    it('returns the stored value when a row exists', async () => {
      prisma.commercePreference.findUnique.mockResolvedValue({
        affiliate_ctas_enabled: false,
      })

      await expect(repository.findAffiliateCtasEnabled('user-1')).resolves.toBe(false)
    })
  })

  describe('setAffiliateCtasEnabled', () => {
    it('writes the preference and an audit row in the same transaction', async () => {
      prisma.commercePreference.findUnique.mockResolvedValue({
        affiliate_ctas_enabled: true,
      })

      const result = await repository.setAffiliateCtasEnabled(
        'user-1',
        false,
        '203.0.113.7'
      )

      expect(result).toEqual({ affiliateCtasEnabled: false, auditWritten: true })
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(prisma.commercePreference.upsert).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
        create: { user_id: 'user-1', affiliate_ctas_enabled: false },
        update: { affiliate_ctas_enabled: false },
      })
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          user_id: 'user-1',
          event_type: 'commerce_affiliate_opt_out_changed',
          event_data: { enabled: false },
          ip_address: '203.0.113.7',
        },
      })
    })

    it('records a null ip_address when the request has no resolvable client IP', async () => {
      prisma.commercePreference.findUnique.mockResolvedValue({
        affiliate_ctas_enabled: true,
      })

      await repository.setAffiliateCtasEnabled('user-1', false, undefined)

      const auditCall = prisma.auditLog.create.mock.calls[0]?.[0] as {
        data: { ip_address: string | null }
      }
      expect(auditCall.data.ip_address).toBeNull()
    })

    it('creates the row and the audit entry when the user has never had one', async () => {
      prisma.commercePreference.findUnique.mockResolvedValue(null)

      const result = await repository.setAffiliateCtasEnabled('user-1', false, undefined)

      expect(result).toEqual({ affiliateCtasEnabled: false, auditWritten: true })
      expect(prisma.commercePreference.upsert).toHaveBeenCalledTimes(1)
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1)
    })

    it('writes nothing when the stored value already matches', async () => {
      prisma.commercePreference.findUnique.mockResolvedValue({
        affiliate_ctas_enabled: false,
      })

      const result = await repository.setAffiliateCtasEnabled('user-1', false, undefined)

      expect(result).toEqual({ affiliateCtasEnabled: false, auditWritten: false })
      expect(prisma.commercePreference.upsert).not.toHaveBeenCalled()
      expect(prisma.auditLog.create).not.toHaveBeenCalled()
    })

    it('writes nothing when no row exists and the submitted value is the default', async () => {
      prisma.commercePreference.findUnique.mockResolvedValue(null)

      const result = await repository.setAffiliateCtasEnabled('user-1', true, undefined)

      expect(result).toEqual({ affiliateCtasEnabled: true, auditWritten: false })
      expect(prisma.commercePreference.upsert).not.toHaveBeenCalled()
      expect(prisma.auditLog.create).not.toHaveBeenCalled()
    })
  })

  describe('findGarmentSlots', () => {
    it('does not query at all for an outfit with no real garment ids', async () => {
      await expect(repository.findGarmentSlots('user-1', [])).resolves.toEqual([])
      expect(prisma.garmentItem.findMany).not.toHaveBeenCalled()
    })

    it('scopes the batched read to the acting user', async () => {
      await repository.findGarmentSlots('user-1', ['g1', 'g2'])

      expect(prisma.garmentItem.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['g1', 'g2'] }, user_id: 'user-1' },
        select: { id: true, category: true, comfort_range: true },
      })
    })
  })

  describe('findUserCommerceContext', () => {
    it.each([
      {
        name: 'a stored string locale',
        preferences: { locale: 'fr-CA' },
        expected: 'fr-CA',
      },
      { name: 'a non-string locale', preferences: { locale: 42 }, expected: undefined },
      {
        name: 'preferences without a locale',
        preferences: { units: 'metric' },
        expected: undefined,
      },
      { name: 'an array value', preferences: ['fr-CA'], expected: undefined },
      { name: 'null preferences', preferences: null, expected: undefined },
    ])('reads $expected as the locale for $name', async ({ preferences, expected }) => {
      prisma.userProfile.findUnique.mockResolvedValue({ preferences, birthdate: null })

      const context = await repository.findUserCommerceContext('user-1')

      expect(context.locale).toBe(expected)
    })

    it('loads the birthdate alongside the locale in one query', async () => {
      const birthdate = new Date('2010-05-04T00:00:00.000Z')
      prisma.userProfile.findUnique.mockResolvedValue({
        preferences: { locale: 'en-US' },
        birthdate,
      })

      await expect(repository.findUserCommerceContext('user-1')).resolves.toEqual({
        birthdate,
        locale: 'en-US',
      })
      expect(prisma.userProfile.findUnique).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
        select: { preferences: true, birthdate: true },
      })
    })

    it('returns an empty context when the user has no profile', async () => {
      prisma.userProfile.findUnique.mockResolvedValue(null)

      await expect(repository.findUserCommerceContext('user-1')).resolves.toEqual({
        birthdate: null,
        locale: undefined,
      })
    })
  })

  describe('findRecommendationScenario', () => {
    it('scopes the lookup to the acting user', async () => {
      prisma.outfitRecommendation.findFirst.mockResolvedValue({ scenario: 'midday' })

      await expect(
        repository.findRecommendationScenario('user-1', 'rec-1')
      ).resolves.toBe('midday')
      expect(prisma.outfitRecommendation.findFirst).toHaveBeenCalledWith({
        where: { id: 'rec-1', user_id: 'user-1' },
        select: { scenario: true },
      })
    })

    it('returns null for a recommendation that has rotated away', async () => {
      prisma.outfitRecommendation.findFirst.mockResolvedValue(null)

      await expect(
        repository.findRecommendationScenario('user-1', 'rec-1')
      ).resolves.toBeNull()
    })
  })

  describe('findBestOffer', () => {
    it('does not query when the outfit derived no slots', async () => {
      await expect(repository.findBestOffer([], 'US')).resolves.toBeNull()
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })

    /**
     * These four assertions are the guard on story failure mode 5. Dropping any
     * leg of this ordering still returns a row, so nothing else in the suite
     * would go red: attribution would simply stop being comparable between two
     * requests for the same outfit, and every E2E assertion on `offerId` would
     * start flaking.
     */
    it('orders exact matches before wildcards, then by priority, then by id', async () => {
      await repository.findBestOffer([TOP_SLOT], 'US')

      expect(normalizeSql(lastRawQuery(prisma))).toContain(
        'ORDER BY (o."comfort_range" IS NULL) ASC, o."priority" DESC, o."id" ASC LIMIT 1'
      )
    })

    it('reads the window boundaries from the database clock in the same statement', async () => {
      await repository.findBestOffer([TOP_SLOT], 'US')

      const sql = normalizeSql(lastRawQuery(prisma))
      // The AT TIME ZONE 'UTC' wrapper is the assertion, not noise. These
      // columns are `timestamp without time zone` holding UTC instants, while
      // `now()` is `timestamptz`; comparing them bare makes PostgreSQL read the
      // naive side in the session time zone and shifts every window boundary by
      // the server's UTC offset. A bare now() here would be a real defect.
      expect(sql).toContain('o."effective_from" <= (now() AT TIME ZONE \'UTC\')')
      expect(sql).toContain(
        '(o."effective_to" IS NULL OR (now() AT TIME ZONE \'UTC\') < o."effective_to")'
      )
      expect(sql).not.toMatch(/[^E]\bnow\(\)\s*[<>]/)
    })

    it('matches a slot against its exact comfort range or a wildcard row', async () => {
      await repository.findBestOffer([TOP_SLOT], 'US')

      const query = lastRawQuery(prisma)
      expect(normalizeSql(query)).toContain(
        'o."comfort_range" = $3::"GarmentComfortRange" OR o."comfort_range" IS NULL'
      )
      expect(query.values).toEqual(['US', 'top', 'cold'])
    })

    it('binds a null comfort range for a placeholder slot, which matches wildcards only', async () => {
      await repository.findBestOffer([{ category: 'shoes', comfortRange: null }], '*')

      // `comfort_range = NULL` is never true in SQL, so the OR leg reduces to
      // `comfort_range IS NULL`. That is what makes a `default-{category}`
      // placeholder match wildcard offers and nothing else.
      expect(lastRawQuery(prisma).values).toEqual(['*', 'shoes', null])
    })

    it('ORs one clause per derived slot', async () => {
      await repository.findBestOffer(
        [TOP_SLOT, { category: 'bottom', comfortRange: null }],
        'US'
      )

      const sql = normalizeSql(lastRawQuery(prisma))
      expect(sql).toContain('o."garment_category" = $2::"GarmentCategory"')
      expect(sql).toContain('o."garment_category" = $4::"GarmentCategory"')
    })

    it('restricts to active offers in the requested locale region', async () => {
      await repository.findBestOffer([TOP_SLOT], 'CA')

      const sql = normalizeSql(lastRawQuery(prisma))
      expect(sql).toContain('o."status" = \'active\'::"AffiliateOfferStatus"')
      expect(sql).toContain('o."locale_region" = $1')
    })

    it('returns null when nothing matched', async () => {
      prisma.$queryRaw.mockResolvedValue([])

      await expect(repository.findBestOffer([TOP_SLOT], 'US')).resolves.toBeNull()
    })

    it('returns the single winning row', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          offer_id: 'offer-1',
          offer_title: 'Merino base layer',
          garment_category: 'top',
          partner_slug: 'sample-partner',
          partner_display_name: 'Sample Partner',
        },
      ])

      await expect(repository.findBestOffer([TOP_SLOT], 'US')).resolves.toMatchObject({
        offer_id: 'offer-1',
      })
    })
  })

  describe('findActiveClickOffer', () => {
    it('re-checks status and window on the database clock', async () => {
      await repository.findActiveClickOffer('offer-1')

      const query = lastRawQuery(prisma)
      const sql = normalizeSql(query)
      expect(sql).toContain('o."status" = \'active\'::"AffiliateOfferStatus"')
      // The AT TIME ZONE 'UTC' wrapper is the assertion, not noise. These
      // columns are `timestamp without time zone` holding UTC instants, while
      // `now()` is `timestamptz`; comparing them bare makes PostgreSQL read the
      // naive side in the session time zone and shifts every window boundary by
      // the server's UTC offset. A bare now() here would be a real defect.
      expect(sql).toContain('o."effective_from" <= (now() AT TIME ZONE \'UTC\')')
      expect(sql).toContain(
        '(o."effective_to" IS NULL OR (now() AT TIME ZONE \'UTC\') < o."effective_to")'
      )
      expect(sql).not.toMatch(/[^E]\bnow\(\)\s*[<>]/)
      expect(query.values).toEqual(['offer-1'])
    })

    it('returns null for an unknown, inactive, or out-of-window offer', async () => {
      prisma.$queryRaw.mockResolvedValue([])

      await expect(repository.findActiveClickOffer('offer-1')).resolves.toBeNull()
    })
  })

  describe('findRecentClick', () => {
    it('applies a strictly-greater 60-second window on the database clock', async () => {
      await repository.findRecentClick('user-1', 'offer-1', 'rec-1')

      const query = lastRawQuery(prisma)
      // Strictly greater: a click at exactly 60.000 seconds is a miss and mints
      // a fresh row. Both sides of that boundary are asserted against real
      // PostgreSQL in integration/commerce-affiliate-clicks.integration.spec.ts.
      // A regex rather than toContain: the clause carries both quote styles, and
      // prettier and the `quotes` rule disagree about how to spell a string
      // literal that does, with no form satisfying both.
      expect(normalizeSql(query)).toMatch(
        /"created_at" > \(now\(\) AT TIME ZONE 'UTC'\) - interval '60 seconds'/
      )
      expect(query.values).toEqual(['user-1', 'offer-1', 'rec-1'])
    })

    it('returns null when nothing is inside the window', async () => {
      prisma.$queryRaw.mockResolvedValue([])

      await expect(
        repository.findRecentClick('user-1', 'offer-1', 'rec-1')
      ).resolves.toBeNull()
    })
  })

  describe('findLatestClick', () => {
    it('takes the newest row for the triple, ignoring the 60-second window', async () => {
      prisma.affiliateClick.findFirst.mockResolvedValue({
        id: 'click-1',
        token: 'tok',
        offer_id: 'offer-1',
      })

      await expect(
        repository.findLatestClick('user-1', 'offer-1', 'rec-1')
      ).resolves.toMatchObject({ id: 'click-1' })
      expect(prisma.affiliateClick.findFirst).toHaveBeenCalledWith({
        where: { user_id: 'user-1', offer_id: 'offer-1', recommendation_id: 'rec-1' },
        orderBy: { created_at: 'desc' },
        select: { id: true, token: true, offer_id: true },
      })
    })
  })

  describe('createClick', () => {
    it('inserts the caller-supplied id and token together', async () => {
      prisma.affiliateClick.create.mockResolvedValue({
        id: 'click-1',
        token: 'tok',
        offer_id: 'offer-1',
      })

      await repository.createClick({
        id: 'click-1',
        token: 'tok',
        userId: 'user-1',
        offerId: 'offer-1',
        partnerId: 'partner-1',
        recommendationId: 'rec-1',
        scenario: 'morning',
        surface: 'mobile_hero',
        localeRegion: 'US',
      })

      expect(prisma.affiliateClick.create).toHaveBeenCalledWith({
        data: {
          id: 'click-1',
          token: 'tok',
          user_id: 'user-1',
          offer_id: 'offer-1',
          partner_id: 'partner-1',
          recommendation_id: 'rec-1',
          scenario: 'morning',
          surface: 'mobile_hero',
          locale_region: 'US',
        },
        select: { id: true, token: true, offer_id: true },
      })
    })
  })

  describe('retention helpers', () => {
    const cutoff = new Date('2024-08-11T00:00:00.000Z')

    it('selects the oldest expired conversions by received_at', async () => {
      prisma.affiliateConversion.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }])

      await expect(repository.findExpiredConversionIds(cutoff, 500)).resolves.toEqual([
        'c1',
        'c2',
      ])
      expect(prisma.affiliateConversion.findMany).toHaveBeenCalledWith({
        where: { received_at: { lt: cutoff } },
        select: { id: true },
        orderBy: { received_at: 'asc' },
        take: 500,
      })
    })

    it('selects the oldest expired clicks by created_at', async () => {
      prisma.affiliateClick.findMany.mockResolvedValue([{ id: 'k1' }])

      await expect(repository.findExpiredClickIds(cutoff, 500)).resolves.toEqual(['k1'])
      expect(prisma.affiliateClick.findMany).toHaveBeenCalledWith({
        where: { created_at: { lt: cutoff } },
        select: { id: true },
        orderBy: { created_at: 'asc' },
        take: 500,
      })
    })

    it.each([
      { name: 'conversions', run: () => repository.deleteConversionsByIds([]) },
      { name: 'clicks', run: () => repository.deleteClicksByIds([]) },
    ])('issues no delete for an empty $name batch', async ({ run }) => {
      await expect(run()).resolves.toBe(0)
      expect(prisma.affiliateConversion.deleteMany).not.toHaveBeenCalled()
      expect(prisma.affiliateClick.deleteMany).not.toHaveBeenCalled()
    })

    it('deletes conversions by id and reports the count', async () => {
      prisma.affiliateConversion.deleteMany.mockResolvedValue({ count: 2 })

      await expect(repository.deleteConversionsByIds(['c1', 'c2'])).resolves.toBe(2)
      expect(prisma.affiliateConversion.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['c1', 'c2'] } },
      })
    })

    it('deletes clicks by id and reports the count', async () => {
      prisma.affiliateClick.deleteMany.mockResolvedValue({ count: 1 })

      await expect(repository.deleteClicksByIds(['k1'])).resolves.toBe(1)
      expect(prisma.affiliateClick.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['k1'] } },
      })
    })
  })
})
