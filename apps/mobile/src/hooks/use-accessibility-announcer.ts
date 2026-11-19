// Story 3.8 Task 4 step 1 owner: implement native mobile accessibility announcer hook in `apps/mobile/src/hooks/use-accessibility-announcer.ts`
import {
  createElement,
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { AccessibilityInfo, Platform, StyleSheet, Text } from 'react-native'
import {
  getAnnouncementUrgency,
  type AccessibilityAnnouncementEvent,
} from '@couture/utils'
import { subscribeMobileApplicationUser } from '@/src/lib/mobile-auth'

export interface AnnounceOptions {
  /**
   * False once the announcement no longer belongs to whoever is signed in (or its screen is
   * gone). Checked again when the queued announcement is delivered, so a member's place is never
   * read out after another member took over.
   */
  stillCurrent?: () => boolean
}

type Announce = (
  event: AccessibilityAnnouncementEvent,
  details: string,
  options?: AnnounceOptions
) => void

interface PendingAnnouncement {
  message: string
  urgency: 'polite' | 'assertive'
  stillCurrent?: () => boolean
}

interface RenderedAnnouncement {
  message: string
  urgency: 'polite' | 'assertive'
  id: number
  /** Belongs to the signed-in member (it was announced with `stillCurrent`). */
  memberOwned: boolean
}

const AccessibilityAnnouncerContext = createContext<Announce | null>(null)

export function AccessibilityAnnouncerProvider({ children }: PropsWithChildren) {
  const { t } = useTranslation()
  const [rendered, setRendered] = useState<RenderedAnnouncement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<PendingAnnouncement | null>(null)
  const lastMessageRef = useRef('')
  const announcementIdRef = useRef(0)

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    },
    []
  )

  // A change of member (sign-out included) takes the last member's announcements with it: the
  // queued one, the one still in the live region, and the memory used to skip repeats.
  useEffect(
    () =>
      subscribeMobileApplicationUser(() => {
        if (pendingRef.current?.stillCurrent) {
          pendingRef.current = null
          if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
          }
        }
        lastMessageRef.current = ''
        setRendered((current) => (current?.memberOwned ? null : current))
      }),
    []
  )

  const announce = useCallback<Announce>(
    (event, details, options) => {
      const cleanDetails = details.trim()
      const localized = (() => {
        switch (event) {
          case 'refresh':
          case 'swap': {
            const prefix = t(`accessibility.live_announcement_${event}`)
            return cleanDetails ? `${prefix}: ${cleanDetails}` : prefix
          }
          case 'chip_change':
            return t('accessibility.live_announcement_chip_change', {
              chip: cleanDetails,
            })
          case 'alert':
            return t('accessibility.live_announcement_alert', {
              alert: cleanDetails,
            })
          case 'feedback':
          case 'error':
            return cleanDetails
          default: {
            const _exhaustiveCheck: never = event
            void _exhaustiveCheck
            return cleanDetails
          }
        }
      })()
      const next: PendingAnnouncement = {
        message: localized.trim(),
        urgency: getAnnouncementUrgency(event),
        stillCurrent: options?.stillCurrent,
      }
      if (next.stillCurrent && !next.stillCurrent()) return

      if (!next.message || next.message === lastMessageRef.current) {
        return
      }

      if (pendingRef.current?.urgency === 'assertive' && next.urgency === 'polite') {
        return
      }
      pendingRef.current = next

      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(() => {
        const pending = pendingRef.current
        pendingRef.current = null
        timerRef.current = null
        if (!pending || pending.message === lastMessageRef.current) {
          return
        }
        if (pending.stillCurrent && !pending.stillCurrent()) return

        lastMessageRef.current = pending.message
        announcementIdRef.current += 1
        setRendered({
          message: pending.message,
          urgency: pending.urgency,
          id: announcementIdRef.current,
          memberOwned: Boolean(pending.stillCurrent),
        })

        if (Platform.OS === 'web') {
          return
        }
        if (
          Platform.OS === 'ios' &&
          typeof AccessibilityInfo.announceForAccessibilityWithOptions === 'function'
        ) {
          AccessibilityInfo.announceForAccessibilityWithOptions(pending.message, {
            queue: pending.urgency === 'polite',
          })
          return
        }
        AccessibilityInfo.announceForAccessibility(pending.message)
      }, 80)
    },
    [t]
  )

  const liveRegion =
    Platform.OS === 'web' && rendered
      ? createElement(
          Text,
          {
            key: rendered.id,
            nativeID: 'a11y-live-announcer',
            accessibilityLiveRegion: rendered.urgency,
            style: styles.visuallyHidden,
          },
          rendered.message
        )
      : null

  return createElement(
    AccessibilityAnnouncerContext.Provider,
    { value: announce },
    children,
    liveRegion
  )
}

export function useAccessibilityAnnouncer() {
  const announce = useContext(AccessibilityAnnouncerContext)
  return { announce: announce ?? noopAnnounce }
}

const noopAnnounce: Announce = () => undefined

const styles = StyleSheet.create({
  visuallyHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
})
