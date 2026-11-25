// Story CC-7.7 D6 owner: one reduced-motion rule for every React Native Modal in the app.
import { useReducedMotion } from './use-reduced-motion'

/** The presentation a Modal uses when the member has not asked for reduced motion. */
export type ModalMotion = 'slide' | 'fade'

/**
 * The `animationType` for a Modal: instant under the OS reduced-motion setting (and until the
 * setting resolves, like `useReducedMotion`), otherwise the modal's own slide or fade. The
 * platform times the slide and fade itself (D6 keeps that system timing when motion is on).
 */
export function useModalAnimation(motion: ModalMotion): ModalMotion | 'none' {
  return useReducedMotion() ? 'none' : motion
}
