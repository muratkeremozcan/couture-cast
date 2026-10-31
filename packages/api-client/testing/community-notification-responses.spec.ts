// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import { describe, expect, it, vi } from 'vitest'
import { CommunityNotificationResponses } from '../src/community-notification-responses'

const payload = {
  version: 1,
  source: 'notification',
  type: 'community',
  notificationId: '65000000-0000-4000-8000-000000000001',
  cardId: 'synthetic-post',
  commentId: 'off-page-reply',
  parentId: 'off-page-parent',
  expiresAt: '2026-10-20T00:00:00Z',
}
describe('Story 6.5 OS response routing coordinator', () => {
  it('bounds consumed dedupe history while keeping recent notification actions unique', () => {
    const open = vi.fn()
    const state = new CommunityNotificationResponses({
      ready: () => true,
      open,
      consumed: vi.fn(),
    })
    const first = { ...payload, notificationId: '65000000-0000-4000-8000-000000000000' }
    for (let i = 0; i < 257; i++)
      state.receive(
        {
          ...payload,
          notificationId: `65000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        },
        'default'
      )
    expect(open).toHaveBeenCalledTimes(257)
    state.receive(
      { ...payload, notificationId: '65000000-0000-4000-8000-000000000256' },
      'default'
    )
    expect(open).toHaveBeenCalledTimes(257)
    state.receive(first, 'default')
    expect(open).toHaveBeenCalledTimes(258)
    state.stop()
  })
  it('6.5-UNIT-007: buffers cold responses behind auth/router and deduplicates warm/startup replay', () => {
    let ready = false
    const open = vi.fn()
    const consumed = vi.fn()
    const state = new CommunityNotificationResponses({
      ready: () => ready,
      open,
      consumed,
    })
    state.receive(payload, 'default')
    state.receive(payload, 'default')
    expect(open).not.toHaveBeenCalled()
    ready = true
    state.drain()
    expect(open).toHaveBeenCalledExactlyOnceWith(payload)
    expect(consumed).toHaveBeenCalledTimes(1)
    state.receive(payload, 'default')
    expect(open).toHaveBeenCalledTimes(1)
    state.receive(payload, 'custom-open')
    expect(open).toHaveBeenCalledTimes(2)
  })
  it('6.5-UNIT-007: preserves expiry for localized destination fallback and rejects private/invalid data', () => {
    const open = vi.fn()
    const state = new CommunityNotificationResponses({
      ready: () => true,
      open,
      consumed: vi.fn(),
    })
    state.receive({ ...payload, userId: 'private-identity' }, 'default')
    state.receive({ ...payload, commentId: undefined }, 'default')
    state.receive({ ...payload, notificationId: 'malformed' }, 'default')
    expect(open).not.toHaveBeenCalled()
    state.receive(payload, 'default')
    expect(open).toHaveBeenCalledExactlyOnceWith(payload)
    state.stop()
    state.receive(
      { ...payload, notificationId: '65000000-0000-4000-8000-000000000002' },
      'default'
    )
    state.drain()
    expect(open).toHaveBeenCalledTimes(1)
  })
  it('6.5-UNIT-007: limits pending responses before a fresh authenticated view exists', () => {
    let ready = false
    const open = vi.fn()
    const state = new CommunityNotificationResponses({
      ready: () => ready,
      open,
      consumed: vi.fn(),
    })
    for (let i = 0; i < 40; i++)
      state.receive(
        {
          ...payload,
          notificationId: `65000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        },
        'default'
      )
    ready = true
    state.drain()
    expect(open).toHaveBeenCalledTimes(32)
    expect(open.mock.calls[0]?.[0]).toMatchObject({
      notificationId: '65000000-0000-4000-8000-000000000008',
    })
  })
})
