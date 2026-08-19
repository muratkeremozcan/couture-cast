import type {
  BillingCustomer,
  BillingEvent,
  BillingProvider,
  EntitlementStore,
  PremiumEntitlement,
  PremiumEntitlementStatus,
  PremiumThemeKey,
  PremiumThemePreference,
  Prisma,
  PrismaClient,
} from '@prisma/client'
import { createFactory, faker } from './factory.js'
import { registerCreatedEntity } from './registry.js'

/**
 * Story 5.2: deterministic fixtures for the premium billing tables.
 *
 * Conventions that exist because of real constraints in the migration:
 *
 *   * `externalEventId` must be non-empty — the (provider, external_event_id)
 *     unique index is the webhook idempotency barrier and a check constraint
 *     rejects empty ids.
 *   * `payload` is an allowlisted projection, never a raw provider body. The
 *     default below carries only allowlisted keys so a fixture can never smuggle
 *     a receipt id or an email into an assertion.
 *   * BillingEvent is append-only past its outbox columns: a fixture that needs
 *     a different financial value needs a new row, not an update.
 *
 * Entitlement timestamps default to fixed instants (period end far in the
 * future, event clock in the past) so ordering-guard tests can place events on
 * either side without sleeping.
 *
 * Story 5.3 adds PremiumThemePreference to the same file rather than a new one:
 * it is the same premium domain, and the theme preference only ever appears
 * beside an entitlement in a fixture graph.
 */

type PremiumPrismaClient = PrismaClient | Prisma.TransactionClient

// --- PremiumEntitlement ------------------------------------------------------

export interface PremiumEntitlementFixture {
  id: string
  userId: string
  status: PremiumEntitlementStatus
  store: EntitlementStore
  productId: string
  willRenew: boolean
  currentPeriodEnd: Date
  syncedAt: Date
  lastEventOccurredAt: Date
  lastEventId: string
}

export type PremiumEntitlementFactoryOverrides = Partial<PremiumEntitlementFixture>

function buildDefaultPremiumEntitlementFixture(): PremiumEntitlementFixture {
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    // Active by default: most consumers exercise the entitled branch, and the
    // guard's deny branch is one explicit override away.
    status: 'active',
    store: 'stripe',
    productId: 'premium_monthly',
    willRenew: true,
    // Fixed instants, not now()-relative: an ordering-guard test places its
    // events against lastEventOccurredAt without racing the wall clock.
    currentPeriodEnd: new Date('2027-01-01T00:00:00.000Z'),
    syncedAt: new Date('2026-08-01T00:00:00.000Z'),
    lastEventOccurredAt: new Date('2026-08-01T00:00:00.000Z'),
    lastEventId: `evt-${faker.string.alphanumeric(16)}`,
  }
}

const mergePremiumEntitlementFixture = createFactory<PremiumEntitlementFixture>(
  buildDefaultPremiumEntitlementFixture
)

export function createPremiumEntitlement(
  overrides: PremiumEntitlementFactoryOverrides = {}
): PremiumEntitlementFixture {
  return mergePremiumEntitlementFixture(overrides)
}

/**
 * The snake_case Prisma input for one fixture, exported separately from
 * {@link persistPremiumEntitlement} so callers that cannot use a plain
 * `create` still route through the factory. The integration suites upsert the
 * same user repeatedly (the guard matrix walks every status without clearing
 * between iterations), and before this existed each of them hand-rolled the
 * mapping twice over — once per upsert branch — which is how four suites came
 * to re-hardcode the factory's own pinned instants.
 */
export function buildPremiumEntitlementCreateInput(
  fixture: PremiumEntitlementFixture
): Prisma.PremiumEntitlementUncheckedCreateInput {
  return {
    id: fixture.id,
    user_id: fixture.userId,
    status: fixture.status,
    store: fixture.store,
    product_id: fixture.productId,
    will_renew: fixture.willRenew,
    current_period_end: fixture.currentPeriodEnd,
    synced_at: fixture.syncedAt,
    last_event_occurred_at: fixture.lastEventOccurredAt,
    last_event_id: fixture.lastEventId,
  }
}

export async function persistPremiumEntitlement(
  prisma: PremiumPrismaClient,
  fixture: PremiumEntitlementFixture
): Promise<PremiumEntitlement> {
  const entitlement = await prisma.premiumEntitlement.create({
    data: buildPremiumEntitlementCreateInput(fixture),
  })

  registerCreatedEntity('premiumEntitlements', entitlement.id)
  return entitlement
}

// --- BillingEvent ------------------------------------------------------------

export interface BillingEventFixture {
  id: string
  provider: BillingProvider
  externalEventId: string
  eventType: string
  userId: string | null
  store: EntitlementStore | null
  productId: string | null
  payload: Record<string, unknown>
  occurredAt: Date
  forwardDue: boolean
  forwardedAt: Date | null
  forwardAttempts: number
  forwardLastError: string | null
}

export type BillingEventFactoryOverrides = Partial<BillingEventFixture>

function buildDefaultBillingEventFixture(): BillingEventFixture {
  return {
    id: faker.string.uuid(),
    provider: 'revenuecat',
    externalEventId: `evt-${faker.string.alphanumeric(16)}`,
    eventType: 'INITIAL_PURCHASE',
    userId: null,
    store: 'stripe',
    productId: 'premium_monthly',
    // Allowlisted projection keys only — mirrors the Decision 6 shape.
    payload: {
      eventType: 'INITIAL_PURCHASE',
      store: 'stripe',
      productId: 'premium_monthly',
      periodType: 'normal',
      purchasedAtMs: 1_754_990_000_000,
      expirationAtMs: 1_757_582_000_000,
      cancelReason: null,
      environment: 'sandbox',
    },
    occurredAt: new Date('2026-08-11T10:00:00.000Z'),
    forwardDue: false,
    forwardedAt: null,
    forwardAttempts: 0,
    forwardLastError: null,
  }
}

