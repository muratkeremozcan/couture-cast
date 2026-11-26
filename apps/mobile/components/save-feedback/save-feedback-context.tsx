import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  clampStatusBarActions,
  createAnnouncementToken,
  createStatusBarNotice,
  type StatusBarNotice,
  type StatusBarNoticeInput,
} from '@couture/utils'
import { useSchemeColors } from '@/components/themed'
import { useReducedMotion } from '@/src/hooks/use-reduced-motion'
import { useNetworkOnline } from './network-status'

export const DEFAULT_MOBILE_TAB_BAR_HEIGHT = 56
export const MOBILE_STATUS_BAR_GAP = 12
export const MOBILE_TAB_BAR_CLEARANCE =
  DEFAULT_MOBILE_TAB_BAR_HEIGHT + MOBILE_STATUS_BAR_GAP

export interface AnnouncementEntry {
  id: string
  message: string
  urgency: 'polite' | 'assertive'
}

type NumberListener = (value: number) => void

let currentTabBarHeight = DEFAULT_MOBILE_TAB_BAR_HEIGHT
const tabBarHeightListeners = new Set<NumberListener>()

export function getMobileTabBarHeight(): number {
  return currentTabBarHeight
}

export function setMobileTabBarHeight(height: number): void {
  const normalized = Number.isFinite(height) && height >= 0 ? height : 0
  if (currentTabBarHeight === normalized) return
  currentTabBarHeight = normalized
  tabBarHeightListeners.forEach((listener) => listener(currentTabBarHeight))
}

export function resetMobileTabBarHeightForTests(): void {
  setMobileTabBarHeight(DEFAULT_MOBILE_TAB_BAR_HEIGHT)
}

export function useMobileTabBarHeight(): number {
  const [height, setHeight] = useState(currentTabBarHeight)
  useEffect(() => {
    setHeight(currentTabBarHeight)
    tabBarHeightListeners.add(setHeight)
    return () => {
      tabBarHeightListeners.delete(setHeight)
    }
  }, [])
  return height
}

let currentPrimaryClearance = 0
const primaryClearanceListeners = new Set<NumberListener>()

export function setMobilePrimaryActionClearance(height: number): void {
  const normalized = Number.isFinite(height) && height >= 0 ? height : 0
  if (currentPrimaryClearance === normalized) return
  currentPrimaryClearance = normalized
  primaryClearanceListeners.forEach((listener) => listener(currentPrimaryClearance))
}

export function resetMobilePrimaryActionClearanceForTests(): void {
  setMobilePrimaryActionClearance(0)
}

export function useMobilePrimaryActionClearance(): number {
  const [clearance, setClearance] = useState(currentPrimaryClearance)
  useEffect(() => {
    setClearance(currentPrimaryClearance)
    primaryClearanceListeners.add(setClearance)
    return () => {
      primaryClearanceListeners.delete(setClearance)
    }
  }, [])
  return clearance
}

