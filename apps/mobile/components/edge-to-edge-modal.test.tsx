// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-NAT-030..034, the D13 layer contract of EdgeToEdgeModal:
// system back and a header swipe close a layer, a short or upward drag does not, focus goes back
// to `returnFocusRef` once it closes, and every caller in the app passes both.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
/// <reference types="vite/client" />
import React, {
  Fragment,
  createElement,
  isValidElement,
  useRef,
  useState,
  type ComponentRef,
} from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as EdgeToEdgeTestUtils from '@/src/test-utils/edge-to-edge-modal'
import * as ReactNative from 'react-native'
import {
  EDGE_TO_EDGE_MODAL_PROPS,
  TEST_SAFE_AREA_INSETS,
  lastModalProps,
  liveFontMarkerPlacement,
  modalRenders,
} from '@/src/test-utils/edge-to-edge-modal'
import { dragFrom } from '@/src/test-utils/layer-swipe'
import { press } from '@/src/test-utils/press'
import {
  EdgeToEdgeModal,
  LAYER_SWIPE_CLOSE_PX,
  LayerSwipeHandle,
  layerSwipeCloses,
  underModalAccessibility,
  useEdgeToEdgeModalOpen,
  useModalInsets,
  withModalMarker,
} from './edge-to-edge-modal'

/**
 * react-native-web never reports a software keyboard, so the R57 cases drive the
 * platform's keyboard events through these listeners.
 */
// Story CC-7.7 D6: the wrapper follows the OS reduced-motion setting; each test names it.
const motion = vi.hoisted(() => ({ reduced: false }))
vi.mock('@/src/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => motion.reduced,
}))

const keyboard = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>()
  return {
    addListener: (event: string, listener: () => void) => {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return { remove: () => set.delete(listener) }
    },
    emit: (event: string) => {
      listeners.get(event)?.forEach((listener) => listener())
    },
  }
})

/**
 * D13: native accessibility focus. react-native-web's findNodeHandle always throws, so each DOM
 * node gets a stable fake tag, and the focus call is recorded.
 */
const a11y = vi.hoisted(() => {
  const tags = new Map<unknown, number>()
  return {
    tags,
    tagOf: (node: unknown) => {
      if (!tags.has(node)) tags.set(node, 500 + tags.size)
      return tags.get(node)!
    },
    setAccessibilityFocus: vi.fn(),
  }
})

/** The props each KeyboardAvoidingView render received, newest last. */
const keyboardViews = vi.hoisted(() => [] as { enabled?: boolean; behavior?: string }[])

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNative>()
  const { recordModalProps } = await vi.importActual<typeof EdgeToEdgeTestUtils>(
    '@/src/test-utils/edge-to-edge-modal'
  )
  const RealKeyboardView = actual.KeyboardAvoidingView as unknown as React.ComponentType<
    Record<string, unknown>
  >
  return {
    ...actual,
    Modal: recordModalProps(actual.Modal),
    KeyboardAvoidingView: (props: Record<string, unknown>) => {
      keyboardViews.push(props)
      return createElement(RealKeyboardView, props)
    },
    Keyboard: {
      ...actual.Keyboard,
      isVisible: () => false,
      addListener: keyboard.addListener,
    },
    findNodeHandle: (node: unknown) => (node ? a11y.tagOf(node) : null),
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: a11y.setAccessibilityFocus,
    },
  }
})
vi.mock('react-native-safe-area-context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { TEST_SAFE_AREA_INSETS: insets } = await vi.importActual<
    typeof EdgeToEdgeTestUtils
  >('@/src/test-utils/edge-to-edge-modal')
  return { ...actual, useSafeAreaInsets: () => insets }
})

const { Pressable, ScrollView, Text, TextInput, View } = ReactNative

/** D13 made both required; the R52 and R57 cases need neither. */
const LAYER = { onRequestClose: () => undefined, returnFocusRef: null }

function Insets({ keyboardOpen }: { keyboardOpen?: boolean }) {
  const { top, bottom } = useModalInsets(keyboardOpen)
  return <Text testID="insets">{`${top}/${bottom}`}</Text>
}

beforeEach(() => {
  modalRenders.length = 0
  keyboardViews.length = 0
})

