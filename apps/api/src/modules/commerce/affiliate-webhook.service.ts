import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import { z } from 'zod'
import {
  affiliateWebhookHeadersSchema,
  affiliateWebhookPayloadSchema,
  WEBHOOK_SIGNATURE_INVALID_MESSAGE,
  type AffiliateWebhookPayload,
  type AffiliateWebhookResponse,
} from '../../contracts/http.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import { TelemetryService } from '../telemetry/telemetry.service.js'
import {
  isWebhookTimestampFresh,
  resolvePartnerWebhookSecret,
  verifyAffiliateWebhookSignature,
} from './affiliate-webhook-signature.js'

/**
 * Story 5.1 Task 5: records affiliate conversions posted by a partner.
 *
 * THE THREE PROPERTIES THAT SHAPE EVERYTHING BELOW.
 *
 * 1. **Uniform rejection.** Every signature failure returns the same status and
 *    the same message. An unknown partner slug, an inactive partner, an
 *    unresolvable secret, a stale timestamp, and a forged HMAC are
 *    indistinguishable from outside, so the endpoint cannot be used to enumerate
 *    which partners exist or which secrets an environment has configured. The
 *    reason is recorded in a log line instead.
 *
 * 2. **Append-only.** One row per `(partner_id, external_event_id)`, never
 *    updated. That removes ordering entirely: there is no last-write-wins rule,
 *    no `occurred_at` comparison, and no forbidden-transition table, because
 *    nothing mutates. A click's current attribution state is the row with the
 *    greatest `occurred_at`, computed at read time by whoever reports on it.
 *
 * 3. **The kill switch does not apply here.** `commerce_affiliate_enabled` gates
 *    the CTA and the click endpoint, never this one. Returning 503 to a retrying
 *    partner is precisely the retry storm the flag exists to prevent, and it
 *    would discard conversion facts for purchases that already happened.
 */

/** What the controller pulls off the request; all of it untrusted. */
export type AffiliateWebhookRequestInput = {
  readonly partnerId: string | undefined
  readonly timestamp: string | undefined
  readonly signature: string | undefined
  /**
   * The raw request bytes. `undefined` means the bootstrap that served this
   * request was created without `rawBody: true`, which is a server
   * misconfiguration rather than a partner error.
   */
  readonly rawBody: Buffer | undefined
}

type SignedPartner = {
  readonly id: string
  readonly slug: string
  readonly secret: string
}

/** Distinguishes the rejection reasons in logs without ever varying the response. */
type RejectionReason =
  | 'headers_invalid'
  | 'raw_body_missing'
  | 'partner_unavailable'
  | 'secret_unresolvable'
  | 'timestamp_outside_tolerance'
  | 'signature_mismatch'

const WEBHOOK_PAYLOAD_INVALID_PREFIX = 'Invalid affiliate webhook payload'

