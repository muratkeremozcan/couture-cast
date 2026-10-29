import React, { useRef, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { AccessibleModal } from './accessible-modal'
import { acquireScrollLock } from './modal-stack'

type Open = { detail: boolean; share: boolean; detailSuspended: boolean }
type Controls = { set: (next: Partial<Open>) => void; closes: string[] }

/**
 * The community surface's shape: a detail dialog stays logically open underneath a
 * share dialog, and a foreground revalidation suspends the detail while the share
 * dialog closes, then resumes both in one commit. The detail renders first, like the
 * grid, so its layout effects run before the share dialog's.
 */
function Surface({ controls }: { controls: { current: Controls | null } }) {
  const [state, setState] = useState<Open>({
    detail: true,
    share: true,
    detailSuspended: false,
  })
  const closes = useRef<string[]>([]).current
  controls.current = {
    set: (next) => setState((prior) => ({ ...prior, ...next })),
    closes,
  }
  return (
    <>
      <main data-app-shell>
        <button type="button">Shell action</button>
      </main>
      {state.detail && (
        <AccessibleModal
          isOpen
          suspended={state.detailSuspended}
          onClose={() => closes.push('detail')}
          titleId="detail-title"
          title="Detail"
        >
          <button type="button">Detail action</button>
        </AccessibleModal>
      )}
      <AccessibleModal
        isOpen={state.share}
        onClose={() => closes.push('share')}
        titleId="share-title"
        title="Share"
      >
        <button type="button">Share action</button>
      </AccessibleModal>
    </>
  )
}

const TITLES: Record<string, string> = {
  Detail: 'detail-title',
  Share: 'share-title',
  First: 'first-title',
  Second: 'second-title',
  Solo: 'solo-title',
}
const dialog = (name: string) =>
  document.querySelector<HTMLElement>(
    `[role="dialog"][aria-labelledby="${TITLES[name]}"]`
  )!
// jsdom reflects only the attribute for React-managed inert and only the property for
// imperatively assigned inert; a browser keeps the two in sync.
const isInert = (element: HTMLElement) =>
  element.inert === true || element.hasAttribute('inert')
const shell = () => document.querySelector<HTMLElement>('[data-app-shell]')!
const mountSurface = () => {
  const controls: { current: Controls | null } = { current: null }
  const view = render(<Surface controls={controls} />)
  return { controls, ...view }
}

describe('AccessibleModal stack', () => {
  it('keeps the share dialog interactive after a detail and share suspend and resume together', () => {
    const { controls } = mountSurface()
    act(() => controls.current!.set({ detailSuspended: true, share: false }))
    expect(dialog('Detail')).toHaveAttribute('aria-hidden', 'true')
    expect(isInert(shell())).toBe(false)
    expect(document.body.style.overflow).toBe('')

    act(() => controls.current!.set({ detailSuspended: false, share: true }))
    const detail = dialog('Detail')
    const share = dialog('Share')
    expect(isInert(share)).toBe(false)
    expect(share).not.toHaveAttribute('aria-hidden')
    expect(isInert(detail)).toBe(true)
    expect(detail).toHaveAttribute('aria-hidden', 'true')
    expect(isInert(shell())).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('dims the page once: only the top dialog keeps its scrim, and a covered one regains it on top', () => {
    const { controls } = mountSurface()
    expect(dialog('Share')).toHaveClass('bg-black/60')
    expect(dialog('Detail')).toHaveClass('bg-transparent')
    expect(dialog('Detail')).not.toHaveClass('bg-black/60')
    act(() => controls.current!.set({ share: false }))
    expect(dialog('Detail')).toHaveClass('bg-black/60')
    expect(dialog('Detail')).not.toHaveClass('bg-transparent')
  })

  it('closes only the top dialog on Escape after resuming together', () => {
    const { controls } = mountSurface()
    act(() => controls.current!.set({ detailSuspended: true, share: false }))
    act(() => controls.current!.set({ detailSuspended: false, share: true }))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(controls.current!.closes).toEqual(['share'])
  })

  it('makes the detail the top dialog again once the share dialog closes', () => {
    const { controls } = mountSurface()
    act(() => controls.current!.set({ share: false }))
    const detail = dialog('Detail')
    expect(isInert(detail)).toBe(false)
    expect(detail).not.toHaveAttribute('aria-hidden')
    expect(isInert(shell())).toBe(true)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(controls.current!.closes).toEqual(['detail'])
  })

  it('restores the shell and scroll when both dialogs disappear in one commit', () => {
    document.body.style.overflow = 'auto'
    const { controls } = mountSurface()
    act(() => controls.current!.set({ detail: false, share: false }))
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
    expect(isInert(shell())).toBe(false)
    expect(shell()).not.toHaveAttribute('aria-hidden')
    expect(document.body.style.overflow).toBe('auto')
    document.body.style.overflow = ''
  })

  it('restores the shell and scroll when the whole surface unmounts', () => {
    const { unmount } = mountSurface()
    expect(isInert(shell())).toBe(true)
    unmount()
    expect(document.body.style.overflow).toBe('')
    expect(document.querySelectorAll('[inert],[aria-hidden]')).toHaveLength(0)
  })

  it('restores the shell when the child leaves first and then the parent', () => {
    const { controls } = mountSurface()
    act(() => controls.current!.set({ share: false }))
    act(() => controls.current!.set({ detail: false }))
    expect(isInert(shell())).toBe(false)
    expect(shell()).not.toHaveAttribute('aria-hidden')
    expect(document.body.style.overflow).toBe('')
  })

  it('ranks resumed dialogs by open order even when the later one registers first', () => {
    const onCloseFirst = vi.fn()
    const onCloseSecond = vi.fn()
    function Reversed({ first }: { first: boolean }) {
      // The dialog opened last renders first, so its layout effect runs first.
      return (
        <>
          <AccessibleModal
            isOpen
            suspended={!first}
            onClose={onCloseSecond}
            titleId="second-title"
            title="Second"
          >
            <button type="button">Second action</button>
          </AccessibleModal>
          <AccessibleModal
            isOpen
            suspended={!first}
            onClose={onCloseFirst}
            titleId="first-title"
            title="First"
          >
            <button type="button">First action</button>
          </AccessibleModal>
        </>
      )
    }
    const view = render(<Reversed first />)
    // Both are open; the second (rendered first) registered first, so it is covered.
    expect(isInert(dialog('Second'))).toBe(true)
    expect(isInert(dialog('First'))).toBe(false)
    view.rerender(<Reversed first={false} />)
    view.rerender(<Reversed first />)
    expect(isInert(dialog('Second'))).toBe(true)
    expect(isInert(dialog('First'))).toBe(false)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onCloseFirst).toHaveBeenCalledTimes(1)
    expect(onCloseSecond).not.toHaveBeenCalled()
  })

  it('does not let a suspended dialog restore a stale inert value over its own props', () => {
    function Single({ suspended }: { suspended: boolean }) {
      return (
        <AccessibleModal
          isOpen
          suspended={suspended}
          onClose={vi.fn()}
          titleId="solo-title"
          title="Solo"
        >
          <button type="button">Solo action</button>
        </AccessibleModal>
      )
    }
    const view = render(<Single suspended />)
    view.rerender(<Single suspended={false} />)
    expect(isInert(dialog('Solo'))).toBe(false)
    expect(dialog('Solo')).not.toHaveAttribute('aria-hidden')
    view.rerender(<Single suspended />)
    view.rerender(<Single suspended={false} />)
    expect(isInert(dialog('Solo'))).toBe(false)
  })

  it('shares one scroll lock with a surface that is not a dialog, whatever the release order', () => {
    document.body.style.overflow = 'auto'
    try {
      const releaseSurface = acquireScrollLock()
      expect(document.body.style.overflow).toBe('hidden')
      const { controls } = mountSurface()
      act(() => controls.current!.set({ detail: false, share: false }))
      // The dialogs left first, but the other surface still holds the lock.
      expect(document.body.style.overflow).toBe('hidden')
      releaseSurface()
      expect(document.body.style.overflow).toBe('auto')
      // A second release of the same holder changes nothing.
      const again = acquireScrollLock()
      again()
      again()
      expect(document.body.style.overflow).toBe('auto')
    } finally {
      document.body.style.overflow = ''
    }
  })

  it('returns focus to the share opener inside the detail, then to the detail invoker', async () => {
    function Openers() {
      const [detail, setDetail] = useState(false)
      const [share, setShare] = useState(false)
      const detailInvoker = useRef<HTMLButtonElement>(null)
      const shareOpener = useRef<HTMLButtonElement>(null)
      return (
        <>
          <button ref={detailInvoker} type="button" onClick={() => setDetail(true)}>
            Open detail
          </button>
          <AccessibleModal
            isOpen={detail}
            onClose={() => setDetail(false)}
            invokingElementRef={detailInvoker}
            titleId="detail-title"
            title="Detail"
          >
            <button ref={shareOpener} type="button" onClick={() => setShare(true)}>
              Share this
            </button>
          </AccessibleModal>
          <AccessibleModal
            isOpen={share}
            onClose={() => setShare(false)}
            invokingElementRef={shareOpener}
            titleId="share-title"
            title="Share"
          >
            <button type="button">Share action</button>
          </AccessibleModal>
        </>
      )
    }
    render(<Openers />)
    await userEvent.click(screen.getByRole('button', { name: 'Open detail' }))
    await userEvent.click(screen.getByRole('button', { name: 'Share this' }))
    expect(dialog('Share')).toBeTruthy()

    await userEvent.keyboard('{Escape}')
    await act(async () => {
      await Promise.resolve()
    })
    expect(dialog('Share')).toBeNull()
    expect(screen.getByRole('button', { name: 'Share this' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    await act(async () => {
      await Promise.resolve()
    })
    expect(dialog('Detail')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open detail' })).toHaveFocus()
  })

  it('focuses the first fallback selector that still matches once the invoker is gone', async () => {
    function Fallbacks({ open, withFirst }: { open: boolean; withFirst: boolean }) {
      return (
        <>
          {withFirst && <button data-testid="first-target">First</button>}
          <button data-testid="second-target">Second</button>
          <AccessibleModal
            isOpen={open}
            onClose={vi.fn()}
            titleId="solo-title"
            title="Solo"
            fallbackFocusSelector={[
              '[data-testid="first-target"]',
              '[data-testid="second-target"]',
            ]}
          >
            <button type="button">Solo action</button>
          </AccessibleModal>
        </>
      )
    }
    const view = render(<Fallbacks open withFirst />)
    view.rerender(<Fallbacks open={false} withFirst />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('first-target')).toHaveFocus()
    view.rerender(<Fallbacks open withFirst={false} />)
    view.rerender(<Fallbacks open={false} withFirst={false} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('second-target')).toHaveFocus()
  })

  it('still focuses the remaining fallback when the list shrinks while the dialog is open', async () => {
    function Shrinking({ open, selectors }: { open: boolean; selectors: string[] }) {
      return (
        <>
          <button data-testid="card-target">Card</button>
          <button data-testid="section-target">Section</button>
          <AccessibleModal
            isOpen={open}
            onClose={vi.fn()}
            titleId="solo-title"
            title="Solo"
            fallbackFocusSelector={selectors}
          >
            <button type="button">Solo action</button>
          </AccessibleModal>
        </>
      )
    }
    const card = '[data-testid="card-target"]'
    const section = '[data-testid="section-target"]'
    const view = render(<Shrinking open selectors={[card, section]} />)
    view.rerender(<Shrinking open selectors={[section]} />)
    await act(async () => {
      await Promise.resolve()
    })
    // Changing the list is not a close: focus stays in the dialog.
    expect(screen.getByTestId('section-target')).not.toHaveFocus()
    view.rerender(<Shrinking open={false} selectors={[section]} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('section-target')).toHaveFocus()
  })

  describe('focus target order on close', () => {
    const recorded = '[data-testid="recorded-target"]'
    const section = '[data-testid="section-target"]'
    function Ordered({ open, withRecorded }: { open: boolean; withRecorded: boolean }) {
      return (
        <>
          <button data-testid="earlier-focus">Earlier</button>
          {withRecorded && <button data-testid="recorded-target">Recorded</button>}
          <button data-testid="section-target">Section</button>
          <AccessibleModal
            isOpen={open}
            onClose={vi.fn()}
            titleId="solo-title"
            title="Solo"
            fallbackFocusSelector={recorded}
            finalFocusSelector={section}
          >
            <button type="button">Solo action</button>
          </AccessibleModal>
        </>
      )
    }
    const close = async (view: ReturnType<typeof render>, withRecorded: boolean) => {
      view.rerender(<Ordered open={false} withRecorded={withRecorded} />)
      await act(async () => {
        await Promise.resolve()
      })
    }

    it('prefers the recorded control, then the element focused at open, then the final target', async () => {
      const view = render(<Ordered open={false} withRecorded />)
      screen.getByTestId('earlier-focus').focus()
      view.rerender(<Ordered open withRecorded />)
      await close(view, true)
      expect(screen.getByTestId('recorded-target')).toHaveFocus()
    })

    it('keeps the element focused at open when the recorded control is gone', async () => {
      const view = render(<Ordered open={false} withRecorded={false} />)
      screen.getByTestId('earlier-focus').focus()
      view.rerender(<Ordered open withRecorded={false} />)
      await close(view, false)
      expect(screen.getByTestId('earlier-focus')).toHaveFocus()
    })

    it('falls to the final target when neither the recorded control nor the earlier element remains', async () => {
      const view = render(<Ordered open={false} withRecorded={false} />)
      const earlier = screen.getByTestId('earlier-focus')
      earlier.focus()
      view.rerender(<Ordered open withRecorded={false} />)
      earlier.remove()
      await close(view, false)
      expect(screen.getByTestId('section-target')).toHaveFocus()
    })
  })
})
