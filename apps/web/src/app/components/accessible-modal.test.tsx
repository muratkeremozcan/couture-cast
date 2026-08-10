import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
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

  it('renders the live region only when there is something to announce', () => {
    const { rerender } = renderModal()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

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

    expect(screen.getByRole('status')).toHaveTextContent('Saving changes. Please wait.')
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

  it('returns focus to the invoking element on close', () => {
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

    expect(document.activeElement).toBe(invoker)
  })

  /**
   * Regression risk: a modal opened from a row that the same action removes
   * would otherwise try to focus a detached node and drop the user on <body>.
   */
  it('falls back to the previously focused element when the invoker is gone', () => {
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

    expect(document.activeElement).toBe(anchor)
  })
})
