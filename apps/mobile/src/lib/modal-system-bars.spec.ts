/// <reference types="vite/client" />
import { expect, it, vi } from 'vitest'
import kotlinModuleSource from '../../modules/modal-system-bars/android/src/main/java/expo/modules/modalsystembars/ModalSystemBarsModule.kt?raw'
const boundary = vi.hoisted(() => ({
  present: false,
  kotlinName: '',
  requested: [] as string[],
  set: vi.fn(() => Promise.resolve(true)),
}))
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => {
    boundary.requested.push(name)
    return boundary.present && name === boundary.kotlinName
      ? { setDarkStatusBar: boundary.set }
      : null
  },
}))
import * as native from '../../modules/modal-system-bars/index.native'
import * as fallback from '../../modules/modal-system-bars/index'
boundary.kotlinName = /\bName\("([^"]+)"\)/.exec(kotlinModuleSource)?.[1] ?? ''
it('uses only the optional native window module and exposes a safe older-client fallback', async () => {
  expect(boundary.kotlinName).toBe('ModalSystemBars')
  boundary.present = false
  expect(native.modalSystemBarsAvailable()).toBe(false)
  expect(native.setModalDarkStatusBar(41)).toBeNull()
  expect(fallback.modalSystemBarsAvailable()).toBe(false)
  expect(fallback.setModalDarkStatusBar(41)).toBeNull()
  boundary.present = true
  expect(native.modalSystemBarsAvailable()).toBe(true)
  expect(await native.setModalDarkStatusBar(41)).toBe(true)
  expect(boundary.set).toHaveBeenCalledExactlyOnceWith(41)
  expect(new Set(boundary.requested)).toEqual(new Set([boundary.kotlinName]))
})
