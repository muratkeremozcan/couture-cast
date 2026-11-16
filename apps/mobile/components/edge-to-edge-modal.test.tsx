// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import React, { Fragment, createElement, isValidElement } from 'react'
import { act, render, screen } from '@testing-library/react'
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
import {
  EdgeToEdgeModal,
  underModalAccessibility,
  useEdgeToEdgeModalOpen,
  useModalInsets,
  withModalMarker,
} from './edge-to-edge-modal'

/**
 * react-native-web never reports a software keyboard, so the R57 cases drive the
 * platform's keyboard events through these listeners.
 */
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
  }
})
vi.mock('react-native-safe-area-context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { TEST_SAFE_AREA_INSETS: insets } = await vi.importActual<
    typeof EdgeToEdgeTestUtils
  >('@/src/test-utils/edge-to-edge-modal')
  return { ...actual, useSafeAreaInsets: () => insets }
})

const { Text, TextInput } = ReactNative

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
      <EdgeToEdgeModal visible animationType="slide">
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

  it('keeps both translucent flags for an opaque full-screen page', () => {
    render(
      <EdgeToEdgeModal visible transparent={false}>
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
      <EdgeToEdgeModal visible>
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
      const view = render(<EdgeToEdgeModal visible>{children}</EdgeToEdgeModal>)
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
    render(<EdgeToEdgeModal visible>{written}</EdgeToEdgeModal>)
    expect(liveFontMarkerPlacement()).toEqual({ markerInside: true, host: 'sheet' })
  })

  it('keeps the mount marker beside content that is not an accessibility modal', () => {
    render(
      <EdgeToEdgeModal visible>
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
      <EdgeToEdgeModal visible>
        <TextInput testID="field" />
      </EdgeToEdgeModal>
    )
    const keyboardView = screen.getByTestId('edge-to-edge-modal-keyboard-view')
    expect(keyboardView.contains(screen.getByTestId('field'))).toBe(true)
    expect(getComputedStyle(keyboardView).flexGrow).toBe('1')
  })

  it('dims the whole screen from the layer that holds the keyboard view', () => {
    render(
      <EdgeToEdgeModal visible scrim="rgba(0, 0, 0, 0.6)" scrimTestID="scrim">
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
        <EdgeToEdgeModal visible>
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
        <EdgeToEdgeModal visible={false}>
          <Text>first</Text>
        </EdgeToEdgeModal>
      </>
    )
    expect(screen.getByTestId('modal-open')).toHaveTextContent('false')
    const both = (first: boolean, second: boolean) => (
      <>
        <Probe />
        <EdgeToEdgeModal visible={first}>
          <Text>first</Text>
        </EdgeToEdgeModal>
        <EdgeToEdgeModal visible={second}>
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
