// R52 test support: what a react-native Modal was rendered with, and the insets the
// R52 cases render under.
import { createElement, type ComponentType } from 'react'

/**
 * The props every recorded Modal render received, newest last. A mock factory reaches
 * this module through `vi.importActual`, which loads a copy of its own, so the record
 * lives on `globalThis` where the test's copy and the factory's copy share it.
 */
const store = globalThis as { __r52ModalRenders?: Record<string, unknown>[] }
export const modalRenders: Record<string, unknown>[] = (store.__r52ModalRenders ??= [])

/**
 * Wraps a Modal so each render records its props and then renders the same element.
 * react-native-web drops the Android-only translucent flags, so the record is the only
 * place a test can read them.
 */
export function recordModalProps<P extends object>(Modal: ComponentType<P>) {
  return function RecordingModal(props: P) {
    modalRenders.push(props as Record<string, unknown>)
    return createElement(Modal, props)
  }
}

/** The props of the newest recorded Modal render. */
export function lastModalProps(): Record<string, unknown> | undefined {
  return modalRenders.at(-1)
}

/** Safe-area insets with a status bar and a gesture bar, so a missing inset shows. */
export const TEST_SAFE_AREA_INSETS = { top: 24, right: 0, bottom: 34, left: 0 }

/** The Modal props that make its window cover the status and navigation bars. */
export const EDGE_TO_EDGE_MODAL_PROPS = {
  statusBarTranslucent: true,
  navigationBarTranslucent: true,
}

/** The computed bottom padding of a rendered element, in CSS pixels. */
export function paddingBottomOf(element: Element): number {
  return parseFloat(getComputedStyle(element).paddingBottom)
}

/** The computed top padding of a rendered element, in CSS pixels. */
export function paddingTopOf(element: Element): number {
  return parseFloat(getComputedStyle(element).paddingTop)
}
