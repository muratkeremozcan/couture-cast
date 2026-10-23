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

/**
 * How long a return focus counts as the teaser holding focus. React Native has
 * no screen-reader focus event, so a hand-off to the scroll view is armed only
 * for this window after the return put focus on the link. Past it, the member may
 * have swiped elsewhere, and moving focus would pull them away from it.
 */
export const TEASER_RETURN_FOCUS_HOLD_MS = 10_000

export interface HomeSpotlightTeaserView {
  value: SpotlightTeaserValue | null
  /** The image failed to load: the teaser leaves and reserves no space. */
  removeValue: () => void
}

/**
 * The member the Community screen reads for: the verified application user, or
 * the bearer's subject while that verification is pending. Undefined until the
 * first resolution and while a new application user resolves; null when signed
 * out. The answer is keyed by the application user it was resolved for, so the
 * moment that user changes the previous member is gone in the same render.
 */
function useCommunityMember(applicationUserId: string | null): string | null | undefined {
  const [resolved, setResolved] = useState<{
    applicationUserId: string | null
    member: string | null
  } | null>(null)
  useEffect(() => {
    let active = true
    communityCommentsSessionFromMobile().then(
      (member) => {
        if (active) setResolved({ applicationUserId, member })
      },
      () => {
        if (active) setResolved({ applicationUserId, member: null })
      }
    )
    return () => {
      active = false
    }
  }, [applicationUserId])
  return resolved?.applicationUserId === applicationUserId ? resolved.member : undefined
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
  const snapshot = useSyncExternalStore(
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

  // An unresolved member clears the lifecycle, aborts its read and drops any
  // late response before the next member is known.
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

  // A value belongs to one member: in the render where the member changes, the
  // previous member's value is already hidden.
  const value = snapshot && snapshot.memberId === memberId ? snapshot : null
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

export type TeaserFocusTarget = 'link' | 'scroll-view'

/** The last focus move this Home made, for UI automation; the count proves "once". */
export interface TeaserFocusMove {
  target: TeaserFocusTarget
  count: number
}

const FOCUS_TEST_IDS: Record<TeaserFocusTarget, string> = {
  link: 'home-spotlight-teaser-link',
  'scroll-view': 'hero-experience-scrollview',
}

/**
 * Moves accessibility focus on the next frame: the DOM node on web, the native
 * node elsewhere. Resolves whether focus was actually requested.
 */
function focusTarget(
  target: unknown,
  kind: TeaserFocusTarget,
  stillWanted: () => boolean
): Promise<boolean> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      if (!stillWanted()) {
        resolve(false)
        return
      }
      if (Platform.OS === 'web') {
        const element = document.querySelector<HTMLElement>(
          `[data-testid="${FOCUS_TEST_IDS[kind]}"]`
        )
        element?.focus()
        resolve(Boolean(element))
        return
      }
      const handle = safeFindNodeHandle(target)
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle)
      resolve(Boolean(handle))
    })
  })
}

export interface HomeSpotlightTeaserLink extends HomeSpotlightTeaserView {
  linkRef: RefObject<View | null>
  open: () => void
  onFocus: () => void
  onBlur: () => void
  focusMove: TeaserFocusMove | null
}

/**
 * The Home teaser as one link: activation pushes Community with a fresh focus
 * intent and records the home_teaser open; the first return to Home after an
 * activation puts focus back on the link, or on the scroll view when the link
 * is gone; a teaser that leaves while it holds focus hands focus to the scroll
 * view.
 *
 * "Holds focus" is input focus reported by the link (keyboard, web) or the
 * bounded window after a return focus. Screen readers report neither, so the
 * window keeps a later removal from stealing focus the member moved elsewhere.
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
  const isHomeFocusedRef = useRef(false)
  const teaser = useHomeSpotlightTeaser({ applicationUserId, focused: isHomeFocused })
  const linkRef = useRef<View>(null)
  /** The activation whose return to Home still owes a focus move; consumed once. */
  const pendingReturnRef = useRef<string | null>(null)
  const inputFocusRef = useRef(false)
  const returnHoldUntilRef = useRef(0)
  const mountedRef = useRef(true)
  const [focusMove, setFocusMove] = useState<TeaserFocusMove | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const moveFocus = useCallback(
    (target: unknown, kind: TeaserFocusTarget) =>
      focusTarget(
        target,
        kind,
        () => mountedRef.current && isHomeFocusedRef.current
      ).then((moved) => {
        if (!moved || !mountedRef.current) return moved
        setFocusMove((previous) => ({ target: kind, count: (previous?.count ?? 0) + 1 }))
        return moved
      }),
    []
  )

  useFocusEffect(
    useCallback(() => {
      isHomeFocusedRef.current = true
      setIsHomeFocused(true)
      if (pendingReturnRef.current) {
        pendingReturnRef.current = null
        if (linkRef.current) {
          void moveFocus(linkRef.current, 'link').then((moved) => {
            if (moved)
              returnHoldUntilRef.current = Date.now() + TEASER_RETURN_FOCUS_HOLD_MS
          })
        } else {
          void moveFocus(scrollViewRef.current, 'scroll-view')
        }
      }
      return () => {
        isHomeFocusedRef.current = false
        returnHoldUntilRef.current = 0
        inputFocusRef.current = false
        setIsHomeFocused(false)
      }
    }, [moveFocus, scrollViewRef])
  )

  useEffect(() => {
    if (teaser.value) return
    const held = inputFocusRef.current || Date.now() < returnHoldUntilRef.current
    inputFocusRef.current = false
    returnHoldUntilRef.current = 0
    if (held) void moveFocus(scrollViewRef.current, 'scroll-view')
  }, [moveFocus, scrollViewRef, teaser.value])

  const value = teaser.value
  const open = useCallback(() => {
    if (!value) return
    const focusToken = newFocusToken()
    pendingReturnRef.current = focusToken
    inputFocusRef.current = false
    returnHoldUntilRef.current = 0
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
    inputFocusRef.current = true
  }, [])
  const onBlur = useCallback(() => {
    inputFocusRef.current = false
  }, [])

  return { ...teaser, linkRef, open, onFocus, onBlur, focusMove }
}
