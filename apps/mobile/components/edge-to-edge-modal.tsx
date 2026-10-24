// R52 owner: every overlay Modal spans the whole screen and keeps its content clear of the
// system bars.
import React from 'react'
import { Modal, type ModalProps } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * R52: a Modal whose window covers the whole screen on Android as well. Without the two
 * translucent flags the Android dialog window stops at the status bar and the navigation
 * bar, so the app's tab bar shows undimmed, with clipped icons, in the strip below the
 * scrim. Both flags are Android-only; an iOS modal already covers the screen. It is
 * transparent by default, for a scrim over the screen; an opaque full-screen page passes
 * `transparent={false}`.
 */
export function EdgeToEdgeModal(
  props: Omit<ModalProps, 'statusBarTranslucent' | 'navigationBarTranslucent'>
) {
  return <Modal transparent {...props} statusBarTranslucent navigationBarTranslucent />
}

/**
 * R52: the system bar insets an EdgeToEdgeModal's content keeps clear of. `bottom` is the
 * home indicator or the Android gesture or navigation bar. It is 0 while the software
 * keyboard is open: the keyboard then covers that bar, and a sheet lifted above the
 * keyboard sits directly on it.
 */
export function useModalInsets(keyboardOpen = false): { top: number; bottom: number } {
  const insets = useSafeAreaInsets()
  return { top: insets.top, bottom: keyboardOpen ? 0 : insets.bottom }
}
