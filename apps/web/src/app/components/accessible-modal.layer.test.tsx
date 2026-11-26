// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-CMP-LAYER-001..012, the AccessibleModal side of D12 (the
// full-height layer presentation) and D13 (history entry, swipe down, sign-out close, the link
// hand-off of P2). The history module itself is modal-stack.layer-history.test.ts; the browser
// journeys are 7.11-E2E-04x.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { describe, expect, it, vi } from 'vitest'
import { APP_SIGNED_OUT_EVENT } from '../../lib/app-history'
import { AccessibleModal, LAYER_SWIPE_CLOSE_PX } from './accessible-modal'

type ModalProps = Partial<React.ComponentProps<typeof AccessibleModal>>

/** A layer that closes for real, so its history entry is released like in the app. */
function Harness({
  onClose,
  props = {},
  children,
}: {
  onClose: () => void
  props?: ModalProps
  children?: React.ReactNode
}) {
  const [open, setOpen] = React.useState(true)
  const invoker = React.useRef<HTMLButtonElement | null>(null)
  return (
    <>
      <button ref={invoker} type="button" onClick={() => setOpen(true)}>
        Open look
      </button>
      <AccessibleModal
        isOpen={open}
        onClose={() => {
          onClose()
          setOpen(false)
        }}
        titleId="layer-title"
        title="Camel trench"
        invokingElementRef={invoker}
        {...props}
      >
        {children ?? <button type="button">Inside</button>}
      </AccessibleModal>
    </>
  )
}

/**
 * Every open pushes one entry, but a push waits for back steps an earlier case started to land
 * (modal-stack.ts), so a case first waits for its own push before it moves history.
 */
async function openedWithEntry(push: ReturnType<typeof vi.spyOn>, count = 1) {
  await waitFor(() => expect(push).toHaveBeenCalledTimes(count))
}

/** Resolves on the next popstate, which jsdom fires a task after a traversal. */
function nextPopState() {
  return new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true })
  })
}

function setScrollTop(element: HTMLElement, value: number) {
  Object.defineProperty(element, 'scrollTop', { configurable: true, value })
}

function drag(
  start: HTMLElement,
  move: { dx: number; dy: number },
  options: { pointerType?: string; pointerId?: number; movePointerId?: number } = {}
) {
  const pointerType = options.pointerType ?? 'touch'
  const pointerId = options.pointerId ?? 1
  fireEvent.pointerDown(start, { pointerType, pointerId, clientX: 100, clientY: 100 })
  fireEvent.pointerMove(start, {
    pointerType,
    pointerId: options.movePointerId ?? pointerId,
    clientX: 100 + move.dx,
    clientY: 100 + move.dy,
  })
}

