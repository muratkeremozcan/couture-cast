import { expect, it, vi } from 'vitest'
const boundary = vi.hoisted(() => ({
  present: false,
  set: vi.fn(() => Promise.resolve(true)),
}))
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () =>
    boundary.present ? { setDarkStatusBar: boundary.set } : null,
}))
import * as native from '../../modules/modal-system-bars/index.native'
import * as fallback from '../../modules/modal-system-bars/index'
it('uses only the optional native window module and exposes a safe older-client fallback', async () => {
  boundary.present = false
  expect(native.modalSystemBarsAvailable()).toBe(false)
  expect(native.setModalDarkStatusBar(41)).toBeNull()
  expect(fallback.modalSystemBarsAvailable()).toBe(false)
  expect(fallback.setModalDarkStatusBar(41)).toBeNull()
  boundary.present = true
  expect(native.modalSystemBarsAvailable()).toBe(true)
  expect(await native.setModalDarkStatusBar(41)).toBe(true)
  expect(boundary.set).toHaveBeenCalledExactlyOnceWith(41)
})
