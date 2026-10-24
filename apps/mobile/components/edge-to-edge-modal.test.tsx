import React, { createElement } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as EdgeToEdgeTestUtils from '@/src/test-utils/edge-to-edge-modal'
import * as ReactNative from 'react-native'
import {
  EDGE_TO_EDGE_MODAL_PROPS,
  TEST_SAFE_AREA_INSETS,
  lastModalProps,
  modalRenders,
} from '@/src/test-utils/edge-to-edge-modal'
import { EdgeToEdgeModal, useModalInsets } from './edge-to-edge-modal'

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

  it('dims the whole screen from its own layer behind the keyboard view', () => {
    render(
      <EdgeToEdgeModal visible scrim="rgba(0, 0, 0, 0.6)" scrimTestID="scrim">
        <Text>Sheet</Text>
      </EdgeToEdgeModal>
    )
    const scrim = screen.getByTestId('scrim')
    const keyboardView = screen.getByTestId('edge-to-edge-modal-keyboard-view')
    expect(getComputedStyle(scrim).backgroundColor).toBe('rgba(0, 0, 0, 0.6)')
    expect(getComputedStyle(scrim).position).toBe('absolute')
    expect(getComputedStyle(scrim).pointerEvents).toBe('none')
    // A sibling: the keyboard view can shrink without uncovering any undimmed screen.
    expect(scrim.contains(keyboardView)).toBe(false)
    expect(scrim.parentElement).toBe(keyboardView.parentElement)
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
