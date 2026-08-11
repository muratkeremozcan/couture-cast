import type { PrismaClient } from '@prisma/client'

/**
 * Story 5.1 decision 14: making the affiliate feature reachable.
 *
 * Three independent gates default to off (the `commerce_affiliate_enabled`
 * feature flag, an empty catalog, and an unset partner secret). Without this
 * seed, AC 1's positive path cannot be demonstrated anywhere and every
 * end-to-end task in the story would be uncloseable.
 *
 * There is no public catalog API and there is not supposed to be one: the
 * catalog is operator-managed, and rows arrive only by seed or migration. So
 * end-to-end setup is "seeded catalog plus public-API user setup", never
 * public-API catalog setup.
 */

/**
 * Mirrors `allowsTestOnlySecrets` in
 * `apps/api/src/config/runtime-environment.ts`. It is duplicated rather than
 * imported because `packages/db` must not reach into `apps/api`; the two are
 * kept identical deliberately, and the commerce schema spec asserts the seed
 * writes nothing when this returns false.
 *
 * Everything in this file is gated on it. The partner host is synthetic, the
 * webhook secret resolves only through the same non-production fallback, and
 * the feature flag row it enables is the single lever that turns commerce on.
 * None of that may ever exist in production.
 */
export function allowsCommerceSeeding(
  env: Readonly<NodeJS.ProcessEnv> = process.env
): boolean {
  return env.NODE_ENV === 'test' || (env.TEST_ENV ?? '').trim().toLowerCase() === 'local'
}

/** The seeded partner slug. Referenced by end-to-end and integration setup. */
export const SAMPLE_PARTNER_SLUG = 'sample-partner'

/**
 * A reserved-for-testing host, never a real domain. `.test` is reserved by
 * RFC 2606 precisely so it can never resolve on the public internet, which
 * means a leaked seed row cannot send a user anywhere real.
 */
export const SAMPLE_PARTNER_ALLOWED_HOST = 'partner.couturecast.test'

/**
 * The NAME of the environment variable holding the seeded partner's webhook
 * secret, never the secret itself. Matches the
 * `^COMMERCE_PARTNER_[A-Z0-9_]{1,40}_WEBHOOK_SECRET$` check constraint on
 * `CommercePartner.webhook_secret_ref`.
 */
export const SAMPLE_PARTNER_WEBHOOK_SECRET_REF =
  'COMMERCE_PARTNER_SAMPLE_PARTNER_WEBHOOK_SECRET'

/**
 * Wildcard offers: `comfort_range: null` matches any slot, and
 * `locale_region: '*'` publishes globally. Both are required for the seeded
 * catalog to match a `default-{category}` placeholder slot, which is what a
 * fresh end-to-end user's ritual actually contains before any real garment is
 * uploaded.
 */
const SAMPLE_OFFERS = [
  { category: 'top', title: 'Everyday Layering Tee', priority: 30 },
  { category: 'bottom', title: 'All-Weather Chino', priority: 20 },
  { category: 'dress', title: 'Transitional Midi Dress', priority: 20 },
  { category: 'shoes', title: 'City Rain Sneaker', priority: 10 },
] as const

export type SeededCommerceCatalog = {
  partnerId: string
  offerIds: string[]
}

export async function seedCommerceCatalog(
  prisma: PrismaClient,
  env: Readonly<NodeJS.ProcessEnv> = process.env
): Promise<SeededCommerceCatalog | null> {
  if (!allowsCommerceSeeding(env)) {
    return null
  }

  const partner = await prisma.commercePartner.upsert({
    where: { slug: SAMPLE_PARTNER_SLUG },
    update: {
      display_name: 'Sample Partner',
      allowed_host: SAMPLE_PARTNER_ALLOWED_HOST,
      status: 'active',
      webhook_secret_ref: SAMPLE_PARTNER_WEBHOOK_SECRET_REF,
    },
    create: {
      slug: SAMPLE_PARTNER_SLUG,
      display_name: 'Sample Partner',
      allowed_host: SAMPLE_PARTNER_ALLOWED_HOST,
      status: 'active',
      webhook_secret_ref: SAMPLE_PARTNER_WEBHOOK_SECRET_REF,
    },
  })

  // `effective_from` is backdated so the window is already open the instant the
  // seed finishes, and `effective_to` stays null (open-ended). A seed that
  // opened its window at `now()` would race the very next request.
  const effectiveFrom = new Date('2020-01-01T00:00:00.000Z')

  const offerIds: string[] = []

  for (const offer of SAMPLE_OFFERS) {
    // AffiliateOffer has no natural unique key, so the seed reads before it
    // writes rather than upserting. `db:seed` runs after `db:reset` in this
    // repo but is also invoked standalone, and a seed that duplicated its own
    // catalog on a second run would make offer selection ambiguous and every
    // end-to-end assertion order-dependent.
    const existing = await prisma.affiliateOffer.findFirst({
      where: {
        partner_id: partner.id,
        garment_category: offer.category,
        comfort_range: null,
        locale_region: '*',
      },
      select: { id: true },
    })

    if (existing) {
      const updated = await prisma.affiliateOffer.update({
        where: { id: existing.id },
        data: {
          title: offer.title,
          deep_link_template: buildSampleDeepLinkTemplate(offer.category),
          priority: offer.priority,
          status: 'active',
          effective_from: effectiveFrom,
          effective_to: null,
        },
        select: { id: true },
      })
      offerIds.push(updated.id)
      continue
    }

    const created = await prisma.affiliateOffer.create({
      data: {
        partner_id: partner.id,
        garment_category: offer.category,
        comfort_range: null,
        locale_region: '*',
        title: offer.title,
        deep_link_template: buildSampleDeepLinkTemplate(offer.category),
        priority: offer.priority,
        status: 'active',
        effective_from: effectiveFrom,
        effective_to: null,
      },
      select: { id: true },
    })
    offerIds.push(created.id)
  }

  return { partnerId: partner.id, offerIds }
}

/**
 * The literal `{clickToken}` placeholder is mandatory: the click endpoint
 * rejects a template without it as operator misconfiguration rather than
 * redirecting to a URL that carries no attribution.
 */
function buildSampleDeepLinkTemplate(category: string): string {
  return `https://${SAMPLE_PARTNER_ALLOWED_HOST}/shop/${category}?cc={clickToken}`
}
