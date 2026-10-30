import { describe, expect, it, vi } from 'vitest'
import { trackMobileShareCardShared } from './track-events'

describe('trackMobileShareCardShared', () => {
  it('C-COMP-SHARE-ONE-EVENT: captures one share_card_shared event with the four business keys', () => {
    const capture = vi.fn()
    trackMobileShareCardShared(
      { capture },
      {
        client: 'android',
        target: 'pinterest',
        outcome: 'target_chosen',
        duration_ms: 1234.6,
      }
    )
    expect(capture).toHaveBeenCalledExactlyOnceWith('share_card_shared', {
      client: 'android',
      target: 'pinterest',
      outcome: 'target_chosen',
      duration_ms: 1235,
    })
  })
  it('clamps the duration into the schema range', () => {
    const capture = vi.fn()
    trackMobileShareCardShared(
      { capture },
      { client: 'ios', target: 'none', outcome: 'failed', duration_ms: 90_000_000 }
    )
    trackMobileShareCardShared(
      { capture },
      { client: 'ios', target: 'none', outcome: 'failed', duration_ms: -5 }
    )
    expect(
      (capture.mock.calls as [string, { duration_ms: number }][]).map(
        ([, properties]) => properties.duration_ms
      )
    ).toEqual([86_400_000, 0])
  })
  it('C-COMP-SHARE-ANALYTICS-DOWN: an invalid pair, a throw and a rejection are all swallowed', async () => {
    const capture = vi.fn()
    expect(() =>
      trackMobileShareCardShared(
        { capture },
        { client: 'android', target: 'instagram', outcome: 'completed', duration_ms: 1 }
      )
    ).not.toThrow()
    expect(capture).not.toHaveBeenCalled()
    const valid = {
      client: 'ios',
      target: 'none',
      outcome: 'cancelled',
      duration_ms: 1,
    } as const
    expect(() =>
      trackMobileShareCardShared(
        {
          capture: () => {
            throw new Error('down')
          },
        },
        valid
      )
    ).not.toThrow()
    const unhandled = vi.fn()
    window.addEventListener('unhandledrejection', unhandled)
    try {
      const rejecting = vi.fn(() => Promise.reject(new Error('down')))
      // Typed as void, but a provider may still hand back a rejecting promise.
      trackMobileShareCardShared({ capture: rejecting as () => void }, valid)
      expect(rejecting).toHaveBeenCalledOnce()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('unhandledrejection', unhandled)
    }
  })
})
