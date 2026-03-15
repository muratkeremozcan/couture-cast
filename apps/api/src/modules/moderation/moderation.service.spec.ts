import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsClient } from '../../analytics/analytics.service'
import { ModerationService } from './moderation.service'

const createService = () => {
  const capture = vi.fn()
  const analyticsClient = {
    capture,
  } as unknown as AnalyticsClient

  return { service: new ModerationService(analyticsClient), capture }
}

describe('ModerationService', () => {
  it('tracks moderation_action with normalized properties', () => {
    const { service, capture } = createService()

    const result = service.recordAction({
      moderatorId: 'mod-1',
      targetId: 'post-99',
      action: 'hide',
      reason: 'policy_violation',
      contentType: 'post',
      timestamp: '2026-03-04T10:00:00.000Z',
    })

    expect(capture).toHaveBeenCalledWith({
      distinctId: 'mod-1',
      event: 'moderation_action',
      properties: {
        moderator_id: 'mod-1',
        target_id: 'post-99',
        action: 'hide',
        reason: 'policy_violation',
        content_type: 'post',
        timestamp: '2026-03-04T10:00:00.000Z',
      },
    })
    expect(result).toEqual({ tracked: true })
  })
})
