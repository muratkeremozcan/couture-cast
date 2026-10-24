// Story 6.7: the native build of the accessibility-focus wrapper. The module is
// faked at expo-modules-core, the only native boundary the wrapper has.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as NativeWrapper from '../../modules/accessibility-focus/index.native.js'

const native = vi.hoisted(() => ({ module: null as Record<string, unknown> | null }))
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => native.module,
}))

async function wrapper(): Promise<typeof NativeWrapper> {
  return import('../../modules/accessibility-focus/index.native.js')
}

function fakeModule(overrides: Record<string, unknown> = {}) {
  const remove = vi.fn()
  return {
    remove,
    module: {
      canObserveFocus: true,
      focus: vi.fn().mockResolvedValue(true),
      addListener: vi.fn(() => ({ remove })),
      ...overrides,
    },
  }
}

afterEach(() => {
  native.module = null
})

describe('6.7 accessibility-focus native wrapper', () => {
  it('6.7-MOB-055 without the module (Expo Go) it neither observes nor moves focus', async () => {
    const { observeAccessibilityFocus, focusAccessibilityElement } = await wrapper()
    expect(observeAccessibilityFocus(() => undefined)).toBeNull()
    expect(focusAccessibilityElement(574)).toBeNull()
  })

  it('6.7-MOB-056 a module that cannot observe on this Android version reports no observer, and still moves focus', async () => {
    const fake = fakeModule({ canObserveFocus: false })
    native.module = fake.module
    const { observeAccessibilityFocus, focusAccessibilityElement } = await wrapper()
    expect(observeAccessibilityFocus(() => undefined)).toBeNull()
    expect(fake.module.addListener).not.toHaveBeenCalled()
    await expect(focusAccessibilityElement(574)).resolves.toBe(true)
  })

  it('6.7-MOB-057 a module that can observe subscribes and unsubscribes', async () => {
    const fake = fakeModule()
    native.module = fake.module
    const { observeAccessibilityFocus } = await wrapper()
    const listener = vi.fn()
    const stop = observeAccessibilityFocus(listener)
    expect(fake.module.addListener).toHaveBeenCalledWith(
      'onAccessibilityFocusChange',
      listener
    )
    stop?.()
    expect(fake.remove).toHaveBeenCalledTimes(1)
  })
})
