import { timingSafeEqual } from 'node:crypto'
import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import {
  Prisma,
  PrismaClient,
  type EntitlementStore,
  type PremiumEntitlement,
} from '@prisma/client'
import Stripe from 'stripe'
import { z } from 'zod'
import {
  BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE,
  type BillingWebhookResponse,
} from '../../contracts/http.js'
import {
  buildTestOnlyRevenueCatWebhookAuth,
  buildTestOnlyStripeWebhookSecret,
  resolveRevenueCatWebhookAuth,
  resolveStripeWebhookSecret,
} from './billing-webhook-secrets.js'

// Re-exported so existing importers keep one import site. The definitions live
// in a Nest-free module because suites outside the Nest runtime import them.
export {
  buildTestOnlyRevenueCatWebhookAuth,
  buildTestOnlyStripeWebhookSecret,
  resolveRevenueCatWebhookAuth,
  resolveStripeWebhookSecret,
}
import { createBaseLogger } from '../../logger/pino.config.js'
import {
  PremiumEntitlementService,
  type EntitlementTransition,
  type LedgerEntitlementState,
} from './premium-entitlement.service.js'
import { RevenueCatClient } from './revenuecat-client.js'
import { STRIPE_API_VERSION } from './stripe-client.js'
import { SubscriptionService } from './subscription.service.js'

/**
 * Story 5.2 Tasks 4+5: both billing webhook rails.
 *
 * THE THREE PROPERTIES THAT SHAPE EVERYTHING BELOW (5.1's affiliate webhook
 * invariants, inherited verbatim):
 *
 * 1. **Uniform rejection.** Every credential failure on either rail returns
 *    the same 401 + {@link BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE}; the reason is
 *    logged only. Payloads are parsed ONLY after authentication.
 *
 * 2. **Idempotent by `(provider, external_event_id)`.** Replays are dropped at
 *    the pre-read or at the unique index before any transition logic runs, and
 *    they are indistinguishable from first deliveries (200 either way).
 *
 * 3. **A delivery is never bounced for a fact we cannot change.** Unknown
 *    event types, unknown app_user_ids, and unknown Stripe customers all
 *    return 200 and record the `BillingEvent` with what is known (user link
 *    null); `api_error_occurred` never fires for these routes (excluded by
 *    exact path in the ApiExceptionFilter).
 *
 * ONE ENTITLEMENT WRITER (Decision 1): only the RevenueCat rail transitions
 * `PremiumEntitlement`. The Stripe rail records events and forwards checkout
 * subscriptions to RevenueCat; entitlement state then flows back through the
 * RevenueCat webhook, keeping a single writer and no dual-writer drift.
 */

// ---------------------------------------------------------------------------
// Secret resolution (Decision 10: validate at point of use, test-only fallbacks)
// ---------------------------------------------------------------------------

/** Byte-length check before timingSafeEqual (`affiliate-webhook-signature.ts` hazard). */
function safeEquals(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  if (candidateBytes.length !== expectedBytes.length) {
    return false
  }
  return timingSafeEqual(candidateBytes, expectedBytes)
}

// ---------------------------------------------------------------------------
// Payload projection (Decision 6)
// ---------------------------------------------------------------------------

/**
 * The allowlisted projection persisted as `BillingEvent.payload` — NEVER the
 * raw provider body. Unmappable fields are null. Explicitly banned from
 * persistence and logs: subscriber attributes, email, name, address, card
 * metadata, promotional codes, full webhook bodies.
 *
 * `fetchToken` is the one deliberate extension to the Decision 6 field list:
 * the Stripe subscription id on forward-obligation events. The reconciliation
 * sweep re-drives a due row by calling `POST /v1/receipts` with exactly this
 * token; without it persisted, a failed inline forward would be unrecoverable
 * and the payment lost — the precise failure the outbox exists to prevent. It
 * is an opaque `sub_…` reference (the receipt pointer, not PII).
 */
