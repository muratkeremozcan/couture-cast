// R52 owner: every overlay Modal spans the whole screen and keeps its content clear of the
// system bars. R57/R61: it also lifts that content above the software keyboard.
// Story CC-7.11 D13 owner: every layer closes by system back (`onRequestClose`, required) and by a
// downward swipe on its header (LayerSwipeHandle), and hands accessibility focus back to its
// opener (`returnFocusRef`) once it closes.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import React, {
  Fragment,
  cloneElement,
  createContext,
  createElement,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  AccessibilityInfo,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  View,
  type ModalProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import {
  LiveFontMountMarker,
  liveFontMountMarkersEnabled,
} from './live-font-mount-marker'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useReducedMotion } from '@/src/hooks/use-reduced-motion'

/**
 * Whether the software keyboard is open. iOS reports the change as the keyboard starts
 * to move; Android reports it once the keyboard is up, the same event a
 * KeyboardAvoidingView resizes on. `onShow` runs before the state changes, so a caller
 * can record what the opening keyboard is about to change.
 */
export function useKeyboardOpen(onShow?: () => void): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => Keyboard.isVisible())
  const latestOnShow = useRef(onShow)
  latestOnShow.current = onShow
  useEffect(() => {
    const ios = Platform.OS === 'ios'
    const shown = Keyboard.addListener(
      ios ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        latestOnShow.current?.()
        setOpen(true)
      }
    )
    const hidden = Keyboard.addListener(
      ios ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setOpen(false)
    )
    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])
  return [open, setOpen]
}

/**
 * R57/R61: how the modal's keyboard view lifts its content. The translucent flags make
 * the Android dialog window edge to edge, so the IME arrives as an inset and the
 * window's adjustResize no longer shrinks the content: the keyboard view has to. Android
 * reports a closed keyboard at the bottom of the visible frame, above the navigation
 * bar, so there it acts only while the keyboard is open; otherwise it would stay that
 * much short of the full-screen window.
 */
export function modalKeyboardAvoiding(keyboardOpen: boolean) {
  return {
    behavior: Platform.OS === 'ios' ? 'padding' : 'height',
    enabled: Platform.OS !== 'android' || keyboardOpen,
  } as const
}

/** Anything a ref can hold that takes focus: a Pressable, a View, a Text. */
export type LayerFocusTarget = React.RefObject<unknown>

type EdgeToEdgeModalProps = Omit<
  ModalProps,
  'statusBarTranslucent' | 'navigationBarTranslucent' | 'onRequestClose'
> & {
  /**
   * D13: Android back and the iOS accessibility escape close the layer, and so does a swipe
   * down on its LayerSwipeHandle. Required, so no layer ignores system back.
   */
  onRequestClose: () => void
  /**
   * D13: the control that opened the layer; it gets accessibility focus once the layer closes.
   * `null` only where the caller already returns focus itself (and says so where it passes it),
   * for example to one of several openers it tracks.
   */
  returnFocusRef: LayerFocusTarget | null
  /**
   * The scrim's color, painted by the full-screen layer that holds the keyboard view,
   * so the space that view gives up while the keyboard moves never shows the screen
   * below undimmed.
   */
  scrim?: string
  scrimTestID?: string
}

/**
 * R52: a Modal whose window covers the whole screen on Android as well. Without the two
 * translucent flags the Android dialog window stops at the status bar and the navigation
 * bar, so the app's tab bar shows undimmed, with clipped icons, in the strip below the
 * scrim. Both flags are Android-only; an iOS modal already covers the screen. It is
 * transparent by default, for a scrim over the screen; an opaque full-screen page passes
 * `transparent={false}`.
 *
 * R57/R61: the content sits in a keyboard view, so a focused field and the controls
 * below it stay above the software keyboard on both platforms.
 */
type MarkerHost = {
  accessibilityViewIsModal?: boolean
  children?: React.ReactNode
  dataSet?: Record<string, string>
}

/**
 * Puts `marker` first inside the first element in `node` that sets accessibilityViewIsModal,
 * walking arrays, fragments and the children of wrapper elements (an overlay View, a
 * KeyboardAvoidingView). Children given as a render function are not walked.
 */