const mergeBillingEventFixture = createFactory<BillingEventFixture>(
  buildDefaultBillingEventFixture
)

export function createBillingEvent(
  overrides: BillingEventFactoryOverrides = {}
): BillingEventFixture {
  return mergeBillingEventFixture(overrides)
}

/**
 * See {@link buildPremiumEntitlementCreateInput}. This one additionally keeps
 * the Decision 6 payload projection in ONE place: a suite that hand-rolls the
 * allowlisted keys re-states the very contract `5.2-FACTORY-05` pins, so a
 * projection change would have to be found in every suite that copied it.
 */
export function buildBillingEventCreateInput(
  fixture: BillingEventFixture
): Prisma.BillingEventUncheckedCreateInput {
  return {
    id: fixture.id,
    provider: fixture.provider,
    external_event_id: fixture.externalEventId,
    event_type: fixture.eventType,
    user_id: fixture.userId,
    store: fixture.store,
    product_id: fixture.productId,
    payload: fixture.payload as Prisma.InputJsonValue,
    occurred_at: fixture.occurredAt,
    forward_due: fixture.forwardDue,
    forwarded_at: fixture.forwardedAt,
    forward_attempts: fixture.forwardAttempts,
    forward_last_error: fixture.forwardLastError,
  }
}

export async function persistBillingEvent(
  prisma: PremiumPrismaClient,
  fixture: BillingEventFixture
): Promise<BillingEvent> {
  const event = await prisma.billingEvent.create({
    data: buildBillingEventCreateInput(fixture),
  })

  registerCreatedEntity('billingEvents', event.id)
  return event
}

// --- BillingCustomer ---------------------------------------------------------

export interface BillingCustomerFixture {
  id: string
  userId: string
  stripeCustomerId: string
}

export type BillingCustomerFactoryOverrides = Partial<BillingCustomerFixture>

function buildDefaultBillingCustomerFixture(): BillingCustomerFixture {
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    // Stripe-shaped but synthetic; a real customer id never enters a fixture.
    stripeCustomerId: `cus_test_${faker.string.alphanumeric(14)}`,
  }
}

const mergeBillingCustomerFixture = createFactory<BillingCustomerFixture>(
  buildDefaultBillingCustomerFixture
)

export function createBillingCustomer(
  overrides: BillingCustomerFactoryOverrides = {}
): BillingCustomerFixture {
  return mergeBillingCustomerFixture(overrides)
}

/** See {@link buildPremiumEntitlementCreateInput}. */
export function buildBillingCustomerCreateInput(
  fixture: BillingCustomerFixture
): Prisma.BillingCustomerUncheckedCreateInput {
  return {
    id: fixture.id,
    user_id: fixture.userId,
    stripe_customer_id: fixture.stripeCustomerId,
  }
}

export async function persistBillingCustomer(
  prisma: PremiumPrismaClient,
  fixture: BillingCustomerFixture
): Promise<BillingCustomer> {
  const customer = await prisma.billingCustomer.create({
    data: buildBillingCustomerCreateInput(fixture),
  })

  registerCreatedEntity('billingCustomers', customer.id)
  return customer
}

// --- PremiumThemePreference --------------------------------------------------

export interface PremiumThemePreferenceFixture {
  id: string
  userId: string
  /** NULL is Default, and it is a real value here, not "unset". */
  theme: PremiumThemeKey | null
}

export type PremiumThemePreferenceFactoryOverrides =
  Partial<PremiumThemePreferenceFixture>

function buildDefaultPremiumThemePreferenceFixture(): PremiumThemePreferenceFixture {
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    // A named palette by default: the interesting fixture is a user who has
    // actually chosen one, and Default is one explicit `theme: null` away.
    // Jewel Radiance is the only palette whose primary accent clears the 4.5:1
    // small-text floor against white, so it is the safest default to render.
    theme: 'jewel_radiance',
  }
}

const mergePremiumThemePreferenceFixture = createFactory<PremiumThemePreferenceFixture>(
  buildDefaultPremiumThemePreferenceFixture
)

export function createPremiumThemePreference(
  overrides: PremiumThemePreferenceFactoryOverrides = {}
): PremiumThemePreferenceFixture {
  return mergePremiumThemePreferenceFixture(overrides)
}

/**
 * See {@link buildPremiumEntitlementCreateInput}. `theme` is passed through
 * even when it is null, because null is the Default selection rather than an
 * omitted field, and letting the column default fill it in would make the two
 * cases indistinguishable in a fixture.
 */
export function buildPremiumThemePreferenceCreateInput(
  fixture: PremiumThemePreferenceFixture
): Prisma.PremiumThemePreferenceUncheckedCreateInput {
  return {
    id: fixture.id,
    user_id: fixture.userId,
    theme: fixture.theme,
  }
}

export async function persistPremiumThemePreference(
  prisma: PremiumPrismaClient,
  fixture: PremiumThemePreferenceFixture
): Promise<PremiumThemePreference> {
  const preference = await prisma.premiumThemePreference.create({
    data: buildPremiumThemePreferenceCreateInput(fixture),
  })

  registerCreatedEntity('premiumThemePreferences', preference.id)
  return preference
}