export function dispatchMobileAnnouncement(
  message: string,
  urgency: 'polite' | 'assertive'
): void {
  if (Platform.OS === 'web') return
  if (
    Platform.OS === 'ios' &&
    typeof AccessibilityInfo.announceForAccessibilityWithOptions === 'function'
  ) {
    AccessibilityInfo.announceForAccessibilityWithOptions(message, {
      queue: urgency === 'polite',
    })
    return
  }
  if (typeof AccessibilityInfo.announceForAccessibility === 'function') {
    AccessibilityInfo.announceForAccessibility(message)
  }
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

export function useStatusBar() {
  const ctx = useContext(SaveFeedbackContext)
  const networkOnline = useNetworkOnline()
  if (ctx) {
    return {
      ...ctx,
      hasProvider: true,
    }
  }
  return {
    isOnline: networkOnline,
    notice: null as StatusBarNotice | null,
    showNotice: (input: StatusBarNoticeInput) => createStatusBarNotice(input),
    dismissNotice: () => undefined,
    announce: () => undefined,
    hasProvider: false,
  }
}

export function OfflineStatusLine({
  online,
  inline = false,
  headerOffset,
}: {
  online?: boolean
  inline?: boolean
  headerOffset?: number
}) {
  const { t } = useTranslation()
  const colors = useSchemeColors()
  const insets = useSafeAreaInsets()
  const statusBar = useStatusBar()
  const isOnline = online ?? statusBar.isOnline

  if (isOnline) return null

  const defaultHeaderOffset = Platform.OS === 'ios' ? 44 : 56
  const topOffset = Math.max(insets.top, 0) + (headerOffset ?? defaultHeaderOffset)

  return (
    <View
      testID="offline-status-line"
      accessibilityLiveRegion="none"
      style={[
        inline ? styles.offlineLineInline : styles.offlineLine,
        !inline ? { top: topOffset } : undefined,
        {
          backgroundColor: colors.noticeSurface,
          borderColor: colors.noticeLine,
          borderBottomColor: colors.noticeLine,
        },
      ]}
    >
      <Text
        accessibilityLiveRegion="none"
        style={[styles.offlineText, { color: colors.noticeInk }]}
      >
        {t('feedback.offlineBanner')}
      </Text>
    </View>
  )
}

export function StatusFeedbackBar({
  notice,
  onDismiss,
  placement = 'floating',
  primaryActionClearance,
}: {
  notice: StatusBarNotice | null
  onDismiss: (noticeId?: string) => void
  placement?: 'floating' | 'inline'
  primaryActionClearance?: number
}) {
  const colors = useSchemeColors()
  const insets = useSafeAreaInsets()
  const tabBarHeight = useMobileTabBarHeight()
  const sharedPrimaryClearance = useMobilePrimaryActionClearance()
  const reducedMotion = useReducedMotion()
  const opacity = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (!notice) return
    if (reducedMotion) {
      opacity.setValue(1)
      return
    }
    opacity.setValue(0)
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 150,
      useNativeDriver: false,
    })
    animation.start()
    return () => animation.stop()
  }, [notice, opacity, reducedMotion])

  if (!notice) return null

  const actions = clampStatusBarActions(notice.actions)
  const palette = (() => {
    switch (notice.tone) {
      case 'error':
        return {
          backgroundColor: colors.dangerSurface,
          borderColor: colors.dangerLine,
          textColor: colors.dangerInk,
          actionColor: colors.dangerInk,
        }
      case 'offline':
        return {
          backgroundColor: colors.noticeSurface,
          borderColor: colors.noticeLine,
          textColor: colors.noticeInk,
          actionColor: colors.noticeInk,
        }
      case 'success':
      case 'neutral':
        return {
          backgroundColor: colors.inverse,
          borderColor: colors.lineStrong,
          textColor: colors.onInverse,
          // Story CC-7.9 D3: the action on the inverse bar is its ink, never a gold tint.
          actionColor: colors.onInverse,
        }
    }
  })()

  const bar = (
    <Animated.View
      testID="status-feedback-bar"
      accessibilityLiveRegion="none"
      style={[
        styles.bar,
        {
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
          opacity,
        },
        placement === 'inline' ? styles.inlineBar : undefined,
      ]}
    >
      <Text
        accessibilityLiveRegion="none"
        style={[styles.barMessage, { color: palette.textColor }]}
      >
        {notice.message}
      </Text>
      {actions.length > 0 && (
        <View style={styles.barActions}>
          {actions.map((action) => (
            <Pressable
              key={action.id}
              testID={`status-bar-action-${action.kind ?? action.id}`}
              accessibilityRole="button"
              style={styles.barActionButton}
              onPress={() => {
                const activeId = notice.id
                const result = action.onPress()
                if (result && typeof result.then === 'function') {
                  void result.catch(() => undefined).finally(() => onDismiss(activeId))
                } else {
                  onDismiss(activeId)
                }
              }}
            >
              <Text style={[styles.barActionText, { color: palette.actionColor }]}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Animated.View>
  )

  if (placement === 'inline') {
    return bar
  }

  const extraPrimaryClearance = primaryActionClearance ?? sharedPrimaryClearance
  const bottomOffset =
    Math.max(insets.bottom, 0) +
    tabBarHeight +
    MOBILE_STATUS_BAR_GAP +
    extraPrimaryClearance

  return (
    <View
      testID="status-feedback-bar-host"
      style={[styles.floatingHost, { bottom: bottomOffset }]}
    >
      {bar}
    </View>
  )
}

export function SaveFeedbackProvider({
  children,
  inline = false,
  renderOfflineLine = !inline,
  initialOnline,
  headerOffset,
  primaryActionClearance,
  onAnnounce,
}: {
  children: ReactNode
  inline?: boolean
  renderOfflineLine?: boolean
  initialOnline?: boolean
  headerOffset?: number
  primaryActionClearance?: number
  onAnnounce?: (entry: AnnouncementEntry) => void
}) {
  const parent = useContext(SaveFeedbackContext)
  const { t } = useTranslation()
  const networkOnline = useNetworkOnline()
  const isOnline =
    initialOnline !== undefined ? initialOnline : parent ? parent.isOnline : networkOnline

  const [notice, setNotice] = useState<StatusBarNotice | null>(null)
  const [announcement, setAnnouncement] = useState<AnnouncementEntry>({
    id: '',
    message: '',
    urgency: 'polite',
  })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const announcedIdsRef = useRef<Set<string>>(new Set())
  const offlineSeqRef = useRef(0)
  const prevOnlineRef = useRef<boolean | null>(null)
  const onAnnounceRef = useRef(onAnnounce)
  onAnnounceRef.current = onAnnounce

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => clearTimer, [clearTimer])

  const forwardAnnounceToParent = Boolean(parent) && !inline

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
      const urgency = options.urgency ?? 'polite'
      const entry: AnnouncementEntry = {
        id: options.announcementId,
        message: trimmed,
        urgency,
      }
      setAnnouncement(entry)
      dispatchMobileAnnouncement(trimmed, urgency)
      onAnnounceRef.current?.(entry)
    },
    []
  )

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
    const prev = prevOnlineRef.current
    prevOnlineRef.current = isOnline
    if (!isOnline && prev !== false) {
      offlineSeqRef.current += 1
      announce(t('feedback.offlineBanner'), {
        announcementId: createAnnouncementToken('offline-banner', offlineSeqRef.current),
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
      {inline && renderOfflineLine && (
        <OfflineStatusLine online={isOnline} inline headerOffset={headerOffset} />
      )}
      {children}
      {!inline && renderOfflineLine && (
        <OfflineStatusLine online={isOnline} headerOffset={headerOffset} />
      )}
      <StatusFeedbackBar
        notice={notice}
        onDismiss={dismissNotice}
        placement={inline ? 'inline' : 'floating'}
        primaryActionClearance={primaryActionClearance}
      />
      {!forwardAnnounceToParent && Platform.OS === 'web' && (
        <Text
          testID="save-feedback-announcer"
          accessibilityLiveRegion={announcement.urgency}
          style={styles.visuallyHidden}
        >
          {announcement.message ? (
            <Text key={announcement.id}>{announcement.message}</Text>
          ) : null}
        </Text>
      )}
    </SaveFeedbackContext.Provider>
  )
}

const styles = StyleSheet.create({
  offlineLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 35,
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineLineInline: {
    marginHorizontal: 20,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineText: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  floatingHost: {
    position: 'absolute',
    pointerEvents: 'box-none',
    left: 16,
    right: 16,
    zIndex: 40,
  },
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 48,
  },
  inlineBar: {
    marginTop: 8,
    marginBottom: 8,
  },
  barMessage: {
    flex: 1,
    minWidth: 140,
    fontSize: 14,
    fontWeight: '600',
  },
  barActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  barActionButton: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  barActionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  visuallyHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
})