describe('7.11 AccessibleModal full-height layer (D12)', () => {
  it('7.11-CMP-LAYER-001 renders a page-surface layer under a top bar with back and the title, with no X', () => {
    render(
      <Harness
        onClose={vi.fn()}
        props={{
          presentation: 'screen',
          description: 'Saved for rain',
          descriptionId: 'layer-description',
          closeLabel: 'Close',
        }}
      />
    )

    const dialog = screen.getByRole('dialog', { name: 'Camel trench' })
    expect(dialog).toHaveAttribute('data-presentation', 'screen')
    expect(dialog).toHaveClass('bg-page')
    expect(dialog).not.toHaveClass('bg-scrim/60')
    const handle = within(dialog).getByTestId('layer-swipe-handle')
    expect(within(handle).getByTestId('app-top-bar-title')).toHaveTextContent(
      'Camel trench'
    )
    const back = within(handle).getByTestId('app-top-bar-back')
    expect(back).toHaveAccessibleName('Back')
    // D12: the back arrow takes the X's place, focus included.
    expect(back).toHaveFocus()
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull()
    // The description and content scroll in the body below the bar.
    const body = within(dialog).getByTestId('layer-body')
    expect(handle.contains(body)).toBe(false)
    expect(within(body).getByText('Saved for rain')).toBeInTheDocument()
    expect(dialog).toHaveAccessibleDescription('Saved for rain')
    expect(within(body).getByRole('button', { name: 'Inside' })).toBeInTheDocument()
  })

  it('7.11-CMP-LAYER-002 paints a theme layer with the premium palette and a default one with the page roles', () => {
    const { unmount } = render(
      <Harness onClose={vi.fn()} props={{ presentation: 'screen', surface: 'theme' }} />
    )
    const themePanel = screen.getByRole('dialog').firstElementChild
    expect(themePanel).toHaveClass('h-full', 'bg-theme-card-bg', 'text-theme-card-text')
    unmount()
    render(<Harness onClose={vi.fn()} props={{ presentation: 'screen' }} />)
    const defaultPanel = screen.getByRole('dialog').firstElementChild
    expect(defaultPanel).toHaveClass('h-full', 'bg-page', 'text-ink')
    expect(defaultPanel).not.toHaveClass('max-w-lg')
  })

  it('7.11-CMP-LAYER-003 shows the error and keeps one status region inside the layer body', () => {
    render(
      <Harness
        onClose={vi.fn()}
        props={{
          presentation: 'screen',
          errorMessage: 'Could not load this look',
          ariaLiveMessage: 'Look saved',
        }}
      />
    )
    const body = screen.getByTestId('layer-body')
    expect(within(body).getByRole('alert')).toHaveTextContent('Could not load this look')
    expect(within(body).getByRole('status')).toHaveTextContent('Look saved')
  })

  it('7.11-CMP-LAYER-004 the back arrow closes the layer and returns focus to its opener', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} props={{ presentation: 'screen' }} />)

    fireEvent.click(screen.getByTestId('app-top-bar-back'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open look' })).toHaveFocus()
  })

  it('7.11-CMP-LAYER-005 a dialog keeps its X, the scrim and the header as its swipe handle', () => {
    render(<Harness onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('data-presentation', 'dialog')
    expect(dialog).toHaveClass('bg-scrim/60')
    expect(dialog.firstElementChild).toHaveAttribute('data-testid', 'layer-body')
    expect(
      within(screen.getByTestId('layer-swipe-handle')).getByRole('button', {
        name: 'Close modal',
      })
    ).toBeInTheDocument()
    expect(screen.queryByTestId('app-top-bar-back')).toBeNull()
  })
})

