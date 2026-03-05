import { Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'
import { PostHogService } from '../../posthog/posthog.service'

const guardianConsentInputSchema = z.object({
  guardianId: z.string().min(1),
  teenId: z.string().min(1),
  consentLevel: z.string().min(1),
  timestamp: z.string().datetime().optional(),
})

export type GuardianConsentInput = z.infer<typeof guardianConsentInputSchema>

@Injectable()
export class AuthService {
  constructor(@Inject(PostHogService) private readonly posthogService: PostHogService) {}

  /** Story 0.7 Task 2/3: API-side analytics boundary for guardian consent.
   * Why typed validation exists here: API callers are external to UI wrappers, so we enforce schema before capture.
   * Problems solved: request payload drift, inconsistent property keys, and weaker incident visibility from bad events.
   * Alternatives: reuse shared contract builders server-side, or enqueue events for async contract validation.
   * Setup steps (where we did this):
   *   1) validate inbound payload with guardianConsentInputSchema.
   *   2) normalize timestamp so every event has consistent temporal fields.
   *   3) capture one canonical guardian_consent_granted event payload.
   */
  grantGuardianConsent(input: GuardianConsentInput) {
    // 1) validate inbound payload with guardianConsentInputSchema.
    const parsed = guardianConsentInputSchema.parse(input)
    // 2) normalize timestamp so every event has consistent temporal fields.
    const timestamp = parsed.timestamp ?? new Date().toISOString()

    // 3) capture one canonical guardian_consent_granted event payload.
    this.posthogService.capture({
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