export type BillingEventPayloadProjection = {
  eventType: string | null
  store: string | null
  productId: string | null
  periodType: string | null
  purchasedAtMs: number | null
  expirationAtMs: number | null
  cancelReason: string | null
  environment: string | null
  fetchToken: string | null
}

const rcStoreMap: Readonly<Record<string, EntitlementStore>> = {
  APP_STORE: 'app_store',
  MAC_APP_STORE: 'app_store',
  PLAY_STORE: 'play_store',
  STRIPE: 'stripe',
  PROMOTIONAL: 'promotional',
}

/** RevenueCat store strings arrive uppercase; unknown stores map to null. */
export function mapRevenueCatStore(
  store: string | null | undefined
): EntitlementStore | null {
  if (!store) {
    return null
  }
  return rcStoreMap[store.toUpperCase()] ?? null
}

/**
 * The RevenueCat webhook envelope, minimally typed. `.passthrough()` on
 * purpose: RC adds fields between API versions and an unknown sibling field
 * must never turn a delivery into a 400. Only structurally unusable bodies
 * (no event id, no type, no timestamp) are rejected.
 */
const revenueCatEventSchema = z
  .object({
    event: z
      .object({
        id: z.string().min(1),
        type: z.string().min(1),
        event_timestamp_ms: z.number().int(),
        app_user_id: z.string().min(1).nullish(),
        original_app_user_id: z.string().min(1).nullish(),
        product_id: z.string().min(1).nullish(),
        period_type: z.string().nullish(),
        purchased_at_ms: z.number().int().nullish(),
        expiration_at_ms: z.number().int().nullish(),
        store: z.string().nullish(),
        environment: z.string().nullish(),
        cancel_reason: z.string().nullish(),
        transferred_from: z.array(z.string()).nullish(),
        transferred_to: z.array(z.string()).nullish(),
      })
      .passthrough(),
  })
  .passthrough()

export type RevenueCatEvent = z.infer<typeof revenueCatEventSchema>['event']

export function projectRevenueCatEventPayload(
  event: RevenueCatEvent
): BillingEventPayloadProjection {
  return {
    eventType: event.type,
    store: mapRevenueCatStore(event.store),
    productId: event.product_id ?? null,
    periodType: event.period_type ?? null,
    purchasedAtMs: event.purchased_at_ms ?? null,
    expirationAtMs: event.expiration_at_ms ?? null,
    cancelReason: event.cancel_reason ?? null,
    environment: event.environment ?? null,
    fetchToken: null,
  }
}

/** Reads a nested value defensively off a Stripe event object. */
function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

type StripeEventObject = Record<string, unknown>

function stripeEventObject(event: Stripe.Event): StripeEventObject {
  return event.data.object as unknown as StripeEventObject
}

/** The price lookup key from a subscription object's first item, when present. */
function stripePriceLookupKey(object: StripeEventObject): string | null {
  const items = object.items as { data?: Record<string, unknown>[] } | undefined
  const price = items?.data?.[0]?.price as Record<string, unknown> | undefined
  return asString(price?.lookup_key) ?? null
}

function stripeMetadataValue(object: StripeEventObject, key: string): string | null {
  const metadata = object.metadata as Record<string, unknown> | undefined
  return asString(metadata?.[key])
}

export function projectStripeEventPayload(
  event: Stripe.Event,
  fetchToken: string | null
): BillingEventPayloadProjection {
  const object = stripeEventObject(event)
  const cancellationDetails = object.cancellation_details as
    | Record<string, unknown>
    | undefined
  const currentPeriodEnd =
    typeof object.current_period_end === 'number' ? object.current_period_end : null

  return {
    eventType: event.type,
    store: 'stripe',
    productId: stripePriceLookupKey(object) ?? stripeMetadataValue(object, 'plan'),
    periodType: null,
    purchasedAtMs: null,
    expirationAtMs: currentPeriodEnd === null ? null : currentPeriodEnd * 1000,
    cancelReason: asString(cancellationDetails?.reason),
    environment: typeof event.livemode === 'boolean' ? String(event.livemode) : null,
    fetchToken,
  }
}

