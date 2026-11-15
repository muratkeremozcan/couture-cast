// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 D1: Home and the preview choose guest or member only after the stored
// session is read; a read that keeps failing is unavailable, never signed out.
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setMobileAccessTokenResolver, setMobileApplicationUserId } from './mobile-auth'
import { useMemberSessionState } from './member-session'

let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  vi.useRealTimers()
  setMobileApplicationUserId(null)
})

describe('useMemberSessionState', () => {
  it('starts restoring, then reports member or signed out', async () => {
    let token: string | undefined = 'token'
    restore = setMobileAccessTokenResolver(() => token)
    const { result } = renderHook(() => useMemberSessionState())
    expect(result.current[0]).toBe('restoring')
    await waitFor(() => expect(result.current[0]).toBe('member'))
    token = undefined
    act(() => setMobileApplicationUserId('changed'))
    await waitFor(() => expect(result.current[0]).toBe('signed-out'))
  })

  it('retries a failing read, then reports unavailable, and retries on demand', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let fail = true
    restore = setMobileAccessTokenResolver(() =>
      fail ? Promise.reject(new Error('keychain')) : Promise.resolve('token')
    )
    const { result } = renderHook(() => useMemberSessionState())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000)
    })
    await waitFor(() => expect(result.current[0]).toBe('unavailable'))
    fail = false
    act(() => result.current[1]())
    await waitFor(() => expect(result.current[0]).toBe('member'))
  })
})
