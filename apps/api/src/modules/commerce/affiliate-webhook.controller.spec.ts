// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import { describe, expect, it, vi } from 'vitest'
import type { RawBodyRequest } from '@nestjs/common'
import type { Request } from 'express'
import { AffiliateWebhookController } from './affiliate-webhook.controller.js'
import type { AffiliateWebhookService } from './affiliate-webhook.service.js'

describe('AffiliateWebhookController', () => {
  it('hands the service the raw bytes and the three signing headers verbatim', async () => {
    // The controller is deliberately thin, and the one thing it must not do is
    // normalize or re-serialize anything: the signature covers the exact bytes.
    const recordConversion = vi.fn().mockResolvedValue({ data: { received: true } })
    const controller = new AffiliateWebhookController({
      recordConversion,
    } as unknown as AffiliateWebhookService)
    const rawBody = Buffer.from('{"eventId":"evt-1"}', 'utf8')

    const result = await controller.recordConversion(
      'sample-partner',
      '1760000000',
      'a'.repeat(64),
      { rawBody } as RawBodyRequest<Request>
    )

    expect(result).toEqual({ data: { received: true } })
    expect(recordConversion).toHaveBeenCalledWith({
      partnerId: 'sample-partner',
      timestamp: '1760000000',
      signature: 'a'.repeat(64),
      rawBody,
    })
  })

  it('passes an absent raw body through rather than substituting an empty buffer', async () => {
    // Substituting `Buffer.alloc(0)` here would make a bootstrap missing
    // `rawBody: true` look like an ordinary signature mismatch, hiding the one
    // misconfiguration that breaks every partner in a single environment.
    const recordConversion = vi.fn().mockResolvedValue({ data: { received: true } })
    const controller = new AffiliateWebhookController({
      recordConversion,
    } as unknown as AffiliateWebhookService)

    await controller.recordConversion(
      'sample-partner',
      '1760000000',
      'a'.repeat(64),
      {} as RawBodyRequest<Request>
    )

    expect(recordConversion).toHaveBeenCalledWith(
      expect.objectContaining({ rawBody: undefined })
    )
  })
})
