import type {
  AffiliateClick,
  AffiliateConversion,
  AffiliateConversionStatus,
  AffiliateOffer,
  AffiliateOfferStatus,
  CommercePartner,
  CommercePartnerStatus,
  CommercePreference,
  GarmentCategory,
  GarmentComfortRange,
  Prisma,
  PrismaClient,
} from '@prisma/client'
import { createFactory, faker } from './factory.js'
import { registerCreatedEntity } from './registry.js'

/**
 * Story 5.1: deterministic fixtures for the affiliate commerce tables.
 *
 * Two conventions here exist because of real constraints in the migration, and
 * a fixture that ignores either fails at the database rather than in an
 * assertion:
 *
 *   * `webhookSecretRef` must match
 *     `^COMMERCE_PARTNER_[A-Z0-9_]{1,40}_WEBHOOK_SECRET$`. The default below is
 *     derived from the slug so a caller who overrides the slug still gets a
 *     legal name. Secret VALUES never appear in a fixture.
 *   * `deepLinkTemplate` must contain the literal `{clickToken}` and must sit on
 *     the partner's `allowedHost`, because the click endpoint validates both.
 *
 * Hosts are always under `.test`, reserved by RFC 2606 so they can never resolve
 * on the public internet.
 */

type CommercePrismaClient = PrismaClient | Prisma.TransactionClient

const FIXTURE_ALLOWED_HOST = 'partner.couturecast.test'

/** Uppercases and strips a slug down to the character class the check constraint allows. */
function toSecretRef(slug: string): string {
  const normalized = slug
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .slice(0, 40)
  return `COMMERCE_PARTNER_${normalized || 'FIXTURE'}_WEBHOOK_SECRET`
}

// --- CommercePartner -------------------------------------------------------

export interface CommercePartnerFixture {
  id: string
  slug: string
  displayName: string
  allowedHost: string
  status: CommercePartnerStatus
  webhookSecretRef: string
}

export type CommercePartnerFactoryOverrides = Partial<CommercePartnerFixture>

function buildDefaultCommercePartnerFixture(): CommercePartnerFixture {
  const slug = `test-partner-${faker.string.alphanumeric(8).toLowerCase()}`

  return {
    id: faker.string.uuid(),
    slug,
    displayName: 'Test Partner',
    allowedHost: FIXTURE_ALLOWED_HOST,
    // Active by default: an inactive partner makes every offer unreachable, and
    // a fixture whose default is "invisible" wastes a debugging session per use.
    status: 'active',
    webhookSecretRef: toSecretRef(slug),
  }
}

const mergeCommercePartnerFixture = createFactory<CommercePartnerFixture>(
  buildDefaultCommercePartnerFixture
)

export function createCommercePartner(
  overrides: CommercePartnerFactoryOverrides = {}
): CommercePartnerFixture {
  const fixture = mergeCommercePartnerFixture(overrides)

  // A caller who overrode the slug but not the secret ref would otherwise carry
  // the default slug's derived name, which is legal but misleading.
  if (overrides.slug !== undefined && overrides.webhookSecretRef === undefined) {
    fixture.webhookSecretRef = toSecretRef(fixture.slug)
  }

  return fixture
}

export async function persistCommercePartner(
  prisma: CommercePrismaClient,
  fixture: CommercePartnerFixture
): Promise<CommercePartner> {
  const partner = await prisma.commercePartner.create({
    data: {
      id: fixture.id,
      slug: fixture.slug,
      display_name: fixture.displayName,
      allowed_host: fixture.allowedHost,
      status: fixture.status,
      webhook_secret_ref: fixture.webhookSecretRef,
    },
  })

  registerCreatedEntity('commercePartners', partner.id)
  return partner
}

// --- AffiliateOffer --------------------------------------------------------

export interface AffiliateOfferFixture {
  id: string
  partnerId: string
  garmentCategory: GarmentCategory
  comfortRange: GarmentComfortRange | null
  localeRegion: string
  title: string
  deepLinkTemplate: string
  priority: number
  status: AffiliateOfferStatus
  effectiveFrom: Date
  effectiveTo: Date | null
}

