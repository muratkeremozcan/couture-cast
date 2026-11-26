'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  clampStatusBarActions,
  createAnnouncementToken,
  createStatusBarNotice,
  type StatusBarNotice,
  type StatusBarNoticeInput,
} from '@couture/utils'
import { getI18n } from '../../../i18n'

export interface AnnouncementEntry {
  id: string
  message: string
  urgency: 'polite' | 'assertive'
}

export interface RectLike {
  top: number
  bottom: number
  left: number
  right: number
  width: number
  height: number
}

export function rectsOverlap(a: RectLike, b: RectLike): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) {
    return false
  }
  return !(
    a.right <= b.left ||
    a.left >= b.right ||
    a.bottom <= b.top ||
    a.top >= b.bottom
  )
}

export function computeNonOverlappingBottomOffset(options: {
  barRect: RectLike
  obstacles: readonly RectLike[]
  viewportHeight: number
  baseBottomPx: number
  gapPx?: number
}): number {
  const { barRect, obstacles, viewportHeight, baseBottomPx, gapPx = 12 } = options
  if (barRect.height <= 0 || viewportHeight <= 0) {
    return baseBottomPx
  }
  let bottomPx = baseBottomPx
  for (let pass = 0; pass < obstacles.length + 1; pass += 1) {
    const top = viewportHeight - bottomPx - barRect.height
    const bottom = viewportHeight - bottomPx
    const projected: RectLike = {
      left: barRect.left,
      right: barRect.right,
      width: barRect.width,
      height: barRect.height,
      top,
      bottom,
    }
    const blocking = obstacles.find((obstacle) => rectsOverlap(projected, obstacle))
    if (!blocking) {
      break
    }
    const nextBottom = Math.ceil(viewportHeight - blocking.top + gapPx)
    if (nextBottom <= bottomPx) {
      break
    }
    bottomPx = nextBottom
  }
  return bottomPx
}

interface SaveFeedbackContextValue {
  isOnline: boolean
  notice: StatusBarNotice | null
  showNotice: (
    input: StatusBarNoticeInput,
    options?: { skipAnnounce?: boolean }
  ) => StatusBarNotice
  dismissNotice: (noticeId?: string) => void
  announce: (
    message: string,
    options: { announcementId: string; urgency?: 'polite' | 'assertive' }
  ) => void
}

const SaveFeedbackContext = createContext<SaveFeedbackContextValue | null>(null)

function readNavigatorOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

export function useOnlineStatus(): boolean {
  const ctx = useContext(SaveFeedbackContext)
  const [standaloneOnline, setStandaloneOnline] = useState(true)

  useEffect(() => {
    if (ctx) return
    setStandaloneOnline(readNavigatorOnline())
    const handleOnline = () => setStandaloneOnline(true)
    const handleOffline = () => setStandaloneOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [ctx])

  return ctx ? ctx.isOnline : standaloneOnline
}

export function useStatusBar() {
  const ctx = useContext(SaveFeedbackContext)
  const isOnline = useOnlineStatus()
  if (ctx) {
    return {
      ...ctx,
      hasProvider: true,
    }
  }
  return {
    isOnline,
    notice: null as StatusBarNotice | null,
    showNotice: (input: StatusBarNoticeInput) => createStatusBarNotice(input),
    dismissNotice: () => undefined,
    announce: () => undefined,
    hasProvider: false,
  }
}

/**
 * Story CC-7.9 D2, D3: the bar is an inverse surface (dark on a light page, light on a dark
 * one); errors use the danger fill and offline the notice roles. No tone paints gold.
 */
const TONE_CLASSES: Record<StatusBarNotice['tone'], string> = {
  neutral: 'border-inverse bg-inverse text-on-inverse',
  success: 'border-success-ink bg-inverse text-on-inverse',
  error: 'border-danger bg-danger text-on-danger',
  offline: 'border-notice-line bg-notice-surface text-notice-ink',
}

const ACTION_CLASSES: Record<StatusBarNotice['tone'], string> = {
  neutral: 'text-on-inverse underline hover:bg-on-inverse/10',
  success: 'text-on-inverse underline hover:bg-on-inverse/10',
  error: 'text-on-danger underline hover:bg-on-danger/15',
  offline: 'text-notice-ink underline hover:bg-notice-ink/10',
}

export function OfflineStatusLine({
  online,
  inline = false,
  className = '',
}: {
  online?: boolean
  inline?: boolean
  className?: string
}) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const currentOnline = useOnlineStatus()
  const isOnline = online ?? currentOnline
  const [headerOffset, setHeaderOffset] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (inline || isOnline || typeof document === 'undefined') {
      setHeaderOffset(null)
      return
    }
    const measure = () => {
      const header = document.querySelector<HTMLElement>('header, [role="banner"]')
      if (!header) {
        setHeaderOffset(null)
        return
      }
      const rect = header.getBoundingClientRect()
      if (rect.height > 0 && rect.bottom > 0) {
        setHeaderOffset(Math.ceil(rect.bottom))
      } else {
        setHeaderOffset(null)
      }
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, { passive: true })
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure)
    }
  }, [inline, isOnline])

  if (isOnline) return null

  const positionClass = inline
    ? 'mb-3 rounded-lg border'
    : headerOffset !== null
      ? 'fixed left-0 right-0 z-30 border-b'
      : 'sticky top-0 z-30 border-b'

  return (
    <div
      data-testid="offline-status-line"
      data-offline="true"
      style={!inline && headerOffset !== null ? { top: `${headerOffset}px` } : undefined}
      className={`${positionClass} w-full border-notice-line bg-notice-surface px-4 py-2 text-center text-xs font-semibold text-notice-ink transition-opacity duration-150 motion-reduce:transition-none ${className}`.trim()}
    >
      {t('feedback.offlineBanner')}
    </div>
  )
}