describe('7.11 AccessibleModal history entry (D13, P2, P8)', () => {
  it('7.11-CMP-LAYER-006 opening pushes one same-URL entry; a suspended layer pushes none', async () => {
    const push = vi.spyOn(window.history, 'pushState')
    const href = window.location.href
    const { rerender } = render(
      <AccessibleModal
        isOpen
        suspended
        onClose={vi.fn()}
        titleId="layer-title"
        title="Camel trench"
      >
        <button type="button">Inside</button>
      </AccessibleModal>
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(push).not.toHaveBeenCalled()

    rerender(
      <AccessibleModal
        isOpen
        onClose={vi.fn()}
        titleId="layer-title"
        title="Camel trench"
      >
        <button type="button">Inside</button>
      </AccessibleModal>
    )
    await openedWithEntry(push)
    expect(push.mock.calls[0]![2]).toBe(href)
    expect(window.location.href).toBe(href)
  })

  it('7.11-CMP-LAYER-007 browser back closes the layer once and leaves the URL alone', async () => {
    const push = vi.spyOn(window.history, 'pushState')
    const onClose = vi.fn()
    const href = window.location.href
    render(<Harness onClose={onClose} props={{ presentation: 'screen' }} />)
    await openedWithEntry(push)

    const popped = nextPopState()
    act(() => window.history.back())
    await act(async () => {
      await popped
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.location.href).toBe(href)
    expect(screen.getByRole('button', { name: 'Open look' })).toHaveFocus()
  })

  it('7.11-CMP-LAYER-008 closing by X steps back over its entry once and that step closes nothing more', async () => {
    const push = vi.spyOn(window.history, 'pushState')
    const go = vi.spyOn(window.history, 'go')
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await openedWithEntry(push)

    const popped = nextPopState()
    fireEvent.click(screen.getByLabelText('Close modal'))
    await waitFor(() => expect(go).toHaveBeenCalledWith(-1))
    await act(async () => {
      await popped
    })

    expect(go).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('7.11-CMP-LAYER-009 a layer that refuses to close on back gets its entry again', async () => {
    const push = vi.spyOn(window.history, 'pushState')
    const onClose = vi.fn()
    // A busy layer (an upload in flight) keeps itself open.
    render(
      <AccessibleModal isOpen onClose={onClose} titleId="layer-title" title="Uploading">
        <button type="button">Inside</button>
      </AccessibleModal>
    )
    await openedWithEntry(push)

    const popped = nextPopState()
    act(() => window.history.back())
    await act(async () => {
      await popped
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await openedWithEntry(push, 2)
  })

  it('7.11-CMP-LAYER-010 sign-out closes an open layer (P8)', async () => {
    const push = vi.spyOn(window.history, 'pushState')
    const onClose = vi.fn()
    render(<Harness onClose={onClose} props={{ presentation: 'screen' }} />)
    await openedWithEntry(push)

    act(() => {
      window.dispatchEvent(new Event(APP_SIGNED_OUT_EVENT))
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  describe('a link inside the layer (P2)', () => {
    function renderWithRouter(link: React.ReactNode) {
      const replace = vi.fn()
      const router = { replace, push: vi.fn(), back: vi.fn() }
      const onClose = vi.fn()
      render(
        <AppRouterContext.Provider
          value={router as unknown as React.ContextType<typeof AppRouterContext>}
        >
          <Harness onClose={onClose} props={{ presentation: 'screen' }}>
            {link}
          </Harness>
        </AppRouterContext.Provider>
      )
      return { replace, onClose }
    }

    it('7.11-CMP-LAYER-011 replaces the layer entry with another route, keeping its query and hash', async () => {
      const push = vi.spyOn(window.history, 'pushState')
      const go = vi.spyOn(window.history, 'go')
      const { replace } = renderWithRouter(
        <a href="/wardrobe?garment=g1#top">Open garment</a>
      )
      await openedWithEntry(push)

      const click = fireEvent.click(screen.getByRole('link', { name: 'Open garment' }))

      expect(click).toBe(false)
      expect(replace).toHaveBeenCalledExactlyOnceWith('/wardrobe?garment=g1#top')
      // The navigation owns the entry now, so nothing steps back over it.
      await act(async () => {
        await Promise.resolve()
      })
      expect(go).not.toHaveBeenCalled()
    })

    type LinkCase = [
      string,
      React.AnchorHTMLAttributes<HTMLAnchorElement>,
      Partial<MouseEventInit>,
    ]
    it.each<LinkCase>([
      ['a modified click', { href: '/wardrobe' }, { metaKey: true }],
      ['a middle click', { href: '/wardrobe' }, { button: 1 }],
      ['a new tab target', { href: '/wardrobe', target: '_blank' }, {}],
      ['a download', { href: '/wardrobe', download: true }, {}],
      ['another origin', { href: 'https://partner.example/look' }, {}],
      ['the same URL', { href: window.location.pathname }, {}],
    ])('7.11-CMP-LAYER-012 leaves %s to the browser', (_case, attributes, init) => {
      const { replace } = renderWithRouter(<a {...attributes}>Open garment</a>)
      const anchor = screen.getByRole('link', { name: 'Open garment' })
      // Keep jsdom from attempting the navigation the layer left alone.
      const stop = (event: Event) => event.preventDefault()
      window.addEventListener('click', stop, { once: true })
      const before = { defaultPrevented: false }
      anchor.addEventListener(
        'click',
        (event) => {
          before.defaultPrevented = event.defaultPrevented
        },
        { once: true }
      )

      fireEvent.click(anchor, init)

      expect(replace).not.toHaveBeenCalled()
      expect(before.defaultPrevented).toBe(false)
    })

    it('7.11-CMP-LAYER-012 ignores a click that is not on a link', () => {
      const { replace, onClose } = renderWithRouter(<button type="button">Like</button>)
      fireEvent.click(screen.getByRole('button', { name: 'Like' }))
      expect(replace).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})

describe('7.11 AccessibleModal swipe down (D13, P3)', () => {
  it(`7.11-CMP-SWIPE-001 a touch or pen drag of ${LAYER_SWIPE_CLOSE_PX} px down from the header closes`, () => {
    for (const pointerType of ['touch', 'pen']) {
      const onClose = vi.fn()
      const { unmount } = render(
        <Harness onClose={onClose} props={{ presentation: 'screen' }} />
      )
      // The header drag works even with the body scrolled.
      setScrollTop(screen.getByTestId('layer-body'), 240)
      drag(
        screen.getByTestId('app-top-bar-title'),
        { dx: 10, dy: LAYER_SWIPE_CLOSE_PX },
        { pointerType }
      )
      expect(onClose).toHaveBeenCalledTimes(1)
      unmount()
    }
  })

  it('7.11-CMP-SWIPE-002 a drag in the body closes only while the body is at its top', () => {
    const onClose = vi.fn()
    render(
      <Harness onClose={onClose} props={{ presentation: 'screen' }}>
        <p>Look notes</p>
      </Harness>
    )
    const body = screen.getByTestId('layer-body')
    const notes = screen.getByText('Look notes')

    setScrollTop(body, 40)
    drag(notes, { dx: 0, dy: 200 })
    expect(onClose).not.toHaveBeenCalled()

    setScrollTop(body, 0)
    drag(notes, { dx: 0, dy: 120 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('7.11-CMP-SWIPE-003 a body drag that starts at the top stops once the body scrolls', () => {
    const onClose = vi.fn()
    render(
      <Harness onClose={onClose} props={{ presentation: 'screen' }}>
        <p>Look notes</p>
      </Harness>
    )
    const body = screen.getByTestId('layer-body')
    const notes = screen.getByText('Look notes')
    setScrollTop(body, 0)
    fireEvent.pointerDown(notes, {
      pointerType: 'touch',
      pointerId: 3,
      clientX: 0,
      clientY: 0,
    })
    setScrollTop(body, 30)
    fireEvent.pointerMove(notes, {
      pointerType: 'touch',
      pointerId: 3,
      clientX: 0,
      clientY: 40,
    })
    setScrollTop(body, 0)
    fireEvent.pointerMove(notes, {
      pointerType: 'touch',
      pointerId: 3,
      clientX: 0,
      clientY: 200,
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it.each([
    ['short', { dx: 0, dy: LAYER_SWIPE_CLOSE_PX - 1 }],
    ['upward', { dx: 0, dy: -200 }],
    ['horizontal', { dx: 200, dy: 120 }],
  ])('7.11-CMP-SWIPE-004 a %s drag never closes', (_case, move) => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} props={{ presentation: 'screen' }} />)
    drag(screen.getByTestId('app-top-bar-title'), move)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('7.11-CMP-SWIPE-005 a mouse drag and another pointer never close; release or cancel ends the drag', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} props={{ presentation: 'screen' }} />)
    const title = screen.getByTestId('app-top-bar-title')

    drag(title, { dx: 0, dy: 200 }, { pointerType: 'mouse' })
    drag(title, { dx: 0, dy: 200 }, { pointerId: 1, movePointerId: 2 })
    for (const end of [fireEvent.pointerUp, fireEvent.pointerCancel]) {
      fireEvent.pointerDown(title, {
        pointerType: 'touch',
        pointerId: 5,
        clientX: 0,
        clientY: 0,
      })
      end(title, { pointerType: 'touch', pointerId: 5 })
      fireEvent.pointerMove(title, {
        pointerType: 'touch',
        pointerId: 5,
        clientX: 0,
        clientY: 200,
      })
    }
    expect(onClose).not.toHaveBeenCalled()
  })

  it('7.11-CMP-SWIPE-006 a dialog closes from its header, and from its panel only at the panel top', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const panel = screen.getByTestId('layer-body')
    const inside = screen.getByRole('button', { name: 'Inside' })

    setScrollTop(panel, 60)
    drag(inside, { dx: 0, dy: 200 })
    expect(onClose).not.toHaveBeenCalled()
    drag(within(screen.getByTestId('layer-swipe-handle')).getByText('Camel trench'), {
      dx: 0,
      dy: 100,
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