export type AffiliateOfferFactoryOverrides = Partial<AffiliateOfferFixture>

function buildDefaultAffiliateOfferFixture(): AffiliateOfferFixture {
  return {
    id: faker.string.uuid(),
    partnerId: faker.string.uuid(),
    garmentCategory: 'top',
    // Null is the wildcard, which is what a `default-{category}` placeholder
    // slot can match. Defaulting to a concrete range would make the common
    // fresh-user case silently return no offer.
    comfortRange: null,
    localeRegion: '*',
    title: 'Test Affiliate Offer',
    deepLinkTemplate: `https://${FIXTURE_ALLOWED_HOST}/shop?cc={clickToken}`,
    priority: 0,
    status: 'active',
    // Backdated so the window is open the instant the row lands. An
    // `effective_from` of `now()` races the very next query.
    effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
    effectiveTo: null,
  }
}

const mergeAffiliateOfferFixture = createFactory<AffiliateOfferFixture>(
  buildDefaultAffiliateOfferFixture
)

export function createAffiliateOffer(
  overrides: AffiliateOfferFactoryOverrides = {}
): AffiliateOfferFixture {
  return mergeAffiliateOfferFixture(overrides)
}

export async function persistAffiliateOffer(
  prisma: CommercePrismaClient,
  fixture: AffiliateOfferFixture
): Promise<AffiliateOffer> {
  const offer = await prisma.affiliateOffer.create({
    data: {
      id: fixture.id,
      partner_id: fixture.partnerId,
      garment_category: fixture.garmentCategory,
      comfort_range: fixture.comfortRange,
      locale_region: fixture.localeRegion,
      title: fixture.title,
      deep_link_template: fixture.deepLinkTemplate,
      priority: fixture.priority,
      status: fixture.status,
      effective_from: fixture.effectiveFrom,
      effective_to: fixture.effectiveTo,
    },
  })

  registerCreatedEntity('affiliateOffers', offer.id)
  return offer
}

// --- CommercePreference ----------------------------------------------------

export interface CommercePreferenceFixture {
  id: string
  userId: string
  affiliateCtasEnabled: boolean
}

export type CommercePreferenceFactoryOverrides = Partial<CommercePreferenceFixture>

function buildDefaultCommercePreferenceFixture(): CommercePreferenceFixture {
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    // Matches the column default and the "missing row means enabled" rule, so a
    // fixture and an absent row behave identically.
    affiliateCtasEnabled: true,
  }
}

const mergeCommercePreferenceFixture = createFactory<CommercePreferenceFixture>(
  buildDefaultCommercePreferenceFixture
)

export function createCommercePreference(
  overrides: CommercePreferenceFactoryOverrides = {}
): CommercePreferenceFixture {
  return mergeCommercePreferenceFixture(overrides)
}

export async function persistCommercePreference(
  prisma: CommercePrismaClient,
  fixture: CommercePreferenceFixture
): Promise<CommercePreference> {
  const preference = await prisma.commercePreference.create({
    data: {
      id: fixture.id,
      user_id: fixture.userId,
      affiliate_ctas_enabled: fixture.affiliateCtasEnabled,
    },
  })

  registerCreatedEntity('commercePreferences', preference.id)
  return preference
}

// --- AffiliateClick --------------------------------------------------------

export interface AffiliateClickFixture {
  id: string
  token: string
  userId: string
  offerId: string
  partnerId: string
  recommendationId: string
  scenario: string
  surface: string
  localeRegion: string
  createdAt?: Date
}

export type AffiliateClickFactoryOverrides = Partial<AffiliateClickFixture>

function buildDefaultAffiliateClickFixture(): AffiliateClickFixture {
  return {
    id: faker.string.uuid(),
    // A synthetic stand-in, not a real HMAC. Tests that care about the token
    // being a genuine HMAC over the row id must mint it through the service.
    token: `test-click-token-${faker.string.alphanumeric(24)}`,
    userId: faker.string.uuid(),
    offerId: faker.string.uuid(),
    partnerId: faker.string.uuid(),
    recommendationId: faker.string.uuid(),
    scenario: 'morning',
    surface: 'mobile_hero',
    localeRegion: 'US',
  }
}

