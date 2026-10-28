'use client'

import React, { useId, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { nextModalOrder, registerModal, useModalCovered } from './modal-stack'

export interface AccessibleModalProps {
  isOpen: boolean
  suspended?: boolean
  onClose: () => void
  titleId: string
  title: string
  surface?: 'default' | 'theme'
  descriptionId?: string
  description?: string
  invokingElementRef?: React.RefObject<HTMLElement | null>
  initialFocusRef?: React.RefObject<HTMLElement | null>
  fallbackFocusSelector?: string
  closeLabel?: string
  children: React.ReactNode
  ariaLiveMessage?: string | null
  errorMessage?: string | null
}

export function AccessibleModal({
  isOpen,
  suspended = false,
  onClose,
  titleId,
  title,
  surface = 'default',
  descriptionId,
  description,
  invokingElementRef,
  initialFocusRef,
  closeLabel = 'Close modal',
  fallbackFocusSelector,
  children,
  ariaLiveMessage,
  errorMessage,
}: AccessibleModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const resumeFocusRef = useRef<HTMLElement | null>(null)
  const previousActiveElementRef = useRef<HTMLElement | null>(null)
  const focusGenerationRef = useRef({ value: 0 })
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // The page-level state every open dialog shares (background inertness, scroll lock,
  // which dialog Escape closes) belongs to the modal stack. A dialog keeps its open
  // order while suspended, so dialogs that resume together keep their relative order.
  const id = useId()
  const openOrderRef = useRef<number | null>(null)
  const covered = useModalCovered(id)
  useLayoutEffect(() => {
    if (!isOpen) openOrderRef.current = null
  }, [isOpen])
  useLayoutEffect(() => {
    if (!isOpen || suspended) return
    openOrderRef.current ??= nextModalOrder()
    return registerModal({
      id,
      order: openOrderRef.current,
      close: () => onCloseRef.current(),
    })
  }, [id, isOpen, suspended])

  useLayoutEffect(() => {
    if (!isOpen || suspended) {
      return
    }
    const focusGeneration = focusGenerationRef.current
    focusGeneration.value++
    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body &&
      document.activeElement !== document.documentElement
        ? document.activeElement
        : null

    const dialog = dialogRef.current

    // Establish modal focus before paint so a user action cannot race delayed focus setup.
    const resume = resumeFocusRef.current?.isConnected ? resumeFocusRef.current : null
    ;(resume ?? initialFocusRef?.current ?? closeButtonRef.current)?.focus()
    const currentInvoker = invokingElementRef?.current

    return () => {
      const focused = document.activeElement
      if (focused instanceof HTMLElement && dialog?.contains(focused))
        resumeFocusRef.current = focused

      const restoreGeneration = ++focusGeneration.value
      // React detaches a deleted ancestor after its descendant layout cleanups.
      // Resolve the target after that commit, including its final inert ancestry.
      queueMicrotask(() => {
        if (focusGeneration.value !== restoreGeneration) return
        const fallback = fallbackFocusSelector
          ? document.querySelector<HTMLElement>(fallbackFocusSelector)
          : null
        const targetToFocus = [
          currentInvoker,
          fallback,
          previousActiveElementRef.current,
        ].find((target) => {
          if (!target?.isConnected) return false
          for (
            let ancestor: HTMLElement | null = target;
            ancestor;
            ancestor = ancestor.parentElement
          )
            if (
              ancestor.inert ||
              ancestor.hasAttribute('inert') ||
              ancestor.getAttribute('aria-hidden') === 'true'
            )
              return false
          return true
        })
        targetToFocus?.focus()
      })
    }
  }, [initialFocusRef, isOpen, suspended, invokingElementRef, fallbackFocusSelector])

  if (!isOpen || typeof document === 'undefined') {
    return null
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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

  return createPortal(
    <div
      role="dialog"
      data-modal-overlay=""
      aria-modal={!suspended}
      aria-hidden={suspended || covered || undefined}
      inert={suspended || covered}
      style={suspended ? { display: 'none' } : undefined}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={handleKeyDown}
      // Only the top dialog dims the page; a covered one keeps its place without
      // stacking a second scrim over the first.
      className={`fixed inset-0 z-[60] flex items-center justify-center p-4 ${covered ? 'bg-transparent' : 'bg-black/60'}`}
    >
      <div
        ref={dialogRef}
        data-focus-surface={surface === 'theme' ? 'light' : undefined}
        tabIndex={-1}
        className={`max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl p-6 shadow-2xl ${surface === 'theme' ? 'bg-[var(--theme-card-bg)] text-[color:var(--theme-card-text)]' : 'bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100'}`}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <div>
            <h2 id={titleId} className="text-xl font-bold">
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
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg ${surface === 'theme' ? 'text-[color:var(--theme-card-text)] hover:bg-black/5' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
            aria-label={closeLabel}
          >
            ✕
          </button>
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {ariaLiveMessage ?? ''}
        </div>

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
    </div>,
    document.body
  )
}