function validationMessage(prefix: string, error: z.ZodError): string {
  const details = error.issues
    .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
    .join('; ')
  return `${prefix}: ${details}`
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

@Injectable()
export class AffiliateWebhookService {
  private readonly logger = createBaseLogger().child({ feature: 'affiliate-webhook' })

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(TelemetryService) private readonly telemetryService: TelemetryService
  ) {}

  /**
   * Verification runs in a fixed order, and only the last step can produce
   * anything other than a 401: headers, raw body, partner, secret, timestamp,
   * HMAC, and only then the payload schema.
   */
  async recordConversion(
    input: AffiliateWebhookRequestInput
  ): Promise<AffiliateWebhookResponse> {
    const headers = affiliateWebhookHeadersSchema.safeParse({
      'x-couture-partner-id': input.partnerId,
      'x-couture-timestamp': input.timestamp,
      'x-couture-signature': input.signature,
    })
    if (!headers.success) {
      // Covers a missing header, a non-integer or negative timestamp, and a
      // signature that is not 64 lowercase hex characters.
      throw this.reject('headers_invalid')
    }

    const rawBody = input.rawBody
    if (rawBody === undefined) {
      // Logged at error, not warn: this is ours, not the partner's. Without
      // `rawBody: true` on the bootstrap serving the request no signature can
      // ever verify, and the symptom (every signed webhook 401ing in exactly one
      // environment) is otherwise indistinguishable from a key rotation.
      this.logger.error(
        {},
        'Affiliate webhook received with no raw body. The Nest bootstrap serving this request was created without rawBody: true.'
      )
      throw this.reject('raw_body_missing')
    }

    const timestamp = headers.data['x-couture-timestamp']
    const partner = await this.resolveSignedPartner(headers.data['x-couture-partner-id'])

    if (!isWebhookTimestampFresh(Number(timestamp))) {
      throw this.reject('timestamp_outside_tolerance', partner.slug)
    }

    if (
      !verifyAffiliateWebhookSignature(
        headers.data['x-couture-signature'],
        timestamp,
        rawBody,
        partner.secret
      )
    ) {
      throw this.reject('signature_mismatch', partner.slug)
    }

    return this.persistConversion(partner, this.parsePayload(rawBody))
  }

  private async resolveSignedPartner(slug: string): Promise<SignedPartner> {
    const partner = await this.prisma.commercePartner.findUnique({
      where: { slug },
      select: { id: true, slug: true, status: true, webhook_secret_ref: true },
    })

    if (!partner || partner.status !== 'active') {
      throw this.reject('partner_unavailable')
    }

    const secret = resolvePartnerWebhookSecret(partner.webhook_secret_ref)
    if (secret === null) {
      // Either the row names a variable that is unset, or the configured value
      // is under the length floor, or the name itself failed the runtime pattern
      // guard. All three are operator errors and none of them may be
      // distinguishable to the caller.
      throw this.reject('secret_unresolvable', partner.slug)
    }

    return { id: partner.id, slug: partner.slug, secret }
  }

  /**
   * Parses the raw bytes rather than the framework-parsed body, so the 400 in
   * step five is produced here and nowhere earlier: nothing about the payload is
   * inspected until all four signature checks have passed.
   */
  private parsePayload(rawBody: Buffer): AffiliateWebhookPayload {
    let decoded: unknown
    try {
      decoded = JSON.parse(rawBody.toString('utf8'))
    } catch {
      throw new BadRequestException(
        `${WEBHOOK_PAYLOAD_INVALID_PREFIX}: request: not valid JSON`
      )
    }

    const parsed = affiliateWebhookPayloadSchema.safeParse(decoded)
    if (!parsed.success) {
      throw new BadRequestException(
        validationMessage(WEBHOOK_PAYLOAD_INVALID_PREFIX, parsed.error)
      )
    }

    return parsed.data
  }

  private async persistConversion(
    partner: SignedPartner,
    payload: AffiliateWebhookPayload
  ): Promise<AffiliateWebhookResponse> {
    const existing = await this.prisma.affiliateConversion.findUnique({
      where: {
        partner_id_external_event_id: {
          partner_id: partner.id,
          external_event_id: payload.eventId,
        },
      },
      select: { id: true },
    })
    if (existing) {
      // A replay writes nothing and emits nothing. Rows never mutate, so there is
      // no state to reconcile, and a second analytics event would double-count a
      // single purchase.
      return { data: { received: true } }
    }

    // An unknown token still records, with `affiliate_click_id` null. Rejecting
    // would trigger unbounded partner retries for a fact we cannot change.
    const click = await this.prisma.affiliateClick.findUnique({
      where: { token: payload.clickToken },
      select: { id: true, user_id: true },
    })

    try {
      await this.prisma.affiliateConversion.create({
        data: {
          partner_id: partner.id,
          external_event_id: payload.eventId,
          affiliate_click_id: click?.id ?? null,
          status: payload.status,
          order_value_minor_units: payload.orderValueMinorUnits,
          currency: payload.currency,
          occurred_at: new Date(payload.occurredAt),
        },
      })
    } catch (error: unknown) {
      if (isUniqueConstraintViolation(error)) {
        // Two deliveries of the same event id raced past the read above. The
        // unique index picked a winner; this delivery is a replay by another
        // name, so it must stay silent for the same reason a replay does.
        this.logger.info(
          { partnerSlug: partner.slug },
          'Concurrent affiliate conversion delivery lost the unique-index race; treating as a replay'
        )
        return { data: { received: true } }
      }
      throw error
    }

    await this.emitConversionRecorded(partner.slug, click?.user_id ?? null, payload)

    return { data: { received: true } }
  }

  private async emitConversionRecorded(
    partnerSlug: string,
    clickUserId: string | null,
    payload: AffiliateWebhookPayload
  ): Promise<void> {
    try {
      await this.telemetryService.captureEvent(
        clickUserId,
        'affiliate_conversion_recorded',
        {
          partnerId: partnerSlug,
          status: payload.status,
          currency: payload.currency,
          orderValueMinorUnits: payload.orderValueMinorUnits,
          // Unmatched conversions have no user subject at all, so the telemetry
          // builder substitutes the partner slug as the distinct id.
          matched: clickUserId !== null,
        }
      )
    } catch (telemetryError: unknown) {
      // Fail open. The conversion row is the commercial record and it is already
      // committed; a degraded analytics sink must never turn a recorded purchase
      // into a 500 that the partner then retries forever.
      this.logger.error(
        { telemetryError, partnerSlug },
        'Failed to emit affiliate_conversion_recorded'
      )
    }
  }

  private reject(reason: RejectionReason, partnerSlug?: string): UnauthorizedException {
    // Never log the signature, the raw body, the resolved secret, or the click
    // token. The reason and the slug are enough to diagnose and neither is secret.
    this.logger.warn(
      { reason, partnerSlug: partnerSlug ?? null },
      'Rejected affiliate webhook'
    )
    return new UnauthorizedException(WEBHOOK_SIGNATURE_INVALID_MESSAGE)
  }
}
