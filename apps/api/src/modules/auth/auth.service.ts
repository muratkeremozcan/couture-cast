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

  grantGuardianConsent(input: GuardianConsentInput) {
    const parsed = guardianConsentInputSchema.parse(input)
    const timestamp = parsed.timestamp ?? new Date().toISOString()

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
