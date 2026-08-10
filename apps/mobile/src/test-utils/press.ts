import { fireEvent } from '@testing-library/react'

/**
 * Presses a react-native-web Touchable the way a real tap does.
 *
 * `TouchableOpacity` reads `disabled`/`onPress` from a config object that
 * `usePressEvents` refreshes in a *passive* effect. `waitFor` resolves off the
 * DOM mutation that enables the button, and that mutation lands a task before
 * React flushes the effect, so a bare `fireEvent.click` on a just-enabled
 * Touchable is silently dropped -- the press responder still believes it is
 * disabled. Dispatching the pointer sequence first forces the pending effect to
 * flush, which is both faithful to a real tap and deterministic.
 *
 * Story 4.4 owner: extracted after this exact helper (and its explanatory
 * comment) was duplicated verbatim across wardrobe-hub-screen.test.tsx and
 * wardrobe-onboarding-screen.test.tsx.
 */
export function press(element: HTMLElement) {
  fireEvent.pointerDown(element)
  fireEvent.pointerUp(element)
  fireEvent.click(element)
}
