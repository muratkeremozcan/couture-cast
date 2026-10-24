import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ReactNativeModule from 'react-native'
import type * as EdgeToEdgeTestUtils from '@/src/test-utils/edge-to-edge-modal'
import { Text } from 'react-native'
import {
  EDGE_TO_EDGE_MODAL_PROPS,
  TEST_SAFE_AREA_INSETS,
  lastModalProps,
  modalRenders,
} from '@/src/test-utils/edge-to-edge-modal'
import { EdgeToEdgeModal, useModalInsets } from './edge-to-edge-modal'

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  const { recordModalProps } = await vi.importActual<typeof EdgeToEdgeTestUtils>(
    '@/src/test-utils/edge-to-edge-modal'
  )
  return { ...actual, Modal: recordModalProps(actual.Modal) }
})
vi.mock('react-native-safe-area-context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { TEST_SAFE_AREA_INSETS: insets } = await vi.importActual<
    typeof EdgeToEdgeTestUtils
  >('@/src/test-utils/edge-to-edge-modal')
  return { ...actual, useSafeAreaInsets: () => insets }
})

function Insets({ keyboardOpen }: { keyboardOpen?: boolean }) {
  const { top, bottom } = useModalInsets(keyboardOpen)
  return <Text testID="insets">{`${top}/${bottom}`}</Text>
}

beforeEach(() => {
  modalRenders.length = 0
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
