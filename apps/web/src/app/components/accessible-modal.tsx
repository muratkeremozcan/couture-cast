'use client'

import React, { useLayoutEffect, useRef } from 'react'

export interface AccessibleModalProps {
  isOpen: boolean
  onClose: () => void
  titleId: string
  title: string
  descriptionId?: string
  description?: string
  invokingElementRef?: React.RefObject<HTMLElement | null>
  initialFocusRef?: React.RefObject<HTMLElement | null>
  closeLabel?: string
  children: React.ReactNode
  ariaLiveMessage?: string | null
  errorMessage?: string | null
}

export function AccessibleModal({
  isOpen,
  onClose,
  titleId,
  title,
  descriptionId,
  description,
  invokingElementRef,
  initialFocusRef,
  closeLabel = 'Close modal',
  children,
  ariaLiveMessage,
  errorMessage,
}: AccessibleModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const previousActiveElementRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    if (!isOpen) {
      return
    }
    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    // Lock body scroll
    const originalStyle = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const appShell = document.querySelector<HTMLElement>('[data-app-shell]')
    const wasInert = appShell?.inert ?? false
    const priorAriaHidden = appShell?.getAttribute('aria-hidden')
    if (appShell) {
      appShell.inert = true
      appShell.setAttribute('aria-hidden', 'true')
    }

    // Establish modal focus before paint so a user action cannot race delayed focus setup.
    ;(initialFocusRef?.current ?? closeButtonRef.current)?.focus()

    const invokingElement = invokingElementRef?.current
    return () => {
      document.body.style.overflow = originalStyle
      if (appShell) {
        appShell.inert = wasInert
        if (priorAriaHidden === null || priorAriaHidden === undefined) {
          appShell.removeAttribute('aria-hidden')
        } else {
          appShell.setAttribute('aria-hidden', priorAriaHidden)
        }
      }

      // Restore focus to invoking element or previous active element
      const targetToFocus = invokingElement ?? previousActiveElementRef.current
      targetToFocus?.focus()
    }
  }, [initialFocusRef, isOpen, invokingElementRef])

  if (!isOpen) {
    return null
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }

    if (event.key !== 'Tab') {
      return
    }

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter(
      (element) =>
        element.getAttribute('aria-hidden') !== 'true' &&
        !element.classList.contains('hidden')
    )

    const first = focusable[0]
    const last = focusable.at(-1)

    if (!first || !last) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <div>
            <h2
              id={titleId}
              className="text-xl font-bold text-zinc-900 dark:text-zinc-50"
            >
              {title}
            </h2>
            {description && (
              <p
                id={descriptionId}
                className="mt-1 text-xs text-zinc-500 dark:text-zinc-400"
              >
                {description}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={closeLabel}
          >
            ✕
          </button>
        </div>

        {ariaLiveMessage && (
          <div role="status" aria-live="polite" className="sr-only">
            {ariaLiveMessage}
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            aria-live="assertive"
            className="mt-4 rounded-md bg-red-50 p-3 text-sm font-medium text-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {errorMessage}
          </div>
        )}

        {children}
      </div>
    </div>
  )
}
