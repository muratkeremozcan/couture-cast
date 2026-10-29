import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { detailOpenerSelector, useDetailOpener } from './detail-opener'

const COMMUNITY = '[data-share-card-focus-fallback="community"]'

describe('detail opener', () => {
  it('names the control and surface that opened a post', () => {
    expect(detailOpenerSelector('community_feed', false, 'p1')).toBe(
      '[data-testid="lookbook-open-p1"]'
    )
    expect(detailOpenerSelector('community_feed', true, 'p1')).toBe(
      '[data-testid="comments-button-p1"]'
    )
    expect(detailOpenerSelector('community_spotlight', false, 'p1')).toBe(
      '[data-testid="spotlight-lookbook-open-p1"]'
    )
  })

  it('restores to the recorded control, then the community section, while its post is open', () => {
    const { result, rerender } = renderHook(
      ({ id }) => useDetailOpener(id === null ? null : { id }),
      {
        initialProps: { id: null as string | null },
      }
    )
    expect(result.current.restoreFocus).toEqual([COMMUNITY])
    act(() => result.current.record('community_feed', false, 'p1'))
    rerender({ id: 'p1' })
    expect(result.current.restoreFocus).toEqual([
      '[data-testid="lookbook-open-p1"]',
      COMMUNITY,
    ])
  })

  // Eviction, sign-out, denial and comment retire all null the opened post without the
  // dialog's own close; a notification or deep link then opens a post with no recorded
  // control of its own.
  it('forgets the control whenever the opened post becomes null, whatever nulled it', () => {
    const { result, rerender } = renderHook(
      ({ id }) => useDetailOpener(id === null ? null : { id }),
      {
        initialProps: { id: null as string | null },
      }
    )
    act(() => result.current.record('community_spotlight', false, 'p1'))
    rerender({ id: 'p1' })
    rerender({ id: null })
    rerender({ id: 'p1' })
    expect(result.current.restoreFocus).toEqual([COMMUNITY])
  })

  it('ignores a control recorded for another post that a deep link replaced it with', () => {
    const { result, rerender } = renderHook(
      ({ id }) => useDetailOpener(id === null ? null : { id }),
      {
        initialProps: { id: null as string | null },
      }
    )
    act(() => result.current.record('community_feed', false, 'p1'))
    rerender({ id: 'p1' })
    rerender({ id: 'p2' })
    // The community section stays as the fallback; the other post's control does not.
    expect(result.current.restoreFocus).toEqual([COMMUNITY])
  })

  it('clears the control on request, as the notification open path does', () => {
    const { result, rerender } = renderHook(
      ({ id }) => useDetailOpener(id === null ? null : { id }),
      {
        initialProps: { id: null as string | null },
      }
    )
    act(() => result.current.record('community_feed', false, 'p1'))
    rerender({ id: 'p1' })
    act(() => result.current.clear())
    expect(result.current.restoreFocus).toEqual([COMMUNITY])
  })
})
