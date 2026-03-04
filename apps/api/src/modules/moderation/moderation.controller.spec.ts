import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { ModerationService } from './moderation.service'
import { ModerationController } from './moderation.controller'
import type { RequestAuthContext } from '../auth/security.types'

const createController = () => {
  const recordAction = vi.fn().mockReturnValue({ tracked: true })
  const service = {
    recordAction,
  } as unknown as ModerationService

  return { controller: new ModerationController(service), recordAction }
}

describe('ModerationController', () => {
  const moderatorAuthContext: RequestAuthContext = {
    token: 'token-123',
    userId: 'mod-1',
    role: 'moderator',
  }

  it('records moderation action for valid payloads', () => {
    const { controller, recordAction } = createController()
    const payload = {
      moderatorId: 'mod-1',
      targetId: 'post-99',
      action: 'hide',
      reason: 'policy_violation',
      contentType: 'post',
      timestamp: '2026-03-04T10:00:00.000Z',
    }

    const result = controller.recordAction(moderatorAuthContext, payload)

    expect(recordAction).toHaveBeenCalledWith(payload)
    expect(result).toEqual({ tracked: true })
  })

  it('rejects invalid payloads', () => {
    const { controller, recordAction } = createController()

    expect(() =>
      controller.recordAction(moderatorAuthContext, {
        moderatorId: '',
        targetId: 'post-99',
        action: 'hide',
        reason: 'policy_violation',
      })
    ).toThrow(BadRequestException)
    expect(recordAction).not.toHaveBeenCalled()
  })

  it('rejects payloads when moderator identity does not match', () => {
    const { controller, recordAction } = createController()

    expect(() =>
      controller.recordAction(moderatorAuthContext, {
        moderatorId: 'mod-2',
        targetId: 'post-99',
        action: 'hide',
        reason: 'policy_violation',
      })
    ).toThrow(ForbiddenException)
    expect(recordAction).not.toHaveBeenCalled()
  })

  it('allows admin to record moderation action on behalf of moderator', () => {
    const { controller, recordAction } = createController()
    const payload = {
      moderatorId: 'mod-2',
      targetId: 'post-99',
      action: 'hide',
      reason: 'policy_violation',
      contentType: 'post',
      timestamp: '2026-03-04T10:00:00.000Z',
    }

    const result = controller.recordAction(
      {
        token: 'admin-token',
        userId: 'admin-1',
        role: 'admin',
      },
      payload
    )

    expect(recordAction).toHaveBeenCalledWith(payload)
    expect(result).toEqual({ tracked: true })
  })
})