// ---------------------------------------------------------------------------
// The Decision 4 transition table
// ---------------------------------------------------------------------------

type TransitionPlan =
  | { kind: 'record-only' }
  | { kind: 'apply'; state: LedgerEntitlementState }
  | { kind: 'transfer' }

const RECORD_ONLY: TransitionPlan = { kind: 'record-only' }

/**
 * Decision 4's table, written AS a table — one entry per event row, no cell
 * invented here:
 *
 *   - `INITIAL_PURCHASE`/`RENEWAL`/`UNCANCELLATION`/`REFUND_REVERSED` → active
 *   - `PRODUCT_CHANGE` → active (the upgrade/downgrade record; product and
 *     period from the event)
 *   - `CANCELLATION` → active with `willRenew: false` — the guess-wrong trap,
 *     now specified: the user keeps what they paid for until period end, and
 *     `EXPIRATION` performs the downgrade
 *   - `BILLING_ISSUE` → grace_period (access retained; the guard passes it)
 *   - `SUBSCRIPTION_EXTENDED`/`TEMPORARY_ENTITLEMENT_GRANT` → active with the
 *     event's expiry (RC issues grants during store outages)
 *   - `SUBSCRIPTION_PAUSED` (period end governs access), `NON_RENEWING_PURCHASE`
 *     (no such product in this story), and `TEST` (RC's webhook-setup ping)
 *     are deliberately absent → record-only
 */
const REVENUECAT_TRANSITION_TABLE: Readonly<
  Record<string, { status: LedgerEntitlementState['status']; willRenew: boolean }>
> = {
  INITIAL_PURCHASE: { status: 'active', willRenew: true },
  RENEWAL: { status: 'active', willRenew: true },
  PRODUCT_CHANGE: { status: 'active', willRenew: true },
  CANCELLATION: { status: 'active', willRenew: false },
  UNCANCELLATION: { status: 'active', willRenew: true },
  BILLING_ISSUE: { status: 'grace_period', willRenew: true },
  EXPIRATION: { status: 'expired', willRenew: false },
  REFUND_REVERSED: { status: 'active', willRenew: true },
  SUBSCRIPTION_EXTENDED: { status: 'active', willRenew: true },
  TEMPORARY_ENTITLEMENT_GRANT: { status: 'active', willRenew: true },
}

/**
 * Unknown types fall through to record-only — the enumeration is not assumed
 * exhaustive and a delivery is never bounced for a fact we cannot change. An
 * apply row missing the fields a valid state needs (store, product, period
 * end) likewise degrades to record-only rather than bouncing.
 */
export function planRevenueCatTransition(event: RevenueCatEvent): TransitionPlan {
  if (event.type === 'TRANSFER') {
    return { kind: 'transfer' }
  }

  const cell = REVENUECAT_TRANSITION_TABLE[event.type]
  if (cell === undefined) {
    return RECORD_ONLY
  }

  const store = mapRevenueCatStore(event.store)
  const productId = event.product_id ?? null
  const periodEndMs = event.expiration_at_ms ?? null
  if (!store || !productId || periodEndMs === null) {
    return RECORD_ONLY
  }

  return {
    kind: 'apply',
    state: {
      status: cell.status,
      store,
      productId,
      willRenew: cell.willRenew,
      currentPeriodEnd: new Date(periodEndMs),
    },
  }
}

/**
 * The gaining side of a TRANSFER: the event's store/product/expiry when
 * carried; otherwise the losing row's — a TRANSFER moves an existing
 * subscription, so the loser's record is the authoritative fallback. Neither
 * known → null, and the caller writes no entitlement.
 */
