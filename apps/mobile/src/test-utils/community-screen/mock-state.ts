import type { createElement } from 'react'
import { vi } from 'vitest'

// Factories import this module locally after the entrypoint registers every mock.
export const routing = {
  params: {} as Record<string, string>,
  router: { setParams: vi.fn(), push: vi.fn() },
}

export const mockCapture = vi.fn()
export const mockAnalytics = {
  capture: mockCapture,
  getDistinctId: () => 'test-user-id',
  screen: vi.fn(),
}

export const imagePicker = {
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}
export const imageManipulator = { manipulateAsync: vi.fn() }
export const imageEvents = {
  errors: new Map<string, () => void>(),
  createElement: null as unknown as typeof createElement,
}
/** The list's pull-to-refresh handler, which react-native-web renders no gesture for. */
export const refreshEvents = { onRefresh: undefined as (() => void) | undefined }
