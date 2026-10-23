// Story 6.7 owner: binds the shared teaser lifecycle to mobile Home, with the
// activation, the return focus and the focus hand-off when the teaser leaves.
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { AccessibilityInfo, AppState, Platform, type View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { SpotlightTeaserState, type SpotlightTeaserValue } from '@couture/api-client'
import {
  communityCommentsSessionFromMobile,
  communityRetryAfterSeconds,
  getCommunitySpotlightFromMobile,
  recordCommunitySpotlightOpenedFromMobile,
} from '@/src/lib/community'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'

export interface HomeSpotlightTeaserView {
  value: SpotlightTeaserValue | null
  /** The image failed to load: the teaser leaves and reserves no space. */
  removeValue: () => void
}

/**
 * The member the Community screen reads for: the verified application user, or
 * the bearer's subject while that verification is pending. Undefined until the
 * first resolution; null when signed out. Each application-user change, sign-in
 * and sign-out included, resolves it again.
 */
function useCommunityMember(applicationUserId: string | null): string | null | undefined {
  const [member, setMember] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let active = true
    communityCommentsSessionFromMobile().then(
      (identity) => {
        if (active) setMember(identity)
      },
      () => {
        if (active) setMember(null)
      }
    )
    return () => {
      active = false
    }
  }, [applicationUserId])
  return member
}

/**
 * The teaser has its own read, state and failures; nothing here touches the
 * hero. It reads only for a resolved member while Home is focused and the app
 * is in the foreground, and each regained focus or foreground is a trigger the
 * shared 60-second floor may refuse.
 */
export function useHomeSpotlightTeaser({
  applicationUserId,
  focused,
}: {
  applicationUserId: string | null
  focused: boolean
}): HomeSpotlightTeaserView {
  const memberId = useCommunityMember(applicationUserId)
  const [state] = useState(
    () =>
      new SpotlightTeaserState({
        read: (signal) =>
          getCommunitySpotlightFromMobile({ limit: 1, surface: 'home_teaser', signal }),
        retryAfterSeconds: communityRetryAfterSeconds,
      })
  )
  const value = useSyncExternalStore(
    state.subscribe,
    state.getSnapshot,
    state.getSnapshot
  )
  const [foreground, setForeground] = useState(AppState.currentState === 'active')

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      setForeground(next === 'active')
    })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    state.setMember(memberId)
  }, [memberId, state])

  useEffect(() => {
    state.setActive(focused && foreground)
  }, [focused, foreground, state])

  // Leaving Home for good idles the lifecycle: the read aborts and nothing waits.
  useEffect(
    () => () => {
      state.setActive(false)
      state.setMember(null)
    },
    [state]
  )

  return { value, removeValue: state.removeValue }
}

/** A fresh token per activation, so Community moves focus once per tap. */
let focusSerial = 0
function newFocusToken(): string {
  focusSerial += 1
  return `${Date.now().toString(36)}-${focusSerial.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

/** Moves accessibility focus: the DOM node on web, the native node elsewhere. */
function focusTarget(target: unknown, testId: string) {
  requestAnimationFrame(() => {
    if (Platform.OS === 'web') {
      document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus()
      return
    }
    const handle = safeFindNodeHandle(target)
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle)
  })
}

export interface HomeSpotlightTeaserLink extends HomeSpotlightTeaserView {
  linkRef: RefObject<View | null>
  open: () => void
  onFocus: () => void
  onBlur: () => void
}

/**
 * The Home teaser as one link: activation pushes Community with a fresh focus
 * intent and records the home_teaser open; the first return to Home after an
 * activation puts focus back on the link, or on the scroll view when the link
 * is gone; a teaser that leaves while it holds focus hands focus to the scroll
 * view.
 */
export function useHomeSpotlightTeaserLink({
  applicationUserId,
  scrollViewRef,
}: {
  applicationUserId: string | null
  scrollViewRef: RefObject<unknown>
}): HomeSpotlightTeaserLink {
  const router = useRouter()
  const [isHomeFocused, setIsHomeFocused] = useState(false)
  const teaser = useHomeSpotlightTeaser({ applicationUserId, focused: isHomeFocused })
  const linkRef = useRef<View>(null)
  /** The activation whose return to Home still owes a focus move; consumed once. */
  const pendingReturnRef = useRef<string | null>(null)
  const holdsFocusRef = useRef(false)

  useFocusEffect(
    useCallback(() => {
      setIsHomeFocused(true)
      if (pendingReturnRef.current) {
        pendingReturnRef.current = null
        if (linkRef.current) {
          holdsFocusRef.current = true
          focusTarget(linkRef.current, 'home-spotlight-teaser-link')
        } else {
          focusTarget(scrollViewRef.current, 'hero-experience-scrollview')
        }
      }
      return () => setIsHomeFocused(false)
    }, [scrollViewRef])
  )

  useEffect(() => {
    if (teaser.value || !holdsFocusRef.current) return
    holdsFocusRef.current = false
    focusTarget(scrollViewRef.current, 'hero-experience-scrollview')
  }, [scrollViewRef, teaser.value])

  const value = teaser.value
  const open = useCallback(() => {
    if (!value) return
    const focusToken = newFocusToken()
    pendingReturnRef.current = focusToken
    holdsFocusRef.current = false
    // Measurement only: a failed record never blocks the navigation.
    void recordCommunitySpotlightOpenedFromMobile(
      value.item.id,
      value.item.rank,
      value.level,
      undefined,
      'home_teaser'
    ).catch(() => undefined)
    router.push({
      pathname: '/community',
      params: {
        source: 'app',
        type: 'community',
        cardId: value.item.id,
        focus: 'spotlight',
        focusToken,
      },
    })
  }, [router, value])

  const onFocus = useCallback(() => {
    holdsFocusRef.current = true
  }, [])
  const onBlur = useCallback(() => {
    holdsFocusRef.current = false
  }, [])

  return { ...teaser, linkRef, open, onFocus, onBlur }
}
