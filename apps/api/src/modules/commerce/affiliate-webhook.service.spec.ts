// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import { Prisma, type PrismaClient } from '@prisma/client'
import { WEBHOOK_SIGNATURE_INVALID_MESSAGE } from '../../contracts/http.js'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import {
  signAffiliateWebhookPayload,
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
} from './affiliate-webhook-signature.js'
import {
  AffiliateWebhookService,
  type AffiliateWebhookRequestInput,
} from './affiliate-webhook.service.js'

/**
 * Unit coverage for every branch of the webhook. It matters more than usual that
 * this is exhaustive: no workflow runs `test:integration`, so the sibling
 * integration suite is local-only evidence and unprotected after merge.
 */

const PARTNER_SLUG = 'unit-partner'
const SECRET_REF = 'COMMERCE_PARTNER_UNIT_PARTNER_WEBHOOK_SECRET'
const SECRET = 'a-unit-test-partner-secret-of-at-least-32-characters'
const NOW_SECONDS = 1_760_000_000
const NOW_MS = NOW_SECONDS * 1000

const VALID_PAYLOAD = {
  eventId: 'evt-unit-1',
  clickToken: 'click-token-unit-1',
  occurredAt: '2026-08-11T10:00:00.000Z',
  status: 'confirmed',
  orderValueMinorUnits: 12_900,
  currency: 'USD',
}

function knownRequestError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('constraint failed', {
    code,
    clientVersion: 'test',
  })
}