function placeMarker(
  node: React.ReactNode,
  marker: React.ReactElement
): { node: React.ReactNode; placed: boolean } {
  if (Array.isArray(node)) {
    let placed = false
    const next = (node as React.ReactNode[]).map((child: React.ReactNode) => {
      if (placed) return child
      const result = placeMarker(child, marker)
      placed = result.placed
      return result.node
    })
    // Spread as static children: a rebuilt array would read as an unkeyed list, and
    // written siblings (a spacer and a sheet) carry no keys.
    return { node: placed ? createElement(Fragment, null, ...next) : node, placed }
  }
  if (!isValidElement<MarkerHost>(node)) return { node, placed: false }
  // The host is tagged so a web test can tell the marker found it (react-native-web drops
  // accessibilityViewIsModal); native views ignore dataSet.
  if (node.props.accessibilityViewIsModal)
    return {
      node: cloneElement(
        node,
        { dataSet: { ...node.props.dataSet, liveFontModalHost: 'true' } },
        marker,
        node.props.children
      ),
      placed: true,
    }
  const { children } = node.props
  if (children === undefined || typeof children === 'function')
    return { node, placed: false }
  const inner = placeMarker(children, marker)
  return inner.placed
    ? { node: cloneElement(node, { children: inner.node }), placed: true }
    : { node, placed: false }
}

/**
 * The modal is its own window, so it carries its own mount marker (Story 6.15). A content view
 * with accessibilityViewIsModal hides every other view from VoiceOver and from the XCUITest
 * hierarchy, so the marker goes inside that view wherever the content nests it; with no such
 * view it sits beside the content.
 */
export function withModalMarker(children: React.ReactNode) {
  // Production builds render no marker, so their content stays exactly as written.
  if (!liveFontMountMarkersEnabled()) return children
  const marker = <LiveFontMountMarker key="live-font-mount-marker" scope="modal" />
  const result = placeMarker(children, marker)
  if (result.placed) return result.node
  return (
    <>
      {marker}
      {children}
    </>
  )
}

/**
 * How many EdgeToEdgeModals are up. iOS presents a Modal over the screen that opened it and
 * leaves that screen in the accessibility tree: shard 3 of run 43800364098 found Home's
 * current-temperature under the share card composer, where the composer draws "Preparing card",
 * so VoiceOver could leave the composer for text the composer hides. The app root reads this and
 * hides the screen under an open modal (underModalAccessibility).
 */
let openModals = 0
const modalListeners = new Set<() => void>()
function subscribeModals(listener: () => void) {
  modalListeners.add(listener)
  return () => {
    modalListeners.delete(listener)
  }
}
function setOpenModals(change: number) {
  openModals += change
  modalListeners.forEach((listener) => listener())
}

/** Whether any EdgeToEdgeModal is visible. */
export function useEdgeToEdgeModalOpen(): boolean {
  return useSyncExternalStore(
    subscribeModals,
    () => openModals > 0,
    () => false
  )
}

/**
 * The accessibility props of the screen under the modals: hidden from VoiceOver, the XCUITest
 * tree and TalkBack while one is open. A native Modal draws in its own presented view controller
 * or dialog window, outside the app root, so hiding the root never hides the modal. The web
 * modal is a portal and keeps its own focus trap, so web gets nothing.
 */
export function underModalAccessibility(open: boolean, os: string = Platform.OS) {
  if (os === 'web') return {}
  return {
    accessibilityElementsHidden: open,
    importantForAccessibility: open ? 'no-hide-descendants' : 'auto',
  } as const
}

/** D13: how far down, in px, a drag on a layer's header must travel to close it. */
export const LAYER_SWIPE_CLOSE_PX = 80

/** A drag counts as vertical once it moved this far, so a tap never starts one. */
const LAYER_SWIPE_SLOP_PX = 8

/**
 * Whether a drag that ended `dx` across and `dy` down closes the layer: 80 px or more downward
 * and more down than across. A horizontal or upward drag never closes.
 */
export function layerSwipeCloses(dx: number, dy: number): boolean {
  return dy >= LAYER_SWIPE_CLOSE_PX && Math.abs(dx) < dy
}

/** The open layer's close request, for the swipe handle inside it. */
const LayerCloseContext = createContext<(() => void) | null>(null)

/**
 * D13: the draggable header of a layer. A downward drag of LAYER_SWIPE_CLOSE_PX or more that
 * starts on it closes the layer through its `onRequestClose`, the same path as system back. It
 * claims only a vertical move, so taps on the controls inside it (back, close) still land. It
 * never animates, so reduced motion needs nothing more; the modal's own exit follows the setting.
 */