describe('R52 EdgeToEdgeModal', () => {
  it('is a transparent modal whose window covers the status and navigation bars', () => {
    render(
      <EdgeToEdgeModal {...LAYER} visible animationType="slide">
        <Text>Sheet</Text>
      </EdgeToEdgeModal>
    )
    expect(screen.getByText('Sheet')).toBeTruthy()
    expect(lastModalProps()).toMatchObject({
      ...EDGE_TO_EDGE_MODAL_PROPS,
      transparent: true,
      visible: true,
      animationType: 'slide',
    })
  })

  it('7.7-NAT-005 opens instantly under reduced motion, whatever presentation the caller asked for', () => {
    motion.reduced = true
    try {
      render(
        <EdgeToEdgeModal {...LAYER} visible animationType="slide">
          <Text>Sheet</Text>
        </EdgeToEdgeModal>
      )
      expect(lastModalProps()).toMatchObject({ animationType: 'none', visible: true })
    } finally {
      motion.reduced = false
    }
  })

  it('7.7-NAT-005 keeps the animation a presentation opened with when the setting resolves meanwhile (CodeRabbit r1 #16)', () => {
    motion.reduced = true
    try {
      const sheet = (visible: boolean) => (
        <EdgeToEdgeModal {...LAYER} visible={visible} animationType="fade">
          <Text>Sheet</Text>
        </EdgeToEdgeModal>
      )
      const view = render(sheet(true))
      expect(lastModalProps()).toMatchObject({ animationType: 'none' })

      // The setting resolves to motion allowed while the sheet is up: it stays instant.
      motion.reduced = false
      view.rerender(sheet(true))
      expect(lastModalProps()).toMatchObject({ animationType: 'none', visible: true })

      // Closed, then opened again: this presentation uses the resolved setting.
      view.rerender(sheet(false))
      view.rerender(sheet(true))
      expect(lastModalProps()).toMatchObject({ animationType: 'fade', visible: true })
    } finally {
      motion.reduced = false
    }
  })

  it('7.7-NAT-005 an opening uses the setting as it is at that render, even when it changed while hidden (CodeRabbit r2 #3)', () => {
    motion.reduced = true
    try {
      const sheet = (visible: boolean) => (
        <EdgeToEdgeModal {...LAYER} visible={visible} animationType="fade">
          <Text>Sheet</Text>
        </EdgeToEdgeModal>
      )
      const view = render(sheet(false))
      expect(lastModalProps()).toMatchObject({ animationType: 'none', visible: false })

      // The setting resolves and the sheet opens in the same render: this opening fades.
      motion.reduced = false
      view.rerender(sheet(true))
      expect(lastModalProps()).toMatchObject({ animationType: 'fade', visible: true })

      // It keeps that animation for the rest of the presentation.
      motion.reduced = true
      view.rerender(sheet(true))
      expect(lastModalProps()).toMatchObject({ animationType: 'fade', visible: true })
    } finally {
      motion.reduced = false
    }
  })

  it('keeps both translucent flags for an opaque full-screen page', () => {
    render(
      <EdgeToEdgeModal {...LAYER} visible transparent={false}>
        <Text>Page</Text>
      </EdgeToEdgeModal>
    )
    expect(lastModalProps()).toMatchObject({
      ...EDGE_TO_EDGE_MODAL_PROPS,
      transparent: false,
    })
  })

  it('gives the bottom inset while the keyboard is down and none while it is up', () => {
    const { rerender } = render(<Insets />)
    expect(screen.getByTestId('insets').textContent).toBe(
      `${TEST_SAFE_AREA_INSETS.top}/${TEST_SAFE_AREA_INSETS.bottom}`
    )
    rerender(<Insets keyboardOpen />)
    expect(screen.getByTestId('insets').textContent).toBe(
      `${TEST_SAFE_AREA_INSETS.top}/0`
    )
  })
})

/**
 * R57/R61: the translucent flags make the Android dialog edge to edge, so its window no
 * longer resizes for the keyboard. The capsule builder's garment list sat under Gboard
 * in CI (job 120835242721). The wrapper now lifts every sheet's content itself.
 */