function resolveTransferGainState(
  event: RevenueCatEvent,
  losingRow: PremiumEntitlement | null
): LedgerEntitlementState | null {
  const store = mapRevenueCatStore(event.store) ?? losingRow?.store ?? null
  const productId = event.product_id ?? losingRow?.product_id ?? null
  const currentPeriodEnd =
    event.expiration_at_ms !== null && event.expiration_at_ms !== undefined
      ? new Date(event.expiration_at_ms)
      : (losingRow?.current_period_end ?? null)

  if (store === null || productId === null || currentPeriodEnd === null) {
    return null
  }
  return { status: 'active', store, productId, willRenew: true, currentPeriodEnd }
}

// ---------------------------------------------------------------------------

/** What the controller pulls off the requests; all of it untrusted. */
export type StripeWebhookRequestInput = {
  readonly signature: string | undefined
  readonly rawBody: Buffer | undefined
}

export type RevenueCatWebhookRequestInput = {
  readonly authorization: string | undefined
  readonly rawBody: Buffer | undefined
}

type RejectionReason =
  | 'signature_missing'
  | 'authorization_missing'
  | 'raw_body_missing'
  | 'secret_unresolvable'
  | 'signature_mismatch'
  | 'credential_mismatch'

const RC_PAYLOAD_INVALID_PREFIX = 'Invalid RevenueCat webhook payload'

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

const RECEIVED: BillingWebhookResponse = { data: { received: true } }

@Injectable()
export class BillingWebhookService {
  private readonly logger = createBaseLogger().child({ feature: 'billing-webhook' })

