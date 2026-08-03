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

type Announce = (event: AccessibilityAnnouncementEvent, details: string) => void

interface PendingAnnouncement {
  message: string
  urgency: 'polite' | 'assertive'
}

interface RenderedAnnouncement extends PendingAnnouncement {
  id: number
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

  const announce = useCallback<Announce>(
    (event, details) => {
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
      const next = { message: localized.trim(), urgency: getAnnouncementUrgency(event) }

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

        lastMessageRef.current = pending.message
        announcementIdRef.current += 1
        setRendered({ ...pending, id: announcementIdRef.current })

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
