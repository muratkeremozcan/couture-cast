'use client'
// Story CC-7.11 D12, D13 owner: every overlay closes with X (or the back arrow of a full-height
// layer), Escape, a swipe down and browser or system back, and returns focus to its opener.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern

import React, { useContext, useEffect, useId, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { getI18n } from '../../i18n'
import {
  nextModalOrder,
  openLayerHistory,
  registerModal,
  useModalCovered,
  type LayerHistory,
} from './modal-stack'

/** D13: a downward drag this long closes the layer. */
export const LAYER_SWIPE_CLOSE_PX = 80

export interface AccessibleModalProps {
  isOpen: boolean
  suspended?: boolean
  onClose: () => void
  titleId: string
  title: string
  surface?: 'default' | 'theme'
  /**
   * Lays the surface out as a flex column, so a child with a min-height below its own
   * height (such as an image preview) gives up height before the surface scrolls.
   * Flex items keep both of two adjacent vertical margins, which block layout collapses.
   */
  columnLayout?: boolean
  descriptionId?: string
  description?: string
  invokingElementRef?: React.RefObject<HTMLElement | null>
  initialFocusRef?: React.RefObject<HTMLElement | null>
  /** Where focus goes when the invoker is gone: the first selector that still matches. */
  fallbackFocusSelector?: string | readonly string[]
  /** The last resort, tried after the element that was focused when the dialog opened. */
  finalFocusSelector?: string
  /** The close button's name; without one it reads the catalog's `shell.close`. */
  closeLabel?: string
  children: React.ReactNode
  ariaLiveMessage?: string | null
  errorMessage?: string | null
  /**
   * Story CC-7.11 D12: `screen` is a full-height layer under a top bar with a back arrow and the
   * title in place of the X (saved look and post detail); `dialog` is the centered card.
   */
  presentation?: 'dialog' | 'screen'
}

/**
 * The header and error colors per surface. A theme surface follows the lookbook theme (the
 * premium palette's light or dark variant, Story CC-7.9 D5); the default surface uses the page
 * roles. Both follow the system scheme through the `--cc-*` tokens.
 */
const SURFACE_PARTS = {
  default: {
    rule: 'border-line',
    description: 'text-ink-muted',
    error: 'border border-danger-line bg-danger-surface text-danger-ink',
    close: 'text-ink-muted hover:bg-card',
  },
  theme: {
    rule: 'border-theme-card-border',
    description: 'text-theme-card-text',
    error: 'border border-merlot-ink bg-page text-merlot-ink',
    close: 'text-theme-card-text hover:bg-ink/5',
  },
} as const

/** Only the top dialog dims the page; a full-height layer covers it with the page surface. */
function overlayClassName(screen: boolean, covered: boolean) {
  if (screen) return 'fixed inset-0 z-[60] flex bg-page'
  return `fixed inset-0 z-[60] flex items-center justify-center p-4 ${covered ? 'bg-transparent' : 'bg-scrim/60'}`
}

function panelClassName(
  screen: boolean,
  surface: 'default' | 'theme',
  columnLayout: boolean
) {
  if (!screen) return surfaceClassName(surface, columnLayout)
  const colors =
    surface === 'theme' ? 'bg-theme-card-bg text-theme-card-text' : 'bg-page text-ink'
  return `flex h-full w-full flex-col outline-none ${colors}`
}

function surfaceClassName(surface: 'default' | 'theme', columnLayout: boolean) {
  const layout = columnLayout ? ' flex flex-col' : ''
  const colors =
    surface === 'theme' ? 'bg-theme-card-bg text-theme-card-text' : 'bg-page text-ink'
  return `max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl p-6 shadow-overlay${layout} ${colors}`
}

/** Whether the element or an ancestor is inert or hidden from assistive technology. */
function isHiddenFromFocus(target: HTMLElement): boolean {
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
      return true
  return false
}

export function AccessibleModal({
  isOpen,
  suspended = false,
  onClose,
  titleId,
  title,
  surface = 'default',
  columnLayout = false,
  descriptionId,
  description,
  invokingElementRef,
  initialFocusRef,
  closeLabel,
  fallbackFocusSelector,
  finalFocusSelector,
  children,
  ariaLiveMessage,
  errorMessage,
  presentation = 'dialog',
}: AccessibleModalProps) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  // Null outside the app router (component tests), where links inside are left alone.
  const router = useContext(AppRouterContext)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const layerHistoryRef = useRef<LayerHistory | null>(null)
  const screen = presentation === 'screen'
  const swipe = useLayerSwipe(
    headerRef,
    // The element that scrolls: the body below the bar, or the whole dialog panel.
    () => (screen ? bodyRef.current : dialogRef.current)?.scrollTop ?? 0,
    () => onCloseRef.current()
  )
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const resumeFocusRef = useRef<HTMLElement | null>(null)
  const previousActiveElementRef = useRef<HTMLElement | null>(null)
  const focusGenerationRef = useRef({ value: 0 })
  // One string, so a caller passing a fresh array each render does not restart the effect.
  const fallbackSelectors = JSON.stringify(
    fallbackFocusSelector === undefined
      ? []
      : [fallbackFocusSelector].flat().filter(Boolean)
  )
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

  // D13, TEA P2: one same-URL history entry while the layer is open, so browser or system back
  // closes it; closing any other way consumes the entry, so history does not grow.
  useEffect(() => {
    if (!isOpen || suspended) return
    const layerHistory = openLayerHistory(() => onCloseRef.current())
    layerHistoryRef.current = layerHistory
    return () => {
      layerHistoryRef.current = null
      layerHistory.release()
    }
  }, [isOpen, suspended])

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
        const fallbacks = (JSON.parse(fallbackSelectors) as string[]).map((selector) =>
          document.querySelector<HTMLElement>(selector)
        )
        const final = finalFocusSelector
          ? document.querySelector<HTMLElement>(finalFocusSelector)
          : null
        // A candidate can be connected and visible yet unable to take focus, such as a
        // control disabled while the dialog was open. Each attempt is checked, and the
        // next candidate is tried when focus did not move to it.
        for (const target of [
          currentInvoker,
          ...fallbacks,
          previousActiveElementRef.current,
          final,
        ]) {
          if (!target?.isConnected || isHiddenFromFocus(target)) continue
          target.focus()
          if (document.activeElement === target) return
        }
      })
    }
  }, [
    initialFocusRef,
    isOpen,
    suspended,
    invokingElementRef,
    fallbackSelectors,
    finalFocusSelector,
  ])

  if (!isOpen || typeof document === 'undefined') {
    return null
  }

  /**
   * TEA P2: a link inside the layer that leads to another route replaces the layer's entry, so
   * one browser back returns to the parent with the layer closed.
   */
  const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    const destination = router ? layerLinkDestination(event, dialogRef.current) : null
    if (!router || destination === null) return
    event.preventDefault()
    event.stopPropagation()
    layerHistoryRef.current?.handOff()
    router.replace(destination)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // React bubbles events across portals, even though a nested modal owns its own DOM.
    if (event.key !== 'Tab' || !event.currentTarget.contains(event.target as Node)) return

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

    if (first === last) {
      event.preventDefault()
      first.focus()
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

  const parts = SURFACE_PARTS[surface]
  const liveAndError = (
    <LiveAndError
      ariaLiveMessage={ariaLiveMessage}
      errorMessage={errorMessage}
      errorClass={parts.error}
    />
  )

  return createPortal(
    <div
      role="dialog"
      data-modal-overlay=""
      data-presentation={presentation}
      aria-modal={!suspended}
      aria-hidden={suspended || covered || undefined}
      inert={suspended || covered}
      style={suspended ? { display: 'none' } : undefined}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={handleKeyDown}
      onClickCapture={handleClickCapture}
      // Only the top dialog dims the page; a covered one keeps its place without
      // stacking a second scrim over the first. A full-height layer covers the page.
      className={overlayClassName(screen, covered)}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        {...swipe}
        className={panelClassName(screen, surface, columnLayout)}
        // A dialog scrolls as one panel; a full-height layer scrolls its body below the bar.
        data-testid={screen ? undefined : 'layer-body'}
      >
        {screen ? (
          <>
            <LayerTopBar
              headerRef={headerRef}
              backRef={closeButtonRef}
              rule={parts.rule}
              titleId={titleId}
              title={title}
              backLabel={t('shell.back')}
              onBack={onClose}
            />
            <div
              ref={bodyRef}
              data-testid="layer-body"
              className="min-h-0 w-full flex-1 overflow-y-auto"
            >
              <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-4">
                {description && (
                  <p id={descriptionId} className={`text-xs ${parts.description}`}>
                    {description}
                  </p>
                )}
                {liveAndError}
                {children}
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader
              headerRef={headerRef}
              closeRef={closeButtonRef}
              parts={parts}
              titleId={titleId}
              title={title}
              descriptionId={descriptionId}
              description={description}
              closeLabel={closeLabel ?? t('shell.close')}
              onClose={onClose}
            />
            {liveAndError}
            {children}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

/** The other route a click inside the layer leads to, or null for anything else. */
function layerLinkDestination(
  event: React.MouseEvent<HTMLDivElement>,
  dialog: HTMLElement | null
): string | null {
  if (event.defaultPrevented || event.button !== 0) return null
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null
  const anchor = (event.target as Element).closest?.('a[href]')
  if (!(anchor instanceof HTMLAnchorElement) || !dialog?.contains(anchor)) return null
  if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download'))
    return null
  const destination = new URL(anchor.href, window.location.href)
  const here = new URL(window.location.href)
  if (destination.origin !== here.origin) return null
  if (destination.pathname === here.pathname && destination.search === here.search)
    return null
  return `${destination.pathname}${destination.search}${destination.hash}`
}

/**
 * D13, TEA P3: a touch or pen drag of 80 px or more downward closes the layer when it starts in
 * the header, or anywhere while the scrolling element is at its top. Horizontal and upward drags
 * never close.
 */
function useLayerSwipe(
  headerRef: React.RefObject<HTMLElement | null>,
  scrollTop: () => number,
  close: () => void
) {
  const swipeRef = useRef<{ id: number; x: number; y: number; header: boolean } | null>(
    null
  )
  const end = () => {
    swipeRef.current = null
  }
  return {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
      const header = headerRef.current?.contains(event.target as Node) ?? false
      if (!header && scrollTop() > 0) return
      swipeRef.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        header,
      }
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      const swipe = swipeRef.current
      if (!swipe || swipe.id !== event.pointerId) return
      if (!swipe.header && scrollTop() > 0) {
        end()
        return
      }
      const down = event.clientY - swipe.y
      if (down >= LAYER_SWIPE_CLOSE_PX && down > Math.abs(event.clientX - swipe.x)) {
        end()
        close()
      }
    },
    onPointerUp: end,
    onPointerCancel: end,
  }
}

function BackGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

/**
 * D12: a full-height layer's header is the top bar, back arrow and title in place of the X. It
 * is also the swipe handle: `touch-none` keeps the browser from panning, so the drag reaches us.
 */
function LayerTopBar({
  headerRef,
  backRef,
  rule,
  titleId,
  title,
  backLabel,
  onBack,
}: {
  headerRef: React.RefObject<HTMLDivElement | null>
  backRef: React.RefObject<HTMLButtonElement | null>
  rule: string
  titleId: string
  title: string
  backLabel: string
  onBack: () => void
}) {
  return (
    <div
      ref={headerRef}
      data-testid="layer-swipe-handle"
      className={`h-top-bar w-full shrink-0 touch-none border-b ${rule}`}
    >
      <div
        data-testid="app-top-bar"
        className="mx-auto flex h-full max-w-6xl items-center gap-2 px-4"
      >
        <button
          ref={backRef}
          type="button"
          data-testid="app-top-bar-back"
          onClick={onBack}
          className="flex min-h-touch min-w-touch shrink-0 items-center gap-1 rounded-md px-2 text-sm font-medium"
        >
          <BackGlyph />
          <span>{backLabel}</span>
        </button>
        <h2
          id={titleId}
          data-testid="app-top-bar-title"
          className="min-w-0 flex-1 truncate text-lg font-semibold"
        >
          {title}
        </h2>
      </div>
    </div>
  )
}

/** A dialog's title row with its X; the row is the swipe handle too. */
function DialogHeader({
  headerRef,
  closeRef,
  parts,
  titleId,
  title,
  descriptionId,
  description,
  closeLabel,
  onClose,
}: {
  headerRef: React.RefObject<HTMLDivElement | null>
  closeRef: React.RefObject<HTMLButtonElement | null>
  parts: (typeof SURFACE_PARTS)[keyof typeof SURFACE_PARTS]
  titleId: string
  title: string
  descriptionId?: string
  description?: string
  closeLabel: string
  onClose: () => void
}) {
  return (
    <div
      ref={headerRef}
      data-testid="layer-swipe-handle"
      className={`flex touch-none items-center justify-between border-b pb-3 ${parts.rule}`}
    >
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <h2 id={titleId} className="text-xl font-bold">
          {title}
        </h2>
        {description && (
          <p id={descriptionId} className={`mt-1 text-xs ${parts.description}`}>
            {description}
          </p>
        )}
      </div>
      <button
        ref={closeRef}
        onClick={onClose}
        className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg ${parts.close}`}
        aria-label={closeLabel}
      >
        ✕
      </button>
    </div>
  )
}

function LiveAndError({
  ariaLiveMessage,
  errorMessage,
  errorClass,
}: {
  ariaLiveMessage?: string | null
  errorMessage?: string | null
  errorClass: string
}) {
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {ariaLiveMessage ?? ''}
      </div>

      {errorMessage && (
        <div
          role="alert"
          aria-live="assertive"
          className={`mt-4 rounded-md p-3 text-sm font-medium ${errorClass}`}
        >
          {errorMessage}
        </div>
      )}
    </>
  )
}