  /**
   * Real `stripe` library, ALWAYS, for signature verification (Decision 9):
   * `constructEvent` is pure local HMAC over the raw bytes and it is this
   * route's only authentication, so it is never faked. The key on this
   * instance is a placeholder — verification never uses it, and no outbound
   * call is ever made through this instance (outbound goes through the
   * `StripeBillingClient` seam).
   */
  private readonly stripeVerifier = new Stripe('sk_webhook_verification_only', {
    apiVersion: STRIPE_API_VERSION,
  })

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(PremiumEntitlementService)
    private readonly entitlements: PremiumEntitlementService,
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
    @Inject(RevenueCatClient) private readonly revenueCat: RevenueCatClient
  ) {}

  // -------------------------------------------------------------------------
  // Stripe rail (Task 4)
  // -------------------------------------------------------------------------

  async handleStripeWebhook(
    input: StripeWebhookRequestInput
  ): Promise<BillingWebhookResponse> {
    const secret = resolveStripeWebhookSecret()
    if (secret === null) {
      throw this.reject('stripe', 'secret_unresolvable')
    }
    if (!input.signature) {
      throw this.reject('stripe', 'signature_missing')
    }
    if (input.rawBody === undefined) {
      // Ours, not Stripe's: without `rawBody: true` on the serving bootstrap
      // no signature can ever verify (5.1 B1's exact lesson).
      this.logger.error(
        {},
        'Stripe webhook received with no raw body. The Nest bootstrap serving this request was created without rawBody: true.'
      )
      throw this.reject('stripe', 'raw_body_missing')
    }

    let event: Stripe.Event
    try {
      event = this.stripeVerifier.webhooks.constructEvent(
        input.rawBody,
        input.signature,
        secret
      )
    } catch {
      // Tampered body, stale timestamp, and wrong secret all land here and
      // are deliberately indistinguishable from outside.
      throw this.reject('stripe', 'signature_mismatch')
    }

    const replay = await this.findExistingEvent('stripe', event.id)
    if (replay) {
      return RECEIVED
    }

    const subject = await this.resolveStripeSubject(event)
    // The forward outbox rule (Decision 4): checkout.session.completed is the
    // primary trigger; customer.subscription.created is RC's own recommended
    // redundant trigger — both carry the same fetch token and the forward is
    // idempotent on RevenueCat's side.
    const isForwardTrigger =
      event.type === 'checkout.session.completed' ||
      event.type === 'customer.subscription.created'
    const forwardDue =
      isForwardTrigger && subject.userId !== null && subject.subscriptionId !== null

    let billingEventId: string
    try {
      const row = await this.prisma.billingEvent.create({
        data: {
          provider: 'stripe',
          external_event_id: event.id,
          event_type: event.type,
          user_id: subject.userId,
          store: 'stripe',
          product_id: stripePriceLookupKey(stripeEventObject(event)),
          payload: projectStripeEventPayload(
            event,
            forwardDue ? subject.subscriptionId : null
          ) as unknown as Prisma.InputJsonValue,
          occurred_at: new Date(event.created * 1000),
          forward_due: forwardDue,
        },
        select: { id: true },
      })
      billingEventId = row.id
    } catch (error: unknown) {
      if (isUniqueConstraintViolation(error)) {
        // A concurrent delivery of the same event id won the unique-index
        // race; this delivery is a replay by another name.
        return RECEIVED
      }
      throw error
    }

    if (forwardDue && subject.userId && subject.subscriptionId) {
      // Persist-then-attempt: the obligation is already durable, so a failed
      // forward still acks 200 and the reconciliation sweep re-drives it.
      await this.attemptForward(billingEventId, subject.userId, subject.subscriptionId)
    }

    return RECEIVED
  }

  /**
   * Session→user linkage per Decision 4: `client_reference_id` first (and its
   * metadata twin), `BillingCustomer` lookup by customer id second. A resolved
   * id is verified against the User table so an unknown or deleted user
   * records with `user_id: null` instead of failing the foreign key.
   */
  private async resolveStripeSubject(event: Stripe.Event): Promise<{
    userId: string | null
    subscriptionId: string | null
  }> {
    const object = stripeEventObject(event)

    const customerRaw = object.customer
    const customerId =
      asString(customerRaw) ??
      asString((customerRaw as Record<string, unknown> | undefined)?.id)

    const claimedUserId =
      asString(object.client_reference_id) ?? stripeMetadataValue(object, 'userId')

    let userId: string | null = null
    if (claimedUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: claimedUserId },
        select: { id: true },
      })
      userId = user?.id ?? null
    }
    if (userId === null && customerId) {
      const billingCustomer = await this.prisma.billingCustomer.findUnique({
        where: { stripe_customer_id: customerId },
        select: { user_id: true },
      })
      userId = billingCustomer?.user_id ?? null
    }

    // checkout.session.completed carries the subscription as a field; on
    // customer.subscription.* the object itself IS the subscription.
    const subscriptionId = event.type.startsWith('customer.subscription.')
      ? asString(object.id)
      : (asString(object.subscription) ??
        asString((object.subscription as Record<string, unknown> | undefined)?.id))

    return { userId, subscriptionId }
  }

  /**
   * One forward attempt against the ledger, never throwing: the BillingEvent
   * row already holds the obligation durably, the webhook must still 200, and
   * the reconciliation sweep re-drives `forward_due AND forwarded_at IS NULL`
   * rows until one attempt succeeds.
   */
  async attemptForward(
    billingEventId: string,
    userId: string,
    stripeSubscriptionId: string
  ): Promise<boolean> {
    try {
      await this.revenueCat.forwardStripeSubscription(userId, stripeSubscriptionId)
      await this.prisma.billingEvent.update({
        where: { id: billingEventId },
        data: {
          forwarded_at: new Date(),
          forward_attempts: { increment: 1 },
          forward_last_error: null,
        },
      })
      return true
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        { billingEventId, error: message },
        'RevenueCat forward failed; outbox row stays due for the reconciliation sweep'
      )
      await this.prisma.billingEvent.update({
        where: { id: billingEventId },
        data: {
          forward_attempts: { increment: 1 },
          forward_last_error: message.slice(0, 500),
        },
      })
      return false
    }
  }

  // -------------------------------------------------------------------------
  // RevenueCat rail (Task 5)
  // -------------------------------------------------------------------------

  async handleRevenueCatWebhook(
    input: RevenueCatWebhookRequestInput
  ): Promise<BillingWebhookResponse> {
    const expected = resolveRevenueCatWebhookAuth()
    if (expected === null) {
      throw this.reject('revenuecat', 'secret_unresolvable')
    }
    if (!input.authorization) {
      throw this.reject('revenuecat', 'authorization_missing')
    }
    if (!safeEquals(input.authorization, expected)) {
      throw this.reject('revenuecat', 'credential_mismatch')
    }
    if (input.rawBody === undefined) {
      this.logger.error(
        {},
        'RevenueCat webhook received with no raw body. The Nest bootstrap serving this request was created without rawBody: true.'
      )
      throw this.reject('revenuecat', 'raw_body_missing')
    }

    // Parsed ONLY after authentication, from the raw bytes.
    const event = this.parseRevenueCatEvent(input.rawBody)

    const replay = await this.findExistingEvent('revenuecat', event.id)
    if (replay) {
      return RECEIVED
    }

    const plan = planRevenueCatTransition(event)
    if (plan.kind === 'transfer') {
      return this.applyTransfer(event)
    }

    if (plan.kind === 'record-only') {
      this.logger.info(
        { eventType: event.type, eventId: event.id },
        'RevenueCat event recorded without transition'
      )
    }

    const userId = await this.resolveLocalUserId(
      event.app_user_id ?? event.original_app_user_id ?? null
    )
    const occurredAt = new Date(event.event_timestamp_ms)

    let transition: EntitlementTransition | null = null
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.billingEvent.create({
          data: {
            provider: 'revenuecat',
            external_event_id: event.id,
            event_type: event.type,
            user_id: userId,
            store: mapRevenueCatStore(event.store),
            product_id: event.product_id ?? null,
            payload: projectRevenueCatEventPayload(
              event
            ) as unknown as Prisma.InputJsonValue,
            occurred_at: occurredAt,
          },
        })
        if (plan.kind === 'apply' && userId !== null) {
          transition = await this.entitlements.applyLedgerEvent(tx, {
            userId,
            state: plan.state,
            occurredAt,
            eventId: event.id,
            provider: 'revenuecat',
          })
        }
      })
    } catch (error: unknown) {
      if (isUniqueConstraintViolation(error)) {
        return RECEIVED
      }
      throw error
    }

    if (transition !== null && userId !== null) {
      // After commit, fail-open (5.1 Decision 12): a degraded PostHog must
      // never fail a billing webhook.
      await this.subscriptions.emitTransition(userId, transition)
    }

    return RECEIVED
  }

  /**
   * TRANSFER two-user semantics (Decision 4), in one transaction: the losing
   * user's entitlement → `revoked` (skipped silently when no local row
   * exists), the gaining user's row upserted `active` with the event's
   * store/product. A gaining app_user_id unknown locally records the
   * BillingEvent with `user_id: null` and writes no entitlement — the
   * reconciliation sweep picks the user up if they appear later.
   */
  private async applyTransfer(event: RevenueCatEvent): Promise<BillingWebhookResponse> {
    const losingUserId = await this.firstLocalUserId(event.transferred_from ?? [])
    const gainingUserId = await this.firstLocalUserId(event.transferred_to ?? [])
    const occurredAt = new Date(event.event_timestamp_ms)
    const store = mapRevenueCatStore(event.store)

    let lossTransition: EntitlementTransition | null = null
    let gainTransition: EntitlementTransition | null = null

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.billingEvent.create({
          data: {
            provider: 'revenuecat',
            external_event_id: event.id,
            event_type: event.type,
            user_id: gainingUserId,
            store,
            product_id: event.product_id ?? null,
            payload: projectRevenueCatEventPayload(
              event
            ) as unknown as Prisma.InputJsonValue,
            occurred_at: occurredAt,
          },
        })

        const losingRow =
          losingUserId === null
            ? null
            : await tx.premiumEntitlement.findUnique({
                where: { user_id: losingUserId },
              })

        if (losingUserId !== null && losingRow !== null) {
          lossTransition = await this.entitlements.applyLedgerEvent(tx, {
            userId: losingUserId,
            state: {
              status: 'revoked',
              store: losingRow.store,
              productId: losingRow.product_id,
              willRenew: false,
              currentPeriodEnd: losingRow.current_period_end,
            },
            occurredAt,
            eventId: event.id,
            provider: 'revenuecat',
          })
        }

        if (gainingUserId !== null) {
          const gainState = resolveTransferGainState(event, losingRow)
          if (gainState !== null) {
            gainTransition = await this.entitlements.applyLedgerEvent(tx, {
              userId: gainingUserId,
              state: gainState,
              occurredAt,
              eventId: event.id,
              provider: 'revenuecat',
            })
          } else {
            this.logger.warn(
              { eventId: event.id },
              'TRANSFER gain skipped: no store/product/period derivable from the event or the losing row'
            )
          }
        }
      })
    } catch (error: unknown) {
      if (isUniqueConstraintViolation(error)) {
        return RECEIVED
      }
      throw error
    }

    if (losingUserId !== null && lossTransition !== null) {
      // TRANSFER-loss carries reason 'transferred', not 'revoked' (AC 6).
      await this.subscriptions.emitTransition(losingUserId, lossTransition, 'transferred')
    }
    if (gainingUserId !== null && gainTransition !== null) {
      await this.subscriptions.emitTransition(gainingUserId, gainTransition)
    }

    return RECEIVED
  }

  // -------------------------------------------------------------------------
  // Shared plumbing
  // -------------------------------------------------------------------------

  private parseRevenueCatEvent(rawBody: Buffer): RevenueCatEvent {
    let decoded: unknown
    try {
      decoded = JSON.parse(rawBody.toString('utf8'))
    } catch {
      throw new BadRequestException(
        `${RC_PAYLOAD_INVALID_PREFIX}: request: not valid JSON`
      )
    }
    const parsed = revenueCatEventSchema.safeParse(decoded)
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
        .join('; ')
      throw new BadRequestException(`${RC_PAYLOAD_INVALID_PREFIX}: ${details}`)
    }
    return parsed.data.event
  }

  private async findExistingEvent(
    provider: 'stripe' | 'revenuecat',
    externalEventId: string
  ): Promise<boolean> {
    const existing = await this.prisma.billingEvent.findUnique({
      where: {
        provider_external_event_id: {
          provider,
          external_event_id: externalEventId,
        },
      },
      select: { id: true },
    })
    return existing !== null
  }

  /** `app_user_id` = our User.id (Decision 1); unknown or anonymous ids → null. */
  private async resolveLocalUserId(appUserId: string | null): Promise<string | null> {
    if (appUserId === null) {
      return null
    }
    const user = await this.prisma.user.findUnique({
      where: { id: appUserId },
      select: { id: true },
    })
    return user?.id ?? null
  }

  private async firstLocalUserId(appUserIds: readonly string[]): Promise<string | null> {
    for (const appUserId of appUserIds) {
      const resolved = await this.resolveLocalUserId(appUserId)
      if (resolved !== null) {
        return resolved
      }
    }
    return null
  }

  private reject(
    rail: 'stripe' | 'revenuecat',
    reason: RejectionReason
  ): UnauthorizedException {
    // Never log the signature, the credential, the resolved secret, or the
    // body. The rail and the reason are enough to diagnose; neither is secret.
    this.logger.warn({ rail, reason }, 'Rejected billing webhook')
    return new UnauthorizedException(BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE)
  }
}
