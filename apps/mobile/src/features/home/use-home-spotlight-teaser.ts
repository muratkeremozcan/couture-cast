// Story 6.7 owner: binds the shared teaser lifecycle to mobile Home, with the
// activation, the return focus and the focus hand-off when the teaser leaves.
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
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
import {
  focusAccessibilityElement,
  observeAccessibilityFocus,
} from '@/modules/accessibility-focus'

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

/** A focus move this Home made, for UI automation; the count proves "once". */
export interface TeaserFocusMove {
  target: TeaserFocusTarget
  count: number
}

const FOCUS_TEST_IDS: Record<TeaserFocusTarget, string> = {
  link: 'home-spotlight-teaser-link',
  'scroll-view': 'hero-experience-scrollview',
}

interface FocusDestination {
  target: TeaserFocusTarget
  node: unknown
}

/** A focus request that reached a real node: its target and native handle. */
interface FocusRequest {
  target: TeaserFocusTarget
  /** Native handle; null on web, where the DOM reports focus itself. */
  handle: number | null
  /** Web only: focus actually landed on the element. */
  landed: boolean
}

/**
 * How many frames a native view gets to accept accessibility focus. On a return
 * to Home the screen's views are reattached a frame or more after navigation
 * reports focus, and until then the platform refuses the move.
 */
export const NATIVE_FOCUS_FRAMES = 60

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })

/**
 * From the next frame on, asks `destination` where focus should go and moves
 * accessibility focus there: the DOM node on web, the native node elsewhere,
 * through the accessibility-focus module when the build carries it. The target
 * is chosen again in every frame, so a teaser that left since the request was
 * queued is never the target; a native view that refuses focus is asked again
 * on the next frame, up to `NATIVE_FOCUS_FRAMES`. `onChosen` runs once, at the
 * first frame that has a destination; `onDispatch` runs just before each native
 * request, because the OS can report the focus before the request resolves.
 * Resolves the request that went through, or null when nothing was focused.
 */
async function moveAccessibilityFocus(
  destination: () => FocusDestination | null,
  onChosen: () => void,
  onDispatch: (request: FocusRequest) => void
): Promise<FocusRequest | null> {
  for (let frame = 0; frame < NATIVE_FOCUS_FRAMES; frame += 1) {
    await nextFrame()
    const chosen = destination()
    if (!chosen) return null
    if (frame === 0) onChosen()
    if (Platform.OS === 'web') {
      const element = document.querySelector<HTMLElement>(
        `[data-testid="${FOCUS_TEST_IDS[chosen.target]}"]`
      )
      element?.focus()
      return element
        ? {
            target: chosen.target,
            handle: null,
            landed: document.activeElement === element,
          }
        : null
    }
    const handle = safeFindNodeHandle(chosen.node)
    if (!handle) return null
    const request = { target: chosen.target, handle, landed: false }
    onDispatch(request)
    // The module moves the screen reader's cursor itself; React Native's call is
    // the fallback where the build has none (Expo Go), and it cannot say whether
    // the move was taken.
    const moving = focusAccessibilityElement(handle)
    if (!moving) {
      AccessibilityInfo.setAccessibilityFocus(handle)
      return request
    }
    if (await moving.catch(() => false)) return request
  }
  return null
}

const nextMove = (target: TeaserFocusTarget) => (previous: TeaserFocusMove | null) => ({
  target,
  count: (previous?.count ?? 0) + 1,
})

export interface HomeSpotlightTeaserLink extends HomeSpotlightTeaserView {
  linkRef: RefObject<View | null>
  open: () => void
  onFocus: () => void
  onBlur: () => void
  /** The last focus move Home requested from a real node. */
  focusRequested: TeaserFocusMove | null
  /**
   * The last focus move the platform confirmed: the DOM on web, the OS
   * accessibility-focus event on a native build that carries the observer.
   */
  focusLanded: TeaserFocusMove | null
}