describe('AffiliateWebhookService', () => {
  let service: AffiliateWebhookService
  let partnerFindUnique: ReturnType<typeof vi.fn>
  let conversionFindUnique: ReturnType<typeof vi.fn>
  let conversionCreate: ReturnType<typeof vi.fn>
  let clickFindUnique: ReturnType<typeof vi.fn>
  let captureEvent: ReturnType<typeof vi.fn>

  const activePartner = {
    id: 'partner-row-1',
    slug: PARTNER_SLUG,
    status: 'active' as const,
    webhook_secret_ref: SECRET_REF,
  }

  /** Builds a correctly signed request, then applies whatever the test wants broken. */
  function buildRequest(
    overrides: Partial<AffiliateWebhookRequestInput> = {},
    body: unknown = VALID_PAYLOAD
  ): AffiliateWebhookRequestInput {
    const rawBody = Buffer.from(JSON.stringify(body), 'utf8')
    const timestamp = String(NOW_SECONDS)

    return {
      partnerId: PARTNER_SLUG,
      timestamp,
      signature: signAffiliateWebhookPayload(timestamp, rawBody, SECRET),
      rawBody,
      ...overrides,
    }
  }

  async function expectUnauthorized(input: AffiliateWebhookRequestInput): Promise<void> {
    const rejection = await service
      .recordConversion(input)
      .catch((error: unknown) => error)

    expect(rejection).toBeInstanceOf(UnauthorizedException)
    expect((rejection as UnauthorizedException).message).toBe(
      WEBHOOK_SIGNATURE_INVALID_MESSAGE
    )
    // AC 2: a rejected webhook creates no commerce rows and emits nothing.
    expect(conversionCreate).not.toHaveBeenCalled()
    expect(captureEvent).not.toHaveBeenCalled()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_MS))
    vi.stubEnv(SECRET_REF, SECRET)

    partnerFindUnique = vi.fn().mockResolvedValue(activePartner)
    conversionFindUnique = vi.fn().mockResolvedValue(null)
    conversionCreate = vi.fn().mockResolvedValue({ id: 'conversion-1' })
    clickFindUnique = vi.fn().mockResolvedValue(null)
    captureEvent = vi.fn().mockResolvedValue(undefined)

    const prisma = {
      commercePartner: { findUnique: partnerFindUnique },
      affiliateConversion: {
        findUnique: conversionFindUnique,
        create: conversionCreate,
      },
      affiliateClick: { findUnique: clickFindUnique },
    } as unknown as PrismaClient

    service = new AffiliateWebhookService(prisma, {
      captureEvent,
    } as unknown as TelemetryService)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  describe('step 1: headers', () => {
    it.each([
      { name: 'a missing partner id', overrides: { partnerId: undefined } },
      { name: 'an empty partner id', overrides: { partnerId: '' } },
      { name: 'a missing timestamp', overrides: { timestamp: undefined } },
      { name: 'a missing signature', overrides: { signature: undefined } },
      { name: 'a non-numeric timestamp', overrides: { timestamp: 'not-a-number' } },
      { name: 'a fractional timestamp', overrides: { timestamp: '1760000000.5' } },
      { name: 'a negative timestamp', overrides: { timestamp: '-1760000000' } },
      {
        name: 'an uppercase hex signature',
        overrides: { signature: 'A'.repeat(64) },
      },
      { name: 'a short signature', overrides: { signature: 'abc123' } },
      {
        name: 'a non-hex signature of the right length',
        overrides: { signature: 'z'.repeat(64) },
      },
    ])('rejects $name without touching the catalog', async ({ overrides }) => {
      await expectUnauthorized(buildRequest(overrides))

      // Header validation short-circuits before any database read, which is what
      // keeps an unauthenticated flood from becoming query load.
      expect(partnerFindUnique).not.toHaveBeenCalled()
    })
  })

  describe('raw body', () => {
    it('rejects a request whose bootstrap captured no raw body', async () => {
      // The failure mode most likely to sink this story: `rawBody: true` missing
      // from `api/index.ts` means no signature can ever verify in production.
      await expectUnauthorized(buildRequest({ rawBody: undefined }))

      expect(partnerFindUnique).not.toHaveBeenCalled()
    })
  })

  describe('step 2: partner and secret', () => {
    it('rejects an unknown partner slug', async () => {
      partnerFindUnique.mockResolvedValue(null)

      await expectUnauthorized(buildRequest())
    })

    it('rejects an inactive partner', async () => {
      partnerFindUnique.mockResolvedValue({ ...activePartner, status: 'inactive' })

      await expectUnauthorized(buildRequest())
    })

    it('rejects a partner whose secret variable is unset outside test environments', async () => {
      vi.stubEnv(SECRET_REF, undefined)
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('TEST_ENV', '')

      await expectUnauthorized(buildRequest())
    })

    it('rejects a partner whose configured secret is under 32 characters', async () => {
      vi.stubEnv(SECRET_REF, 'short')

      await expectUnauthorized(buildRequest())
    })

    it('rejects a partner whose secret ref fails the runtime pattern guard', async () => {
      // The database check constraint blocks this shape too. The runtime guard is
      // the second lock: `process.env[<database value>]` must never be able to
      // address an arbitrary variable, whatever a migration lets through later.
      partnerFindUnique.mockResolvedValue({
        ...activePartner,
        webhook_secret_ref: 'DATABASE_URL',
      })

      await expectUnauthorized(buildRequest())
    })
  })

  describe('step 3: timestamp window', () => {
    it.each([
      {
        name: 'exactly the tolerance in the past',
        offset: -WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
      },
      {
        name: 'exactly the tolerance in the future',
        offset: WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
      },
    ])('accepts a timestamp $name', async ({ offset }) => {
      const timestamp = String(NOW_SECONDS + offset)
      const rawBody = Buffer.from(JSON.stringify(VALID_PAYLOAD), 'utf8')

      const result = await service.recordConversion({
        partnerId: PARTNER_SLUG,
        timestamp,
        signature: signAffiliateWebhookPayload(timestamp, rawBody, SECRET),
        rawBody,
      })

      expect(result).toEqual({ data: { received: true } })
    })

    it.each([
      {
        name: 'one second too old',
        offset: -(WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS + 1),
      },
      {
        name: 'one second too far ahead',
        offset: WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS + 1,
      },
    ])('rejects a timestamp $name', async ({ offset }) => {
      const timestamp = String(NOW_SECONDS + offset)
      const rawBody = Buffer.from(JSON.stringify(VALID_PAYLOAD), 'utf8')

      await expectUnauthorized({
        partnerId: PARTNER_SLUG,
        timestamp,
        signature: signAffiliateWebhookPayload(timestamp, rawBody, SECRET),
        rawBody,
      })
    })
  })

  describe('step 4: signature', () => {
    it('rejects a signature computed over different bytes', async () => {
      const rawBody = Buffer.from(JSON.stringify(VALID_PAYLOAD), 'utf8')
      const timestamp = String(NOW_SECONDS)

      await expectUnauthorized({
        partnerId: PARTNER_SLUG,
        timestamp,
        signature: signAffiliateWebhookPayload(
          timestamp,
          Buffer.from('{"eventId":"someone-elses-event"}', 'utf8'),
          SECRET
        ),
        rawBody,
      })
    })

    it('rejects a signature made with another partner secret', async () => {
      const rawBody = Buffer.from(JSON.stringify(VALID_PAYLOAD), 'utf8')
      const timestamp = String(NOW_SECONDS)

      await expectUnauthorized({
        partnerId: PARTNER_SLUG,
        timestamp,
        signature: signAffiliateWebhookPayload(
          timestamp,
          rawBody,
          'a-completely-different-secret-of-at-least-32-chars'
        ),
        rawBody,
      })
    })

    it('accepts bytes whose key order differs from a re-serialized form', async () => {
      // A body that verifies must still verify when the partner's serializer
      // orders keys or pads whitespace differently from ours. Signing anything
      // other than the arriving bytes breaks exactly this case.
      const rawBody = Buffer.from(
        '{\n  "currency": "USD",\n  "status": "confirmed",\n  "orderValueMinorUnits": 12900,\n  "occurredAt": "2026-08-11T10:00:00.000Z",\n  "clickToken": "click-token-unit-1",\n  "eventId": "evt-unit-1"\n}',
        'utf8'
      )
      const timestamp = String(NOW_SECONDS)

      const result = await service.recordConversion({
        partnerId: PARTNER_SLUG,
        timestamp,
        signature: signAffiliateWebhookPayload(timestamp, rawBody, SECRET),
        rawBody,
      })

      expect(result).toEqual({ data: { received: true } })
      expect(conversionCreate).toHaveBeenCalledTimes(1)
    })
  })

  describe('step 5: payload schema', () => {
    it('returns 400 for a signed body that is not valid JSON', async () => {
      const rawBody = Buffer.from('{"eventId": ', 'utf8')
      const timestamp = String(NOW_SECONDS)

      await expect(
        service.recordConversion({
          partnerId: PARTNER_SLUG,
          timestamp,
          signature: signAffiliateWebhookPayload(timestamp, rawBody, SECRET),
          rawBody,
        })
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(conversionCreate).not.toHaveBeenCalled()
    })

    it.each([
      { name: 'an unknown status', body: { ...VALID_PAYLOAD, status: 'refunded' } },
      {
        name: 'a floating-point order value',
        body: { ...VALID_PAYLOAD, orderValueMinorUnits: 129.5 },
      },
      {
        name: 'a negative order value',
        body: { ...VALID_PAYLOAD, orderValueMinorUnits: -1 },
      },
      { name: 'a lowercase currency', body: { ...VALID_PAYLOAD, currency: 'usd' } },
      {
        name: 'a non-ISO occurredAt',
        body: { ...VALID_PAYLOAD, occurredAt: 'yesterday' },
      },
      { name: 'a missing event id', body: { ...VALID_PAYLOAD, eventId: undefined } },
      { name: 'an unexpected extra field', body: { ...VALID_PAYLOAD, refundTo: 'x' } },
    ])('returns 400 for $name after the signature verifies', async ({ body }) => {
      await expect(
        service.recordConversion(buildRequest({}, body))
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(conversionCreate).not.toHaveBeenCalled()
      expect(captureEvent).not.toHaveBeenCalled()
    })
  })

  describe('persistence and emission', () => {
    it('persists a matched conversion and emits with the click owner as subject', async () => {
      clickFindUnique.mockResolvedValue({ id: 'click-1', user_id: 'user-1' })

      const result = await service.recordConversion(buildRequest())

      expect(result).toEqual({ data: { received: true } })
      expect(conversionCreate).toHaveBeenCalledWith({
        data: {
          partner_id: 'partner-row-1',
          external_event_id: 'evt-unit-1',
          affiliate_click_id: 'click-1',
          status: 'confirmed',
          order_value_minor_units: 12_900,
          currency: 'USD',
          occurred_at: new Date('2026-08-11T10:00:00.000Z'),
        },
      })
      expect(captureEvent).toHaveBeenCalledWith(
        'user-1',
        'affiliate_conversion_recorded',
        {
          partnerId: PARTNER_SLUG,
          status: 'confirmed',
          currency: 'USD',
          orderValueMinorUnits: 12_900,
          matched: true,
        }
      )
    })

    it('persists an unknown click token unattributed and emits matched false', async () => {
      // Rejecting would trigger unbounded partner retries for a fact we cannot
      // change, so the conversion is recorded without an owner.
      clickFindUnique.mockResolvedValue(null)

      const result = await service.recordConversion(buildRequest())

      expect(result).toEqual({ data: { received: true } })
      const created = conversionCreate.mock.calls[0]?.[0] as {
        data: { affiliate_click_id: string | null }
      }
      expect(created.data.affiliate_click_id).toBeNull()
      expect(captureEvent).toHaveBeenCalledWith(null, 'affiliate_conversion_recorded', {
        partnerId: PARTNER_SLUG,
        status: 'confirmed',
        currency: 'USD',
        orderValueMinorUnits: 12_900,
        matched: false,
      })
    })

    it('treats a replayed event id as a no-op that still answers 200', async () => {
      conversionFindUnique.mockResolvedValue({ id: 'existing-conversion' })

      const result = await service.recordConversion(buildRequest())

      expect(result).toEqual({ data: { received: true } })
      expect(conversionCreate).not.toHaveBeenCalled()
      expect(captureEvent).not.toHaveBeenCalled()
      // A replay must not even resolve the click: nothing downstream uses it.
      expect(clickFindUnique).not.toHaveBeenCalled()
    })

    it('treats a lost unique-index race as a replay', async () => {
      // Two concurrent deliveries of one event id both pass the existence read.
      conversionCreate.mockRejectedValue(knownRequestError('P2002'))

      const result = await service.recordConversion(buildRequest())

      expect(result).toEqual({ data: { received: true } })
      expect(captureEvent).not.toHaveBeenCalled()
    })

    it('propagates a persistence failure that is not a uniqueness conflict', async () => {
      conversionCreate.mockRejectedValue(knownRequestError('P1001'))

      await expect(service.recordConversion(buildRequest())).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError
      )
      expect(captureEvent).not.toHaveBeenCalled()
    })

    it('still answers 200 when the analytics sink fails', async () => {
      // Fail open. The conversion row is already committed and a degraded sink
      // must never turn a recorded purchase into a 500 the partner retries.
      captureEvent.mockRejectedValue(new Error('PostHog unreachable'))

      const result = await service.recordConversion(buildRequest())

      expect(result).toEqual({ data: { received: true } })
      expect(conversionCreate).toHaveBeenCalledTimes(1)
    })

    it('looks the partner up by slug and reads only non-secret columns', async () => {
      await service.recordConversion(buildRequest())

      expect(partnerFindUnique).toHaveBeenCalledWith({
        where: { slug: PARTNER_SLUG },
        select: { id: true, slug: true, status: true, webhook_secret_ref: true },
      })
    })
  })
})