describe('R57 EdgeToEdgeModal over the software keyboard', () => {
  afterEach(() => {
    Object.defineProperty(ReactNative.Platform, 'OS', {
      value: 'web',
      configurable: true,
    })
  })

  /**
   * Story 6.15 review P2-2: a view with accessibilityViewIsModal hides every other view from
   * VoiceOver and from the XCUITest hierarchy Maestro reads, so the modal's mount marker goes
   * inside it; next to it, the iOS composer capture saw no marker at all.
   */
  it('puts the mount marker inside the content view that is the accessibility modal', () => {
    render(
      <EdgeToEdgeModal {...LAYER} visible>
        <ReactNative.View testID="sheet" accessibilityViewIsModal>
          <Text>Composer</Text>
        </ReactNative.View>
      </EdgeToEdgeModal>
    )
    const marker = document.querySelector('[data-testid^="live-font-mount-modal-"]')
    expect(marker).not.toBeNull()
    expect(screen.getByTestId('sheet').contains(marker)).toBe(true)
    expect(screen.getByText('Composer')).toBeTruthy()
  })

  it('finds the accessibility modal view inside an overlay wrapper, a fragment or an array', () => {
    const shapes = {
      wrapper: (
        <ReactNative.View testID="overlay">
          <ReactNative.View testID="sheet" accessibilityViewIsModal>
            <Text>Sheet</Text>
          </ReactNative.View>
        </ReactNative.View>
      ),
      fragment: (
        <>
          <ReactNative.View testID="backdrop" />
          <ReactNative.View testID="sheet" accessibilityViewIsModal />
        </>
      ),
      array: [
        <ReactNative.View key="a" testID="backdrop" />,
        <ReactNative.View key="b" testID="sheet" accessibilityViewIsModal />,
      ],
    }
    for (const [shape, children] of Object.entries(shapes)) {
      const view = render(
        <EdgeToEdgeModal {...LAYER} visible>
          {children}
        </EdgeToEdgeModal>
      )
      const marker = document.querySelector('[data-testid^="live-font-mount-modal-"]')
      expect(screen.getByTestId('sheet').contains(marker), shape).toBe(true)
      expect(liveFontMarkerPlacement(), shape).toEqual({
        markerInside: true,
        host: 'sheet',
      })
      view.unmount()
    }
  })

  // Story 6.16 R4: written children (a spacer and a sheet, no keys) must stay static
  // children after the marker goes in. A rebuilt array reads as an unkeyed list, and React
  // Native logs a key error for it (react-dom in this test runner logs none, so the shape
  // is checked directly).
  it('returns written children with the marker as static children, never as a list', () => {
    const written = [
      <ReactNative.View testID="spacer" />,
      <ReactNative.View testID="sheet" accessibilityViewIsModal />,
    ]
    const result = withModalMarker(written)
    expect(Array.isArray(result)).toBe(false)
    expect(isValidElement(result) && result.type).toBe(Fragment)
    render(
      <EdgeToEdgeModal {...LAYER} visible>
        {written}
      </EdgeToEdgeModal>
    )
    expect(liveFontMarkerPlacement()).toEqual({ markerInside: true, host: 'sheet' })
  })

  it('keeps the mount marker beside content that is not an accessibility modal', () => {
    render(
      <EdgeToEdgeModal {...LAYER} visible>
        <ReactNative.View testID="plain" />
      </EdgeToEdgeModal>
    )
    expect(
      document.querySelector('[data-testid^="live-font-mount-modal-"]')
    ).not.toBeNull()
    expect(liveFontMarkerPlacement().markerInside).toBe(false)
  })

  it('puts the content, its fields included, inside the keyboard view', () => {
    render(
      <EdgeToEdgeModal {...LAYER} visible>
        <TextInput testID="field" />
      </EdgeToEdgeModal>
    )
    const keyboardView = screen.getByTestId('edge-to-edge-modal-keyboard-view')
    expect(keyboardView.contains(screen.getByTestId('field'))).toBe(true)
    expect(getComputedStyle(keyboardView).flexGrow).toBe('1')
  })

  it('dims the whole screen from the layer that holds the keyboard view', () => {
    render(
      <EdgeToEdgeModal {...LAYER} visible scrim="rgba(0, 0, 0, 0.6)" scrimTestID="scrim">
        <Text>Sheet</Text>
      </EdgeToEdgeModal>
    )
    const scrim = screen.getByTestId('scrim')
    const keyboardView = screen.getByTestId('edge-to-edge-modal-keyboard-view')
    expect(getComputedStyle(scrim).backgroundColor).toBe('rgba(0, 0, 0, 0.6)')
    expect(getComputedStyle(scrim).flexGrow).toBe('1')
    // The keyboard view shrinks inside the scrim, so no undimmed screen shows below it.
    expect(keyboardView.parentElement).toBe(scrim)
    expect(getComputedStyle(keyboardView).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })

  it.each([
    ['android', 'height', 'keyboardDidShow', 'keyboardDidHide', [false, true, false]],
    ['ios', 'padding', 'keyboardWillShow', 'keyboardWillHide', [true, true, true]],
  ] as const)(
    'on %s lifts the content with %s only while a keyboard needs avoiding',
    (os, behavior, shown, hidden, [closed, open, reclosed]) => {
      Object.defineProperty(ReactNative.Platform, 'OS', { value: os, configurable: true })
      render(
        <EdgeToEdgeModal {...LAYER} visible>
          <TextInput />
        </EdgeToEdgeModal>
      )
      expect(keyboardViews.at(-1)).toMatchObject({ behavior, enabled: closed })
      act(() => keyboard.emit(shown))
      expect(keyboardViews.at(-1)).toMatchObject({ behavior, enabled: open })
      act(() => keyboard.emit(hidden))
      expect(keyboardViews.at(-1)).toMatchObject({ behavior, enabled: reclosed })
    }
  )

  it('drops the bottom inset while the keyboard is up when the caller does not track it', () => {
    render(<Insets />)
    expect(screen.getByTestId('insets').textContent).toBe(
      `${TEST_SAFE_AREA_INSETS.top}/${TEST_SAFE_AREA_INSETS.bottom}`
    )
    act(() => keyboard.emit('keyboardDidShow'))
    expect(screen.getByTestId('insets').textContent).toBe(
      `${TEST_SAFE_AREA_INSETS.top}/0`
    )
    act(() => keyboard.emit('keyboardDidHide'))
    expect(screen.getByTestId('insets').textContent).toBe(
      `${TEST_SAFE_AREA_INSETS.top}/${TEST_SAFE_AREA_INSETS.bottom}`
    )
  })
})

// Shard 3, run 43800364098: under the share card composer, Home's text stayed in the iOS
// accessibility tree (the audit's Vision listing found current-temperature where the composer
// draws "Preparing card"). While any EdgeToEdgeModal is up, the screen under it leaves the tree.
describe('the screen under an open EdgeToEdgeModal', () => {
  function Probe() {
    const open = useEdgeToEdgeModalOpen()
    return <Text testID="modal-open">{String(open)}</Text>
  }

  it('reports a modal open while one is visible, through two at once, and none after', () => {
    const view = render(
      <>
        <Probe />
        <EdgeToEdgeModal {...LAYER} visible={false}>
          <Text>first</Text>
        </EdgeToEdgeModal>
      </>
    )
    expect(screen.getByTestId('modal-open')).toHaveTextContent('false')
    const both = (first: boolean, second: boolean) => (
      <>
        <Probe />
        <EdgeToEdgeModal {...LAYER} visible={first}>
          <Text>first</Text>
        </EdgeToEdgeModal>
        <EdgeToEdgeModal {...LAYER} visible={second}>
          <Text>second</Text>
        </EdgeToEdgeModal>
      </>
    )
    view.rerender(both(true, false))
    expect(screen.getByTestId('modal-open')).toHaveTextContent('true')
    view.rerender(both(true, true))
    view.rerender(both(false, true))
    expect(screen.getByTestId('modal-open')).toHaveTextContent('true')
    view.rerender(both(false, false))
    expect(screen.getByTestId('modal-open')).toHaveTextContent('false')
    view.rerender(both(true, false))
    view.unmount()
    const after = render(<Probe />)
    expect(after.getByTestId('modal-open')).toHaveTextContent('false')
  })

  it('hides the screen from VoiceOver and TalkBack only while a modal is open, never on web', () => {
    expect(underModalAccessibility(true, 'ios')).toEqual({
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    })
    expect(underModalAccessibility(true, 'android')).toEqual({
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    })
    for (const os of ['ios', 'android'] as const)
      expect(underModalAccessibility(false, os)).toEqual({
        accessibilityElementsHidden: false,
        importantForAccessibility: 'auto',
      })
    // The web modal is a portal outside the app root; testing-library and the browser keep the
    // root readable.
    expect(underModalAccessibility(true, 'web')).toEqual({})
  })
})

/**
 * Story CC-7.11 D13: every layer closes by system back (`onRequestClose`, which Android's back
 * button and the iOS accessibility escape call on the native Modal) and by a downward swipe on its
 * header, and the control that opened it takes accessibility focus back once it closes. These run
 * the native focus path (Android): react-native-web would also refocus the element that had DOM
 * focus when the modal opened, which would hide a missing `returnFocusRef`.
 */
describe('Story CC-7.11 D13 EdgeToEdgeModal closes like a layer', () => {
  beforeEach(() => {
    a11y.tags.clear()
    a11y.setAccessibilityFocus.mockClear()
    Object.defineProperty(ReactNative.Platform, 'OS', {
      value: 'android',
      configurable: true,
    })
  })
  afterEach(() => {
    Object.defineProperty(ReactNative.Platform, 'OS', {
      value: 'web',
      configurable: true,
    })
  })

  /** An opener, and the layer it opened: a header (title and X) that is the swipe handle. */
  function OpenedLayer({ onRequestClose }: { onRequestClose: () => void }) {
    const opener = useRef<ComponentRef<typeof Pressable>>(null)
    const [open, setOpen] = useState(true)
    const close = () => {
      onRequestClose()
      setOpen(false)
    }
    return (
      <>
        <Pressable
          ref={opener}
          testID="opener"
          accessibilityRole="button"
          onPress={() => setOpen(true)}
        >
          <Text>Open the layer</Text>
        </Pressable>
        <EdgeToEdgeModal visible={open} onRequestClose={close} returnFocusRef={opener}>
          <View testID="layer" accessibilityViewIsModal>
            <LayerSwipeHandle>
              <Text testID="layer-title">Layer title</Text>
              <Pressable testID="layer-close" accessibilityRole="button" onPress={close}>
                <Text>X</Text>
              </Pressable>
            </LayerSwipeHandle>
            <ScrollView testID="layer-body">
              <Text>Layer body</Text>
            </ScrollView>
          </View>
        </EdgeToEdgeModal>
      </>
    )
  }

  /** The layer has gone and the opener holds accessibility focus, focused once. */
  async function expectClosedWithFocusOnOpener() {
    await waitFor(() => expect(screen.queryByTestId('layer')).toBeNull())
    const openerTag = a11y.tagOf(screen.getByTestId('opener'))
    await waitFor(() =>
      expect(a11y.setAccessibilityFocus).toHaveBeenLastCalledWith(openerTag)
    )
    expect(
      a11y.setAccessibilityFocus.mock.calls.filter(([tag]) => tag === openerTag)
    ).toHaveLength(1)
  }

  it('[7.11-NAT-030] onRequestClose is a required prop', () => {
    const layers = [
      // @ts-expect-error D13: a layer without onRequestClose would ignore Android back.
      <EdgeToEdgeModal key="no-close" visible returnFocusRef={null}>
        <Text>Sheet</Text>
      </EdgeToEdgeModal>,
    ]
    // The guard is the type check (tsc runs over this file); the element stays unrendered.
    // returnFocusRef is optional in the type since 08fb51ce (the iPad-pinned share-card
    // composer omits it); 7.11-NAT-034's source scan requires it at every other caller.
    expect(layers).toHaveLength(1)
  })

  it('[7.11-NAT-030] Android back closes the layer through onRequestClose and focus returns to the opener', async () => {
    const onRequestClose = vi.fn()
    render(<OpenedLayer onRequestClose={onRequestClose} />)
    expect(screen.getByTestId('layer')).toBeTruthy()
    const modal = lastModalProps()
    expect(modal?.onRequestClose).toBeTypeOf('function')
    expect(a11y.setAccessibilityFocus).not.toHaveBeenCalled()

    // What the native Modal calls on the hardware back button.
    act(() => (modal!.onRequestClose as () => void)())

    expect(onRequestClose).toHaveBeenCalledTimes(1)
    await expectClosedWithFocusOnOpener()
  })

  it('[7.11-NAT-031] the X closes the layer and the opener receives accessibility focus after it closes', async () => {
    const onRequestClose = vi.fn()
    render(<OpenedLayer onRequestClose={onRequestClose} />)
    // Nothing moves focus to the opener while the layer is up.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    expect(a11y.setAccessibilityFocus).not.toHaveBeenCalled()

    press(screen.getByTestId('layer-close'))

    expect(onRequestClose).toHaveBeenCalledTimes(1)
    await expectClosedWithFocusOnOpener()
  })

  it('[7.11-NAT-032] a swipe down past the threshold on the header closes the layer and focus returns to the opener', async () => {
    const onRequestClose = vi.fn()
    render(<OpenedLayer onRequestClose={onRequestClose} />)

    // Started on the title: the handle captures a drag that begins on anything inside it.
    await dragFrom(screen.getByTestId('layer-title'), { dy: LAYER_SWIPE_CLOSE_PX + 40 })

    expect(onRequestClose).toHaveBeenCalledTimes(1)
    await expectClosedWithFocusOnOpener()
  })

  it.each([
    ['a short drag down', { dy: LAYER_SWIPE_CLOSE_PX / 2 }],
    ['an upward drag', { dy: -(LAYER_SWIPE_CLOSE_PX + 40) }],
    [
      'a drag more across than down',
      { dx: LAYER_SWIPE_CLOSE_PX * 2, dy: LAYER_SWIPE_CLOSE_PX + 20 },
    ],
  ])('[7.11-NAT-033] %s on the header leaves the layer open', async (_name, drag) => {
    const onRequestClose = vi.fn()
    render(<OpenedLayer onRequestClose={onRequestClose} />)

    await dragFrom(screen.getByTestId('layer-swipe-handle'), drag)
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })

    expect(onRequestClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('layer')).toBeTruthy()
    expect(a11y.setAccessibilityFocus).not.toHaveBeenCalled()
    // Positive twin: the same handle still closes on a full swipe, so the drags above reached it.
    await dragFrom(screen.getByTestId('layer-swipe-handle'), {
      dy: LAYER_SWIPE_CLOSE_PX + 40,
    })
    expect(onRequestClose).toHaveBeenCalledTimes(1)
    await expectClosedWithFocusOnOpener()
  })

  it('[7.11-NAT-033] the close rule: 80 px or more down, and more down than across', () => {
    expect(LAYER_SWIPE_CLOSE_PX).toBe(80)
    expect(layerSwipeCloses(0, 80)).toBe(true)
    expect(layerSwipeCloses(79, 80)).toBe(true)
    expect(layerSwipeCloses(0, 79)).toBe(false)
    expect(layerSwipeCloses(80, 80)).toBe(false)
    expect(layerSwipeCloses(-120, 100)).toBe(false)
    expect(layerSwipeCloses(0, -200)).toBe(false)
  })
})

