// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): the drag the native layer swipe (LayerSwipeHandle, D13) reads.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import { fireEvent } from '@testing-library/react'

/**
 * The next macrotask. The PanResponder skips a move whose timestamp it already counted, so each
 * step of the drag is a separate event with a later `timeStamp`.
 */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 4))

/**
 * Drags from the middle of `element` by `dx` across and `dy` down (negative is up), in three
 * moves, then lets go. react-native-web's responder system emulates a touch from a primary mouse
 * button, so this is the gesture a LayerSwipeHandle receives on device: its capture claims the
 * drag once it moves more than 8 px more down than across, and the release decides the close.
 */
export async function dragFrom(
  element: HTMLElement,
  { dx = 0, dy }: { dx?: number; dy: number }
): Promise<void> {
  const rect = element.getBoundingClientRect()
  // Away from 0: the responder event reads `pageY || domEvent.pageY`.
  const x = Math.max(1, rect.left + rect.width / 2)
  const y = Math.max(1, rect.top + rect.height / 2)
  fireEvent.mouseDown(element, { button: 0, buttons: 1, clientX: x, clientY: y })
  for (const share of [0.25, 0.5, 1]) {
    await nextTask()
    fireEvent.mouseMove(element, {
      button: 0,
      buttons: 1,
      clientX: x + dx * share,
      clientY: y + dy * share,
    })
  }
  await nextTask()
  fireEvent.mouseUp(element, { button: 0, buttons: 0, clientX: x + dx, clientY: y + dy })
}
