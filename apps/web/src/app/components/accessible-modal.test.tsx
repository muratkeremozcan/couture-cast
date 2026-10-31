// Learning path Step 42: Screened threaded comments.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-42-screened-threaded-comments
import React from 'react'
import { renderToString } from 'react-dom/server'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AccessibleModal } from './accessible-modal'

function renderModal(
  props: Partial<React.ComponentProps<typeof AccessibleModal>> = {},
  options: { appShellAriaHidden?: 'true' | 'false' } = {}
) {
  const onClose = vi.fn()
  const view = render(
    <>
      <div data-app-shell aria-hidden={options.appShellAriaHidden}>
        <button type="button">Behind the modal</button>
      </div>
      <AccessibleModal
        isOpen
        onClose={onClose}
        titleId="modal-title"
        title="Silhouette settings"
        {...props}
      >
        <button type="button" data-testid="first-child">
          First
        </button>
        <button type="button" data-testid="last-child">
          Last
        </button>
      </AccessibleModal>
    </>
  )
  return { onClose, ...view }
}

describe('AccessibleModal', () => {
  it('keeps the dialog outside a transformed page ancestor and the inert app shell', () => {
    render(
      <div data-app-shell style={{ transform: 'translateX(0)' }}>
        <AccessibleModal
          isOpen
          onClose={vi.fn()}
          titleId="viewport-title"
          title="Comments"
        >
          <button type="button">Send comment</button>
        </AccessibleModal>
      </div>
    )
    const dialog = screen.getByRole('dialog', { hidden: true })
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog.closest('[data-app-shell]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send comment' })).toBeVisible()
  })

  it('can render an initially open dialog during SSR without a document', () => {
    vi.stubGlobal('document', undefined)
    try {
      expect(
        renderToString(
          <AccessibleModal
            isOpen
            onClose={vi.fn()}
            titleId="server-title"
            title="Comments"
          >
            <button type="button">Send comment</button>
          </AccessibleModal>
        )
      ).toBe('')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('pairs a theme surface with the existing light-surface keyboard focus token', () => {
    renderModal({ surface: 'theme' })
    expect(screen.getByRole('dialog').firstElementChild).toHaveAttribute(
      'data-focus-surface',
      'light'
    )
  })

  it('hides actual page content without an app-shell marker and restores prior state', () => {
    const view = render(
      <main aria-hidden="false">
        <button type="button">Background action</button>
        <div style={{ transform: 'translateX(0)' }}>
          <AccessibleModal
            isOpen
            title="Comments"
            titleId="background-test"
            onClose={vi.fn()}
          >
            <button type="button">Inside discussion</button>
          </AccessibleModal>
        </div>
      </main>
    )
    const background = screen.getByText('Background action')
    expect(background.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.getByRole('dialog').closest('[aria-hidden="true"]')).toBeNull()
    view.unmount()
    expect(view.container).not.toHaveAttribute('aria-hidden')
    expect(view.container.inert).toBe(false)
  })

  /**
   * Every body-level sibling is background, not only the app shell: a toast or
   * banner portal outside the shell must not stay reachable behind the dialog.
   */
  it('inerts every body sibling except its own portal and restores each prior state on close', () => {
    const banner = document.body.appendChild(document.createElement('aside'))
    const shown = Object.assign(
      document.body.appendChild(document.createElement('nav')),
      {
        inert: true,
      }
    )
    shown.setAttribute('aria-hidden', 'false')
    const script = document.body.appendChild(document.createElement('script'))
    try {
      const { unmount } = renderModal()
      const dialog = screen.getByRole('dialog')

      expect(banner).toHaveAttribute('aria-hidden', 'true')
      expect(banner.inert).toBe(true)
      expect(shown).toHaveAttribute('aria-hidden', 'true')
      expect(shown.inert).toBe(true)
      expect(script).not.toHaveAttribute('aria-hidden')
      expect(dialog.parentElement).toBe(document.body)
      expect(dialog).not.toHaveAttribute('aria-hidden')
      expect(dialog.inert).not.toBe(true)

      unmount()

      expect(banner).not.toHaveAttribute('aria-hidden')
      expect(banner.inert).toBe(false)
      expect(shown).toHaveAttribute('aria-hidden', 'false')
      expect(shown.inert).toBe(true)
    } finally {
      banner.remove()
      shown.remove()
      script.remove()
    }
  })

  /**
   * A second modal opened over the first hides the first one's portal only
   * while it is open; closing it hands the first dialog back intact.
   */
  it('leaves an outer modal reachable and focused after a stacked modal closes', async () => {
    function Stacked({ inner }: { inner: boolean }) {
      return (
        <>
          <button type="button">Page action</button>
          <AccessibleModal
            isOpen
            onClose={vi.fn()}
            titleId="outer-title"
            title="Outer"
            closeLabel="Close outer"
          >
            <button type="button">Outer action</button>
          </AccessibleModal>
          <AccessibleModal
            isOpen={inner}
            onClose={vi.fn()}
            titleId="inner-title"
            title="Inner"
            closeLabel="Close inner"
          >
            <button type="button">Inner action</button>
          </AccessibleModal>
        </>
      )
    }
    const view = render(<Stacked inner={false} />)
    const outer = screen.getByRole('dialog', { name: 'Outer' })
    expect(document.activeElement).toBe(screen.getByLabelText('Close outer'))

    view.rerender(<Stacked inner />)
    const inner = screen.getByRole('dialog', { name: 'Inner' })
    expect(outer).toHaveAttribute('aria-hidden', 'true')
    expect(outer).toHaveAttribute('inert')
    expect(inner).not.toHaveAttribute('aria-hidden')
    expect(document.activeElement).toBe(screen.getByLabelText('Close inner'))

    view.rerender(<Stacked inner={false} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByRole('dialog', { name: 'Inner' })).not.toBeInTheDocument()
    expect(outer).not.toHaveAttribute('aria-hidden')
    expect(outer).not.toHaveAttribute('inert')
    expect(document.activeElement).toBe(screen.getByLabelText('Close outer'))
    // The page behind the outer modal stays hidden while the outer modal is open.
    expect(view.container).toHaveAttribute('aria-hidden', 'true')
    expect(view.container.inert).toBe(true)
    expect(screen.queryByRole('button', { name: 'Page action' })).not.toBeInTheDocument()

    view.unmount()
    expect(view.container).not.toHaveAttribute('aria-hidden')
    expect(view.container.inert).toBe(false)
  })

  it('renders nothing while closed', () => {
    renderModal({ isOpen: false })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('labels the dialog by its title and describes it when a description is given', () => {
    renderModal({ descriptionId: 'modal-desc', description: 'Adjust your silhouette.' })

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title')
    expect(dialog).toHaveAttribute('aria-describedby', 'modal-desc')
    expect(screen.getByText('Adjust your silhouette.')).toBeInTheDocument()
  })

  it('omits the description paragraph when no description is supplied', () => {
    renderModal()

    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby')
  })

  /** Opening a dialog without moving focus into it strands screen reader users outside. */
  it('moves focus to the close button on open', () => {
    renderModal()

    expect(document.activeElement).toBe(screen.getByLabelText('Close modal'))
  })

  it('honors an explicit initial focus target over the close button', () => {
    function Harness() {
      const inputRef = React.useRef<HTMLInputElement | null>(null)
      return (
        <AccessibleModal
          isOpen
          onClose={vi.fn()}
          titleId="modal-title"
          title="Named"
          initialFocusRef={inputRef}
        >
          <input ref={inputRef} aria-label="Capsule name" />
        </AccessibleModal>
      )
    }
    render(<Harness />)

    expect(document.activeElement).toBe(screen.getByLabelText('Capsule name'))
  })

  it('uses a caller-supplied close label', () => {
    renderModal({ closeLabel: 'Dismiss silhouette settings' })

    expect(screen.getByLabelText('Dismiss silhouette settings')).toBeInTheDocument()
  })

  it('closes on Escape and on the close button', () => {
    const { onClose } = renderModal()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText('Close modal'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closes the active dialog when browser focus temporarily falls to the body', async () => {
    const { onClose } = renderModal()
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement).toBe(document.body)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  /** Ordinary typing inside the dialog must not be intercepted by the trap. */
  it('ignores keys that are neither Escape nor Tab', () => {
    const { onClose } = renderModal()
    const before = document.activeElement

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'a' })

    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(before)
  })

  /**
   * The trap is the whole reason this component exists: tabbing past the last
   * control must return to the top of the dialog rather than escape into the
   * inert page behind it.
   */
  it('wraps focus from the last control back to the first on Tab', () => {
    renderModal()
    const closeButton = screen.getByLabelText('Close modal')
    const last = screen.getByTestId('last-child')
    last.focus()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })

    expect(document.activeElement).toBe(closeButton)
  })

  it('wraps focus from the first control back to the last on Shift+Tab', () => {
    renderModal()
    const closeButton = screen.getByLabelText('Close modal')
    closeButton.focus()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(screen.getByTestId('last-child'))
  })

  /** Away from the boundaries the browser's own tab order must be left alone. */
  it('leaves focus alone when tabbing in the middle of the dialog', () => {
    renderModal()
    const first = screen.getByTestId('first-child')
    first.focus()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })

    expect(document.activeElement).toBe(first)
  })

  /** Disabled and visually hidden controls are not tab stops, so they cannot be the wrap target. */
  it('skips disabled and hidden controls when computing the trap boundaries', () => {
    const onClose = vi.fn()
    render(
      <AccessibleModal isOpen onClose={onClose} titleId="modal-title" title="Boundaries">
        <button type="button" data-testid="reachable">
          Reachable
        </button>
        <button type="button" disabled data-testid="disabled-tail">
          Disabled tail
        </button>
        <button type="button" className="hidden" data-testid="hidden-tail">
          Hidden tail
        </button>
      </AccessibleModal>
    )

    screen.getByTestId('reachable').focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })

    expect(document.activeElement).toBe(screen.getByLabelText('Close modal'))
  })

  it('L2: keeps one empty status region mounted and updates its text for announcements', () => {
    const { rerender } = renderModal()
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()

    rerender(
      <>
        <div data-app-shell />
        <AccessibleModal
          isOpen
          onClose={vi.fn()}
          titleId="modal-title"
          title="Silhouette settings"
          ariaLiveMessage="Saving changes. Please wait."
        >
          <button type="button">First</button>
        </AccessibleModal>
      </>
    )

    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent('Saving changes. Please wait.')
  })

  it('announces an error assertively', () => {
    renderModal({ errorMessage: 'Could not save your silhouette.' })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Could not save your silhouette.')
    expect(alert).toHaveAttribute('aria-live', 'assertive')
  })

  /** A modal that leaves the page scrollable lets the background move under it. */
  it('locks background scroll while open and restores the prior value on close', () => {
    document.body.style.overflow = 'auto'
    const { unmount } = renderModal()

    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).toBe('auto')
    document.body.style.overflow = ''
  })

  /** Assistive tech must not be able to reach the page behind an open modal. */
  it('hides the app shell from assistive tech while open and unhides it on close', () => {
    const { unmount } = renderModal()
    const appShell = document.querySelector('[data-app-shell]')

    expect(appShell).toHaveAttribute('aria-hidden', 'true')
    expect((appShell as HTMLElement & { inert?: boolean }).inert).toBe(true)

    unmount()
  })

  /**
   * A shell that was already hidden (nested modal, or a shell that hides itself)
   * must keep its own value rather than being unhidden by the inner modal.
   */
  it('restores a pre-existing aria-hidden value on the app shell', () => {
    const { unmount } = renderModal({}, { appShellAriaHidden: 'true' })
    const appShell = document.querySelector('[data-app-shell]')

    unmount()

    expect(appShell).toHaveAttribute('aria-hidden', 'true')
  })

  it('returns focus to the invoking element on close', async () => {
    function Harness() {
      const [isOpen, setIsOpen] = React.useState(false)
      const invokerRef = React.useRef<HTMLButtonElement | null>(null)
      return (
        <>
          <button ref={invokerRef} type="button" onClick={() => setIsOpen(true)}>
            Open settings
          </button>
          <AccessibleModal
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            titleId="modal-title"
            title="Settings"
            invokingElementRef={invokerRef}
          >
            <button type="button">Inside</button>
          </AccessibleModal>
        </>
      )
    }
    render(<Harness />)

    const invoker = screen.getByRole('button', { name: 'Open settings' })
    fireEvent.click(invoker)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Close modal'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(document.activeElement).toBe(invoker)
  })

  /**
   * Regression risk: a modal opened from a row that the same action removes
   * would otherwise try to focus a detached node and drop the user on <body>.
   */
  it('falls back to the previously focused element when the invoker is gone', async () => {
    function Harness() {
      const [isOpen, setIsOpen] = React.useState(false)
      const [showInvoker, setShowInvoker] = React.useState(true)
      const invokerRef = React.useRef<HTMLButtonElement | null>(null)
      return (
        <>
          <button type="button" data-testid="anchor" onClick={() => setIsOpen(true)}>
            Anchor
          </button>
          {showInvoker && (
            <button ref={invokerRef} type="button">
              Row action
            </button>
          )}
          <AccessibleModal
            isOpen={isOpen}
            onClose={() => {
              setShowInvoker(false)
              setIsOpen(false)
            }}
            titleId="modal-title"
            title="Settings"
            invokingElementRef={invokerRef}
          >
            <button type="button">Inside</button>
          </AccessibleModal>
        </>
      )
    }
    render(<Harness />)

    const anchor = screen.getByTestId('anchor')
    anchor.focus()
    fireEvent.click(anchor)

    fireEvent.click(screen.getByLabelText('Close modal'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(document.activeElement).toBe(anchor)
  })
  it.each(['body', 'documentElement'] as const)(
    'uses the explicit heading fallback after Safari leaves %s active and the opener is removed',
    async (root) => {
      function Harness() {
        const [open, setOpen] = React.useState(false)
        const [showInvoker, setShowInvoker] = React.useState(true)
        const invoker = React.useRef<HTMLButtonElement | null>(null)
        return (
          <>
            <h2 id="community-heading" tabIndex={-1}>
              Community
            </h2>
            {showInvoker && (
              <button ref={invoker} onClick={() => setOpen(true)}>
                Share card
              </button>
            )}
            <AccessibleModal
              isOpen={open}
              onClose={() => setOpen(false)}
              titleId="fallback-title"
              title="Share card"
              invokingElementRef={invoker}
              fallbackFocusSelector="#community-heading"
            >
              <button onClick={() => setShowInvoker(false)}>Remove opener</button>
            </AccessibleModal>
          </>
        )
      }
      const element = document[root]
      const previous = element.getAttribute('tabindex')
      element.tabIndex = -1
      try {
        render(<Harness />)
        element.focus()
        expect(element).toHaveFocus()
        // fireEvent: Safari does not focus a clicked button, so focus stays where it was.
        fireEvent.click(screen.getByRole('button', { name: 'Share card' }))
        await userEvent.click(screen.getByRole('button', { name: 'Remove opener' }))
        await userEvent.click(screen.getByLabelText('Close modal'))
        await act(async () => {
          await Promise.resolve()
        })
        expect(screen.getByRole('heading', { name: 'Community' })).toHaveFocus()
      } finally {
        if (previous === null) element.removeAttribute('tabindex')
        else element.setAttribute('tabindex', previous)
      }
    }
  )
  it('uses the explicit heading after Safari focuses the source article and its child opener is detached', async () => {
    function Harness() {
      const [open, setOpen] = React.useState(false)
      const [showInvoker, setShowInvoker] = React.useState(true)
      const invoker = React.useRef<HTMLButtonElement | null>(null)
      return (
        <>
          <h2 id="community-fallback" tabIndex={-1}>
            Community heading
          </h2>
          <article id="lookbook-card-ownpost" tabIndex={-1}>
            {showInvoker && (
              <button ref={invoker} onClick={() => setOpen(true)}>
                Share card
              </button>
            )}
          </article>
          <AccessibleModal
            isOpen={open}
            onClose={() => setOpen(false)}
            titleId="article-share"
            title="Share card"
            invokingElementRef={invoker}
            fallbackFocusSelector="#community-fallback"
          >
            <button onClick={() => setShowInvoker(false)}>Remove child opener</button>
          </AccessibleModal>
        </>
      )
    }
    render(<Harness />)
    const article = screen.getByRole('article')
    article.focus()
    // fireEvent: Safari does not focus a clicked button, so the article keeps focus.
    fireEvent.click(screen.getByRole('button', { name: 'Share card' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove child opener' }))
    await userEvent.click(screen.getByLabelText('Close modal'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('heading', { name: 'Community heading' })).toHaveFocus()
    expect(article).not.toHaveFocus()
  })
  it.each(['inert', 'aria-hidden'] as const)(
    'rejects an explicit fallback inside an %s ancestor and preserves meaningful previous focus',
    async (hidden) => {
      function Harness() {
        const [open, setOpen] = React.useState(false)
        return (
          <>
            <div
              inert={hidden === 'inert'}
              aria-hidden={hidden === 'aria-hidden' ? true : undefined}
            >
              <h2 id="blocked-fallback" tabIndex={-1}>
                Blocked heading
              </h2>
            </div>
            <button onClick={() => setOpen(true)}>Previous anchor</button>
            <AccessibleModal
              isOpen={open}
              onClose={() => setOpen(false)}
              titleId="blocked-title"
              title="Dialog"
              fallbackFocusSelector="#blocked-fallback"
            >
              Content
            </AccessibleModal>
          </>
        )
      }
      render(<Harness />)
      const previous = screen.getByRole('button', { name: 'Previous anchor' })
      previous.focus()
      await userEvent.click(previous)
      await userEvent.click(screen.getByLabelText('Close modal'))
      await act(async () => {
        await Promise.resolve()
      })
      expect(previous).toHaveFocus()
    }
  )
  it('closing a nested modal rejects the inert page fallback and restores focus inside its parent', async () => {
    function Harness() {
      const [childOpen, setChildOpen] = React.useState(false)
      const [showInvoker, setShowInvoker] = React.useState(true)
      const childInvoker = React.useRef<HTMLButtonElement | null>(null)
      return (
        <>
          <h2 id="page-fallback" tabIndex={-1}>
            Page heading
          </h2>
          <AccessibleModal
            isOpen
            onClose={() => undefined}
            titleId="parent-title"
            title="Parent"
            closeLabel="Close parent"
          >
            <button>Parent anchor</button>
            {showInvoker && (
              <button ref={childInvoker} onClick={() => setChildOpen(true)}>
                Open child
              </button>
            )}
            <AccessibleModal
              isOpen={childOpen}
              onClose={() => setChildOpen(false)}
              titleId="child-title"
              title="Child"
              closeLabel="Close child"
              invokingElementRef={childInvoker}
              fallbackFocusSelector="#page-fallback"
            >
              <button onClick={() => setShowInvoker(false)}>Remove child invoker</button>
            </AccessibleModal>
          </AccessibleModal>
        </>
      )
    }
    render(<Harness />)
    const previous = screen.getByRole('button', { name: 'Parent anchor' })
    previous.focus()
    // fireEvent: Safari does not focus a clicked button, so Parent anchor keeps focus.
    fireEvent.click(screen.getByRole('button', { name: 'Open child' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove child invoker' }))
    await userEvent.click(screen.getByLabelText('Close child'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(previous).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'Parent' })).toBeInTheDocument()
  })
  it('L1: restores the heading after React removes the opener ancestor with its open dialog', async () => {
    function OwnedCard({ remove }: { remove: () => void }) {
      const invoker = React.useRef<HTMLButtonElement>(null)
      const [open, setOpen] = React.useState(false)
      return (
        <article>
          <button ref={invoker} onClick={() => setOpen(true)}>
            Owned card
          </button>
          <AccessibleModal
            isOpen={open}
            onClose={remove}
            titleId="removed-card-title"
            title="Share owned card"
            invokingElementRef={invoker}
            fallbackFocusSelector="#surviving-heading"
          >
            <button onClick={remove}>Remove owned card</button>
          </AccessibleModal>
        </article>
      )
    }
    function Harness() {
      const [show, setShow] = React.useState(true)
      return (
        <>
          <h2 id="surviving-heading" tabIndex={-1}>
            Community heading
          </h2>
          {show && <OwnedCard remove={() => setShow(false)} />}
        </>
      )
    }
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Owned card' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove owned card' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Community heading' })).toHaveFocus()
  })
})