export function StatusFeedbackBar({
  notice,
  onDismiss,
  placement = 'floating',
}: {
  notice: StatusBarNotice | null
  onDismiss: (noticeId?: string) => void
  placement?: 'floating' | 'inline'
}) {
  const barRef = useRef<HTMLDivElement | null>(null)
  const [bottomPx, setBottomPx] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!notice || placement !== 'floating') {
      setBottomPx(null)
      return
    }
    const measure = () => {
      const bar = barRef.current
      if (!bar || typeof window === 'undefined') return
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight
      if (!viewportHeight) return

      const barRect = bar.getBoundingClientRect()
      const obstacles: RectLike[] = []
      const nav = document.querySelector<HTMLElement>('[data-testid="sticky-bottom-nav"]')
      if (nav) {
        const navRect = nav.getBoundingClientRect()
        if (navRect.height > 0 && navRect.width > 0) {
          obstacles.push(navRect)
        }
      }
      const primaryButtons = document.querySelectorAll<HTMLElement>(
        '[data-primary-action="true"]'
      )
      primaryButtons.forEach((button) => {
        if (bar.contains(button)) return
        const rect = button.getBoundingClientRect()
        if (rect.height > 0 && rect.width > 0) {
          obstacles.push(rect)
        }
      })

      if (obstacles.length === 0) {
        setBottomPx(null)
        return
      }

      const isPhoneViewport = (window.innerWidth || 1024) < 768
      const baseBottomPx = isPhoneViewport ? 72 : 16
      const next = computeNonOverlappingBottomOffset({
        barRect,
        obstacles,
        viewportHeight,
        baseBottomPx,
      })
      setBottomPx((current) => (current === next ? current : next))
    }

    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, { passive: true })
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure)
    }
  }, [notice, placement])

  if (!notice) return null

  const actions = clampStatusBarActions(notice.actions)
  const placementClasses =
    placement === 'inline'
      ? 'sticky bottom-0 z-10 mt-3 w-full'
      : 'fixed left-1/2 z-40 w-[min(calc(100%-2rem),28rem)] -translate-x-1/2 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] min-[768px]:bottom-4'

  return (
    <div
      ref={barRef}
      data-testid="status-feedback-bar"
      data-tone={notice.tone}
      data-placement={placement}
      style={
        placement === 'floating' && bottomPx !== null
          ? { bottom: `${bottomPx}px` }
          : undefined
      }
      className={`${placementClasses} flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2 shadow-overlay transition-opacity duration-150 motion-reduce:transition-none ${TONE_CLASSES[notice.tone]}`}
    >
      <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{notice.message}</p>
      {actions.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              data-testid={`status-bar-action-${action.kind ?? action.id}`}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none ${ACTION_CLASSES[notice.tone]}`}
              onClick={() => {
                const activeId = notice.id
                const result = action.onPress()
                if (result && typeof result.then === 'function') {
                  void result.catch(() => undefined).finally(() => onDismiss(activeId))
                } else {
                  onDismiss(activeId)
                }
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function SaveFeedbackProvider({
  children,
  inline = false,
  renderOfflineLine = !inline,
  initialOnline,
  onAnnounce,
}: {
  children: ReactNode
  inline?: boolean
  renderOfflineLine?: boolean
  initialOnline?: boolean
  onAnnounce?: (entry: AnnouncementEntry) => void
}) {
  const parent = useContext(SaveFeedbackContext)
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const [localOnline, setLocalOnline] = useState(initialOnline ?? true)
  const [notice, setNotice] = useState<StatusBarNotice | null>(null)
  const [announcement, setAnnouncement] = useState<AnnouncementEntry>({
    id: '',
    message: '',
    urgency: 'polite',
  })

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const announcedIdsRef = useRef<Set<string>>(new Set())
  const offlineSequenceRef = useRef(0)
  const prevOnlineRef = useRef<boolean | null>(null)
  const onAnnounceRef = useRef(onAnnounce)
  onAnnounceRef.current = onAnnounce

  const isOnline =
    initialOnline !== undefined ? localOnline : parent ? parent.isOnline : localOnline

  useEffect(() => {
    if (initialOnline !== undefined) {
      setLocalOnline(initialOnline)
      return
    }
    if (parent) return
    setLocalOnline(readNavigatorOnline())
    const handleOnline = () => setLocalOnline(true)
    const handleOffline = () => setLocalOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [initialOnline, parent])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => clearTimer, [clearTimer])

  const localAnnounce = useCallback(
    (
      message: string,
      options: { announcementId: string; urgency?: 'polite' | 'assertive' }
    ) => {
      const trimmed = message.trim()
      if (!trimmed) return
      if (announcedIdsRef.current.has(options.announcementId)) return
      if (announcedIdsRef.current.size > 200) {
        announcedIdsRef.current.clear()
      }
      announcedIdsRef.current.add(options.announcementId)
      const entry: AnnouncementEntry = {
        id: options.announcementId,
        message: trimmed,
        urgency: options.urgency ?? 'polite',
      }
      setAnnouncement(entry)
      onAnnounceRef.current?.(entry)
    },
    []
  )

  // An inline provider (e.g., inside AccessibleModal) owns its own live region because
  // modal-stack sets inert + aria-hidden on document.body siblings outside the modal.
  const forwardAnnounceToParent = Boolean(parent) && !inline

  const announce = useCallback(
    (
      message: string,
      options: { announcementId: string; urgency?: 'polite' | 'assertive' }
    ) => {
      if (forwardAnnounceToParent && parent) {
        parent.announce(message, options)
        return
      }
      localAnnounce(message, options)
    },
    [forwardAnnounceToParent, localAnnounce, parent]
  )

  useEffect(() => {
    if (forwardAnnounceToParent && initialOnline === undefined) return
    const previous = prevOnlineRef.current
    prevOnlineRef.current = isOnline
    if (!isOnline && previous !== false) {
      offlineSequenceRef.current += 1
      announce(t('feedback.offlineBanner'), {
        announcementId: createAnnouncementToken(
          'offline-banner',
          offlineSequenceRef.current
        ),
        urgency: 'assertive',
      })
    }
  }, [announce, forwardAnnounceToParent, initialOnline, isOnline, t])

  const dismissNotice = useCallback(
    (noticeId?: string) => {
      setNotice((current) => {
        if (!current) return null
        if (noticeId !== undefined && current.id !== noticeId) return current
        clearTimer()
        return null
      })
    },
    [clearTimer]
  )

  const showNotice = useCallback(
    (input: StatusBarNoticeInput, options?: { skipAnnounce?: boolean }) => {
      const normalized = createStatusBarNotice(input)
      clearTimer()
      setNotice(normalized)
      timerRef.current = setTimeout(() => {
        setNotice((current) => (current?.id === normalized.id ? null : current))
        timerRef.current = null
      }, normalized.durationMs)
      if (!options?.skipAnnounce) {
        announce(normalized.message, {
          announcementId: normalized.announcementId,
          urgency: normalized.urgency,
        })
      }
      return normalized
    },
    [announce, clearTimer]
  )

  const value = useMemo<SaveFeedbackContextValue>(
    () => ({
      isOnline,
      notice,
      showNotice,
      dismissNotice,
      announce,
    }),
    [announce, dismissNotice, isOnline, notice, showNotice]
  )

  return (
    <SaveFeedbackContext.Provider value={value}>
      {renderOfflineLine && <OfflineStatusLine online={isOnline} inline={inline} />}
      {children}
      <StatusFeedbackBar
        notice={notice}
        onDismiss={dismissNotice}
        placement={inline ? 'inline' : 'floating'}
      />
      {!forwardAnnounceToParent && (
        <div
          data-testid="save-feedback-announcer"
          aria-live={announcement.urgency}
          aria-atomic="true"
          className="sr-only"
        >
          {announcement.message ? (
            <span key={announcement.id}>{announcement.message}</span>
          ) : null}
        </div>
      )}
    </SaveFeedbackContext.Provider>
  )
}