/**
 * 7.11-NAT-034: every EdgeToEdgeModal in the app passes `onRequestClose` and `returnFocusRef`.
 * The type check already refuses a missing prop; this scan also holds the documented exception: a
 * caller that passes `returnFocusRef={null}` says on the line above who returns focus instead. No
 * app file presents a react-native Modal of its own, so no layer skips the wrapper.
 */
describe('[7.11-NAT-034] every EdgeToEdgeModal caller', () => {
  // Vite expands this glob when it serves the test; tsc reads the app as CommonJS, where
  // `import.meta` has no meaning (TS1470).
  // @ts-expect-error TS1470: the expression is Vite's, never CommonJS output.
  const sources: Record<string, string> = import.meta.glob(
    [
      '../app/**/*.{ts,tsx}',
      './**/*.{ts,tsx}',
      '../src/**/*.{ts,tsx}',
      '!**/*.test.{ts,tsx}',
      '!**/*.spec.{ts,tsx}',
      '!**/*.test-*.{ts,tsx}',
      '!../src/test-utils/**',
    ],
    { query: '?raw', import: 'default', eager: true }
  )

  /**
   * Where a comment that starts at `at` ends (its last character), or `at` itself when none
   * starts there. A comment between props ("the screen's ...") holds no quote or brace.
   */
  function commentEnd(source: string, at: number): number {
    const pair = source.slice(at, at + 2)
    if (pair === '//') {
      const end = source.indexOf('\n', at)
      return end === -1 ? source.length : end
    }
    if (pair === '/*') {
      const end = source.indexOf('*/', at + 2)
      return end === -1 ? source.length : end + 1
    }
    return at
  }

  /** Where the opening tag that starts at `start` ends: its `>` outside braces and strings. */
  function tagEnd(source: string, start: number): number {
    let depth = 0
    let quote: string | null = null
    for (let at = start; at < source.length; at += 1) {
      const char = source[at]
      if (quote) {
        if (char === quote && source[at - 1] !== '\\') quote = null
        continue
      }
      const skipped = commentEnd(source, at)
      if (skipped !== at) at = skipped
      else if (char === '"' || char === "'" || char === '`') quote = char
      else if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      else if (char === '>' && depth === 0) return at
    }
    return source.length
  }

  /** The text of each `<EdgeToEdgeModal ...>` opening tag in `source`, braces and strings kept. */
  function openingTags(source: string): { tag: string; line: number }[] {
    return [...source.matchAll(/<EdgeToEdgeModal\b/g)].map((match) => ({
      tag: source.slice(match.index, tagEnd(source, match.index + match[0].length) + 1),
      line: source.slice(0, match.index).split('\n').length,
    }))
  }

  const usages = Object.entries(sources).flatMap(([file, source]) =>
    openingTags(source).map((usage) => ({ ...usage, where: `${file}:${usage.line}` }))
  )

  it('finds the app layers it guards (the scan is not vacuous)', () => {
    const files = new Set(usages.map((usage) => usage.where.replace(/:\d+$/, '')))
    for (const known of [
      './home/today-outfit-picture.tsx',
      './share-card-composer.tsx',
      './community/community-spotlight-detail.tsx',
      './community/community-post-sheet.tsx',
      './wardrobe/garment-capture-modal.tsx',
      '../src/features/wardrobe/style-piece-panel.tsx',
      '../src/features/wardrobe/closet-top-bar.tsx',
      '../src/features/preview/guest-preview-parts.tsx',
    ])
      expect(files, known).toContain(known)
    // Story CC-7.12 D5, D8: the saved look detail left the Closet row's layer for its own stack
    // screen (`saved-look/[savedLookId]`), so the row's usage is gone and twelve layers remain.
    expect(files).not.toContain('../src/features/wardrobe/saved-looks-row.tsx')
    expect(usages.length).toBeGreaterThanOrEqual(12)
  })

  it('passes onRequestClose and returnFocusRef at every usage, and says who refocuses where the ref is null', () => {
    // The one exemption (spec Plan Change Log, builder 08fb51ce): the share-card composer is
    // pinned byte for byte by the iPad anchor proof, so it keeps its CC-7.9 shape: system back
    // through onRequestClose and its own focus restore in onDismiss, no returnFocusRef.
    const PINNED = ['./share-card-composer.tsx']
    expect(usages.some(({ where }) => where.startsWith(PINNED[0]!))).toBe(true)
    const missing = usages
      .filter(({ where, tag }) => {
        if (!/\bonRequestClose=\{/.test(tag)) return true
        if (PINNED.some((file) => where.startsWith(file)))
          return !/\bonDismiss=\{/.test(tag)
        return !/\breturnFocusRef=\{/.test(tag)
      })
      .map(({ where }) => where)
    expect(missing).toEqual([])

    const unexplainedNull = usages
      .filter(({ tag }) => {
        const lines = tag.split('\n')
        const index = lines.findIndex((line) => /\breturnFocusRef=\{null\}/.test(line))
        if (index === -1) return false
        const above = (lines[index - 1] ?? '').trim()
        return !(
          above.startsWith('//') ||
          above.startsWith('{/*') ||
          above.endsWith('*/}')
        )
      })
      .map(({ where }) => where)
    expect(unexplainedNull).toEqual([])
  })

  it('leaves no app file presenting a react-native Modal of its own', () => {
    const importsModal = /import\s*\{([^}]*)\}\s*from\s*['"]react-native['"]/g
    const offenders = Object.entries(sources)
      .filter(([file]) => file !== './edge-to-edge-modal.tsx')
      .filter(([, source]) =>
        [...source.matchAll(importsModal)].some((match) =>
          /(^|[\s,])Modal([\s,]|$)/.test(match[1] ?? '')
        )
      )
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })
})
