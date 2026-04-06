import { Injectable } from '@nestjs/common'
import {
  InjectAnalyticsClient,
  type AnalyticsClient,
} from '../../analytics/analytics.service'
import {
  moderationActionInputSchema,
  moderationActionResponseSchema,
  type ModerationActionInput,
} from '../../contracts/http'

@Injectable()
export class ModerationService {
  constructor(
    @InjectAnalyticsClient() private readonly analyticsClient: AnalyticsClient
  ) {}

  recordAction(input: ModerationActionInput) {
    const parsed = moderationActionInputSchema.parse(input)
    const timestamp = parsed.timestamp ?? new Date().toISOString()

    this.analyticsClient.capture({
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

    return moderationActionResponseSchema.parse({ tracked: true })
  }
}
