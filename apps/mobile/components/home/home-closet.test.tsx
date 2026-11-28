// Learning path Step 79: Lookbook with shuffle and pinned pieces.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-79-lookbook-with-shuffle-and-pinned-pieces
import { TODAY_WARDROBE_READ_TIMEOUT_MS } from '@couture/utils'
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { listGarmentsFromMobile } from '@/src/lib/wardrobe'
import { useHomeWardrobe } from './home-closet'

vi.mock('expo-router', async () => ({
  useFocusEffect: (await import('../../src/test-utils/focus-effect.js')).useFocusEffect,
}))
vi.mock('@/src/lib/wardrobe', () => ({ listGarmentsFromMobile: vi.fn() }))

const MEMBER = 'today-wardrobe-deadline-member'

afterEach(() => {
  setMobileApplicationUserId(null)
  vi.useRealTimers()
})

it('settles Today when a token does not arrive by the wardrobe deadline', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  setMobileApplicationUserId(MEMBER)
  let finishToken!: (value: string) => void
  const token = new Promise<string>((resolve) => {
    finishToken = resolve
  })
  const resolveToken = vi.fn(() => token)
  const restoreToken = setMobileAccessTokenResolver(resolveToken)
  const { result, unmount } = renderHook(() => useHomeWardrobe(MEMBER, true))
  try {
    expect(resolveToken).toHaveBeenCalledOnce()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODAY_WARDROBE_READ_TIMEOUT_MS - 1)
    })
    expect(result.current).toBeUndefined()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(result.current).toMatchObject({
      pieces: null,
      wardrobe: [],
      smallCloset: false,
    })

    await act(async () => {
      finishToken('late-fixture-bearer')
      await token
    })
    expect(listGarmentsFromMobile).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({
      pieces: null,
      wardrobe: [],
      smallCloset: false,
    })
  } finally {
    unmount()
    restoreToken()
  }
})
