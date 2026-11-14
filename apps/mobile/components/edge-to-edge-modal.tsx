// R52 owner: every overlay Modal spans the whole screen and keeps its content clear of the
// system bars. R57/R61: it also lifts that content above the software keyboard.
import React, { cloneElement, isValidElement, useEffect, useRef, useState } from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  View,
  type ModalProps,
} from 'react-native'
import {
  LiveFontMountMarker,
  liveFontMountMarkersEnabled,
} from './live-font-mount-marker'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

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

type EdgeToEdgeModalProps = Omit<
  ModalProps,
  'statusBarTranslucent' | 'navigationBarTranslucent'
> & {
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
    return { node: placed ? next : node, placed }
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
function withModalMarker(children: React.ReactNode) {
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

export function EdgeToEdgeModal({
  scrim,
  scrimTestID,
  children,
  ...props
}: EdgeToEdgeModalProps) {
  const [keyboardOpen] = useKeyboardOpen()
  return (
    <Modal transparent {...props} statusBarTranslucent navigationBarTranslucent>
      <View testID={scrimTestID} style={[styles.fill, { backgroundColor: scrim }]}>
        <KeyboardAvoidingView
          testID="edge-to-edge-modal-keyboard-view"
          style={styles.fill}
          {...modalKeyboardAvoiding(keyboardOpen)}
        >
          {withModalMarker(children)}
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