export function LayerSwipeHandle({
  children,
  style,
  testID = 'layer-swipe-handle',
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  testID?: string
}) {
  const close = useContext(LayerCloseContext)
  const closeRef = useRef(close)
  closeRef.current = close
  const responder = useMemo(
    () =>
      PanResponder.create({
        // Captured, so a drag that starts on the back arrow or the title still closes.
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          gesture.dy > LAYER_SWIPE_SLOP_PX && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderRelease: (_event, gesture) => {
          if (layerSwipeCloses(gesture.dx, gesture.dy)) closeRef.current?.()
        },
        onPanResponderTerminationRequest: () => true,
      }),
    []
  )
  return (
    <View testID={testID} style={style} {...responder.panHandlers}>
      {children}
    </View>
  )
}

/** Moves accessibility focus (keyboard focus on web) to the layer's opener. */
function focusOpener(target: unknown) {
  if (!target) return
  if (Platform.OS === 'web') {
    ;(target as { focus?: () => void }).focus?.()
    return
  }
  const node = safeFindNodeHandle(target)
  if (node != null) AccessibilityInfo.setAccessibilityFocus(node)
}

export function EdgeToEdgeModal({
  scrim,
  scrimTestID,
  children,
  returnFocusRef,
  onDismiss,
  ...props
}: EdgeToEdgeModalProps) {
  const [keyboardOpen] = useKeyboardOpen()
  // Story CC-7.7 D6: every app modal opens through this wrapper, so the reduced-motion rule lives
  // here once: instant under the OS setting (and until it resolves), the caller's slide or fade
  // otherwise. Callers may still pass useModalAnimation's answer; both agree.
  const reducedMotion = useReducedMotion()
  const { visible = true } = props
  const requested = reducedMotion ? 'none' : props.animationType
  // One presentation keeps the animation it opened with (CodeRabbit r1 #16): the setting can
  // resolve while the modal is up, and react-native-web replays the fade from opacity 0 when the
  // type changes on an open modal. The next opening uses the resolved setting.
  const [presentation, setPresentation] = useState({
    open: visible,
    animation: requested,
  })
  if (presentation.open !== visible || (!visible && presentation.animation !== requested))
    setPresentation({ open: visible, animation: requested })
  // The opening render takes the setting as it is now (CodeRabbit r2 #3); every later render of
  // that presentation keeps it.
  const animationType = visible && presentation.open ? presentation.animation : requested
  const returnFocus = useRef(returnFocusRef)
  returnFocus.current = returnFocusRef
  useEffect(() => {
    if (!visible) return
    setOpenModals(1)
    return () => {
      setOpenModals(-1)
      // D13: closed by `visible` or by unmounting; the opener takes focus once the screen under
      // the layer is back in the accessibility tree (the next frame). iOS repeats it on
      // onDismiss, after the sheet has fully gone.
      const opener = returnFocus.current?.current
      if (opener) requestAnimationFrame(() => focusOpener(opener))
    }
  }, [visible])
  return (
    <Modal
      transparent
      {...props}
      onDismiss={() => {
        if (Platform.OS === 'ios') focusOpener(returnFocus.current?.current)
        onDismiss?.()
      }}
      animationType={animationType}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View testID={scrimTestID} style={[styles.fill, { backgroundColor: scrim }]}>
        <KeyboardAvoidingView
          testID="edge-to-edge-modal-keyboard-view"
          style={styles.fill}
          {...modalKeyboardAvoiding(keyboardOpen)}
        >
          <LayerCloseContext.Provider value={props.onRequestClose}>
            {withModalMarker(children)}
          </LayerCloseContext.Provider>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

/**
 * R52: the system bar insets an EdgeToEdgeModal's content keeps clear of. `bottom` is the
 * home indicator or the Android gesture or navigation bar. It is 0 while the software
 * keyboard is open: the keyboard then covers that bar, and content lifted above the
 * keyboard sits directly on it. A caller that tracks the keyboard itself passes its state;
 * otherwise the hook follows the keyboard events.
 */
export function useModalInsets(keyboardOpen?: boolean): { top: number; bottom: number } {
  const insets = useSafeAreaInsets()
  const [observedOpen] = useKeyboardOpen()
  return {
    top: insets.top,
    bottom: (keyboardOpen ?? observedOpen) ? 0 : insets.bottom,
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
