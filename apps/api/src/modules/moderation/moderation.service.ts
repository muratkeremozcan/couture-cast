import { Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'
import { PostHogService } from '../../posthog/posthog.service'

const moderationActionInputSchema = z.object({
  moderatorId: z.string().min(1),
  targetId: z.string().min(1),
  action: z.string().min(1),
  reason: z.string().min(1),
  contentType: z.string().min(1).optional(),
  timestamp: z.string().datetime().optional(),
})

export type ModerationActionInput = z.infer<typeof moderationActionInputSchema>

@Injectable()
export class ModerationService {
  constructor(@Inject(PostHogService) private readonly posthogService: PostHogService) {}

  recordAction(input: ModerationActionInput) {
    const parsed = moderationActionInputSchema.parse(input)
    const timestamp = parsed.timestamp ?? new Date().toISOString()

    this.posthogService.capture({
      distinctId: parsed.moderatorId,
      event: 'moderation_action',
      properties: {
        moderator_id: parsed.moderatorId,
        target_id: parsed.targetId,
        action: parsed.action,
        reason: parsed.reason,
        content_type: parsed.contentType,
        timestamp,
      },
    })

    return { tracked: true }
  }
}

export { moderationActionInputSchema }
