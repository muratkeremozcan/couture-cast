// Step 8 API analytics owner: searchable owner anchor
import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import {
  InjectAnalyticsClient,
  type AnalyticsClient,
} from '../../analytics/analytics.service'

const guardianConsentInputSchema = z.object({
  guardianId: z.string().min(1),
  teenId: z.string().min(1),
  consentLevel: z.string().min(1),
  timestamp: z.string().datetime().optional(),
})

export type GuardianConsentInput = z.infer<typeof guardianConsentInputSchema>

@Injectable()
export class AuthService {
  constructor(
    @InjectAnalyticsClient() private readonly analyticsClient: AnalyticsClient
  ) {}

  /** Story 0.7 support file: API-side analytics boundary for guardian consent.
   * Why typed validation exists here: API callers are external to UI wrappers, so we enforce schema before capture.
   * Problems solved: request payload drift, inconsistent property keys, and weaker incident visibility from bad events.
   * Alternatives: reuse shared contract builders server-side, or enqueue events for async contract validation.
   * Flow refs:
   * - S0.7/T3/1: API endpoints are also part of the shared analytics surface, not a separate event contract.
   * - S0.7/T2/2: API capture still emits canonical snake_case properties.
   */
  grantGuardianConsent(input: GuardianConsentInput) {
    // Flow ref S0.7/T3/1: validate the API payload at the boundary before
    // emitting the shared analytics event.
    const parsed = guardianConsentInputSchema.parse(input)
    // Flow ref S0.7/T2/2: normalize timestamp so every emitted payload keeps
    // the shared temporal field contract.
    const timestamp = parsed.timestamp ?? new Date().toISOString()

    // Flow ref S0.7/T3/1: capture one canonical guardian_consent_granted event
    // payload instead of shaping a route-specific variant.
    this.analyticsClient.capture({
      distinctId: parsed.guardianId,
      event: 'guardian_consent_granted',
      properties: {
        guardian_id: parsed.guardianId,
        teen_id: parsed.teenId,
        consent_level: parsed.consentLevel,
        timestamp,
        consent_timestamp: timestamp,
      },
    })

    return { tracked: true }
  }
}

export { guardianConsentInputSchema }