/**
 * The Home teaser as one link: activation pushes Community with a fresh focus
 * intent and records the home_teaser open; the first return to Home after an
 * activation puts focus back on the link, or on the scroll view when the link
 * is gone by the frame focus moves in; a teaser that leaves while it holds focus
 * hands focus to the scroll view.
 *
 * "Holds focus" is what the platform reports: input focus from the link
 * (keyboard, web), or OS accessibility focus on the link from the native
 * observer. A build without the observer (Expo Go) cannot see a screen reader's
 * focus, so it hands nothing off on removal and never steals focus the member
 * moved elsewhere.
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
  /** The OS reports accessibility focus on the link. */
  const osFocusOnLinkRef = useRef(false)
  /** A native focus request the OS has not confirmed yet, set as it is sent. */
  const unconfirmedRef = useRef<FocusRequest | null>(null)
  const mountedRef = useRef(true)
  /** Each focus move takes this serial; a later move ends any earlier one still trying. */
  const moveSerialRef = useRef(0)
  const [focusRequested, setFocusRequested] = useState<TeaserFocusMove | null>(null)
  const [focusLanded, setFocusLanded] = useState<TeaserFocusMove | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(
    () =>
      observeAccessibilityFocus(({ tags }) => {
        const linkHandle = safeFindNodeHandle(linkRef.current)
        osFocusOnLinkRef.current = linkHandle !== null && tags.includes(linkHandle)
        const request = unconfirmedRef.current
        if (request?.handle && tags.includes(request.handle)) {
          unconfirmedRef.current = null
          setFocusLanded(nextMove(request.target))
        }
      }) ?? undefined,
    []
  )

  const moveFocus = useCallback(
    (
      destination: () => FocusDestination | null,
      onChosen: () => void = () => undefined
    ) => {
      moveSerialRef.current += 1
      const serial = moveSerialRef.current
      return moveAccessibilityFocus(
        () =>
          serial === moveSerialRef.current &&
          mountedRef.current &&
          isHomeFocusedRef.current
            ? destination()
            : null,
        onChosen,
        (request) => {
          unconfirmedRef.current = request
        }
      ).then((request) => {
        if (!request) {
          if (serial === moveSerialRef.current) unconfirmedRef.current = null
          return
        }
        if (!mountedRef.current) return
        setFocusRequested(nextMove(request.target))
        if (request.landed) setFocusLanded(nextMove(request.target))
      })
    },
    []
  )

  useFocusEffect(
    useCallback(() => {
      isHomeFocusedRef.current = true
      setIsHomeFocused(true)
      const token = pendingReturnRef.current
      if (token) {
        void moveFocus(
          () =>
            linkRef.current
              ? { target: 'link', node: linkRef.current }
              : { target: 'scroll-view', node: scrollViewRef.current },
          // Consumed once a destination exists in a frame focus moves in; a Home
          // blur before that frame leaves it for the next return.
          () => {
            if (pendingReturnRef.current === token) pendingReturnRef.current = null
          }
        )
      }
      return () => {
        isHomeFocusedRef.current = false
        inputFocusRef.current = false
        osFocusOnLinkRef.current = false
        setIsHomeFocused(false)
      }
    }, [moveFocus, scrollViewRef])
  )

  // Runs in the commit that removes the link, before any later focus report
  // could describe where the platform put focus after the removal.
  useLayoutEffect(() => {
    if (teaser.value) return
    const held = inputFocusRef.current || osFocusOnLinkRef.current
    inputFocusRef.current = false
    osFocusOnLinkRef.current = false
    if (held)
      void moveFocus(() => ({ target: 'scroll-view', node: scrollViewRef.current }))
  }, [moveFocus, scrollViewRef, teaser.value])

  const value = teaser.value
  const open = useCallback(() => {
    if (!value) return
    const focusToken = newFocusToken()
    pendingReturnRef.current = focusToken
    inputFocusRef.current = false
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

  return { ...teaser, linkRef, open, onFocus, onBlur, focusRequested, focusLanded }
}