const mergeAffiliateClickFixture = createFactory<AffiliateClickFixture>(
  buildDefaultAffiliateClickFixture
)

export function createAffiliateClick(
  overrides: AffiliateClickFactoryOverrides = {}
): AffiliateClickFixture {
  return mergeAffiliateClickFixture(overrides)
}

export async function persistAffiliateClick(
  prisma: CommercePrismaClient,
  fixture: AffiliateClickFixture
): Promise<AffiliateClick> {
  const click = await prisma.affiliateClick.create({
    data: {
      id: fixture.id,
      token: fixture.token,
      user_id: fixture.userId,
      offer_id: fixture.offerId,
      partner_id: fixture.partnerId,
      recommendation_id: fixture.recommendationId,
      scenario: fixture.scenario,
      surface: fixture.surface,
      locale_region: fixture.localeRegion,
      // Explicit createdAt is what lets a dedupe-window test place two rows on
      // either side of the 60-second boundary without sleeping.
      ...(fixture.createdAt ? { created_at: fixture.createdAt } : {}),
    },
  })

  registerCreatedEntity('affiliateClicks', click.id)
  return click
}

// --- AffiliateConversion ---------------------------------------------------

export interface AffiliateConversionFixture {
  id: string
  partnerId: string
  externalEventId: string
  affiliateClickId: string | null
  status: AffiliateConversionStatus
  orderValueMinorUnits: number
  currency: string
  occurredAt: Date
}

export type AffiliateConversionFactoryOverrides = Partial<AffiliateConversionFixture>

function buildDefaultAffiliateConversionFixture(): AffiliateConversionFixture {
  return {
    id: faker.string.uuid(),
    partnerId: faker.string.uuid(),
    externalEventId: `evt-${faker.string.alphanumeric(16)}`,
    affiliateClickId: null,
    status: 'confirmed',
    // Integer minor units. A float here fails the column type, which is the
    // point: floating-point money is prohibited repo-wide.
    orderValueMinorUnits: 12_900,
    currency: 'USD',
    occurredAt: new Date('2026-08-11T10:00:00.000Z'),
  }
}

const mergeAffiliateConversionFixture = createFactory<AffiliateConversionFixture>(
  buildDefaultAffiliateConversionFixture
)

export function createAffiliateConversion(
  overrides: AffiliateConversionFactoryOverrides = {}
): AffiliateConversionFixture {
  return mergeAffiliateConversionFixture(overrides)
}

export async function persistAffiliateConversion(
  prisma: CommercePrismaClient,
  fixture: AffiliateConversionFixture
): Promise<AffiliateConversion> {
  const conversion = await prisma.affiliateConversion.create({
    data: {
      id: fixture.id,
      partner_id: fixture.partnerId,
      external_event_id: fixture.externalEventId,
      affiliate_click_id: fixture.affiliateClickId,
      status: fixture.status,
      order_value_minor_units: fixture.orderValueMinorUnits,
      currency: fixture.currency,
      occurred_at: fixture.occurredAt,
    },
  })

  registerCreatedEntity('affiliateConversions', conversion.id)
  return conversion
}

// --- Composed graph --------------------------------------------------------

export interface PersistedCommerceCatalog {
  partner: CommercePartner
  offer: AffiliateOffer
}

/**
 * The common setup: one active partner with one active wildcard offer, wired
 * together so the offer's `partner_id` actually points at the partner. Building
 * these separately and forgetting to link them is the single most common way a
 * commerce test fails with "no offer matched" for a reason unrelated to what it
 * meant to assert.
 */
export async function persistCommerceCatalog(
  prisma: CommercePrismaClient,
  overrides: {
    partner?: CommercePartnerFactoryOverrides
    offer?: AffiliateOfferFactoryOverrides
  } = {}
): Promise<PersistedCommerceCatalog> {
  const partner = await persistCommercePartner(
    prisma,
    createCommercePartner(overrides.partner)
  )

  const offer = await persistAffiliateOffer(
    prisma,
    createAffiliateOffer({ ...overrides.offer, partnerId: partner.id })
  )

  return { partner, offer }
}
