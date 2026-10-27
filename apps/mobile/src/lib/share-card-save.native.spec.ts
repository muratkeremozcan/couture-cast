/// <reference types="vite/client" />
import { Platform } from 'react-native'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preparedShareCardFixture as card } from '@couture/api-client/testing/share-card-fixture'
import swiftModuleSource from '../../modules/share-card-photo-save/ios/ShareCardPhotoSaveModule.swift?raw'
const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  getPermission: vi.fn(),
  requestPermission: vi.fn(),
  nativeSave: vi.fn(),
  originalSave: vi.fn(),
  photoSaveName: '',
  write: vi.fn(),
  remove: vi.fn(),
  readDirectory: vi.fn(),
  uuid: 0,
  fixture: 'real',
  mediaAvailable: true,
  originalAvailable: false,
}))
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => {
    if (name === 'ExpoMediaLibrary') return mocks.mediaAvailable ? {} : null
    return name === mocks.photoSaveName && mocks.originalAvailable
      ? { saveOriginalPng: mocks.originalSave }
      : null
  },
}))
// Vite resolves the browser index; native code loads index.native, which requests the module by name.
vi.mock(
  '../../modules/share-card-photo-save',
  () => import('../../modules/share-card-photo-save/index.native')
)
vi.mock('./share-card-native-fixture', () => ({
  shareCardFixtureMode: () => mocks.fixture,
  runShareCardNativeAdapter: (_uri: string, save: () => Promise<void>) => save(),
}))
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: (_algorithm: string, bytes: Uint8Array<ArrayBuffer>) =>
    crypto.subtle.digest('SHA-256', bytes),
  randomUUID: () => `00000000-0000-4000-8000-${String(++mocks.uuid).padStart(12, '0')}`,
}))
vi.mock('expo-media-library', () => ({
  getPermissionsAsync: mocks.getPermission,
  requestPermissionsAsync: mocks.requestPermission,
  saveToLibraryAsync: mocks.nativeSave,
}))
vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: () => Promise.resolve(),
  writeAsStringAsync: mocks.write,
  deleteAsync: mocks.remove,
  getInfoAsync: (uri: string) =>
    Promise.resolve({ exists: uri.endsWith('/') || mocks.files.has(uri) }),
  readDirectoryAsync: mocks.readDirectory,
}))
import {
  nativeShareCardSaveAvailable,
  saveShareCard,
  shareCardSavePermission,
  cleanOrphanShareCards,
} from './share-card-save.native'
import {
  liveShareCardFiles,
  nativeShareCardSavePending,
} from './share-card-save-operations'
mocks.photoSaveName = /\bName\("([^"]+)"\)/.exec(swiftModuleSource)?.[1] ?? ''
const originalOS = Platform.OS
const originalVersion = Platform.Version
function platform(os: string, version: number) {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os })
  Object.defineProperty(Platform, 'Version', { configurable: true, value: version })
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
beforeEach(() => {
  mocks.fixture = 'real'
  mocks.mediaAvailable = true
  mocks.originalAvailable = false
  platform('android', 34)
  mocks.files.clear()
  mocks.readDirectory
    .mockReset()
    .mockImplementation(() =>
      Promise.resolve([...mocks.files.keys()].map((uri) => uri.split('/').at(-1)))
    )
  mocks.uuid = 0
  mocks.getPermission.mockReset().mockResolvedValue({ granted: true, canAskAgain: true })
  mocks.requestPermission
    .mockReset()
    .mockResolvedValue({ granted: true, canAskAgain: true })
  mocks.nativeSave.mockReset().mockResolvedValue(undefined)
  mocks.originalSave.mockReset().mockResolvedValue(undefined)
  mocks.write.mockReset().mockImplementation((uri: string, bytes: string) => {
    mocks.files.set(uri, bytes)
    return Promise.resolve()
  })
  mocks.remove.mockReset().mockImplementation((uri: string) => {
    mocks.files.delete(uri)
    return Promise.resolve()
  })
})
afterEach(() => {
  platform(originalOS, Number(originalVersion))
  vi.useRealTimers()
})
describe('native immutable file and permission adapter', () => {
  it.each(['permission_denied', 'permission_permanent', 'limited'])(
    'native permission response fixture %s preserves explicit-request semantics',
    async (mode) => {
      platform('ios', 26)
      mocks.originalAvailable = true
      mocks.fixture = mode
      expect(await shareCardSavePermission(true)).toMatchObject(
        mode === 'limited'
          ? { granted: true, accessPrivileges: 'limited' }
          : { granted: false, canAskAgain: mode === 'permission_denied' }
      )
      expect(mocks.getPermission).not.toHaveBeenCalled()
      expect(mocks.requestPermission).not.toHaveBeenCalled()
      expect(mocks.nativeSave).not.toHaveBeenCalled()
      expect(mocks.originalSave).not.toHaveBeenCalled()
    }
  )
  it('requests the iOS original-resource module by its Swift module name', () => {
    expect(mocks.photoSaveName).toBe('ShareCardPhotoSave')
    platform('ios', 26)
    mocks.originalAvailable = true
    expect(nativeShareCardSaveAvailable()).toBe(true)
  })
  it.each(['precommit', 'committed'])(
    'U-PENDING-FILE: orphan listing cannot delete a newly %s owned file',
    async (phase) => {
      const list = deferred()
      const native = deferred()
      const write = deferred()
      mocks.readDirectory.mockImplementation(async () => {
        await list.promise
        return [...mocks.files.keys()].map((uri) => uri.split('/').at(-1))
      })
      mocks.write.mockImplementation(async (uri: string, bytes: string) => {
        mocks.files.set(uri, bytes)
        if (phase === 'precommit') await write.promise
      })
      mocks.nativeSave.mockImplementation(async (uri: string) => {
        await native.promise
        expect(mocks.files.get(uri)).toBe(card.pngBase64)
      })
      const cleanup = cleanOrphanShareCards()
      await vi.waitFor(() => expect(mocks.readDirectory).toHaveBeenCalledOnce())
      const saving = saveShareCard(card, new AbortController().signal, () => true)
      await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce())
      if (phase === 'committed')
        await vi.waitFor(() => expect(mocks.nativeSave).toHaveBeenCalledOnce())
      list.resolve()
      await cleanup
      expect(mocks.files.size).toBe(1)
      expect(mocks.remove).not.toHaveBeenCalled()
      write.resolve()
      native.resolve()
      await saving
      expect(mocks.remove).toHaveBeenCalledOnce()
    }
  )
  it('U-SAVE: Android33+ performs no permission prompt and imports exact validated PNG', async () => {
    expect(await shareCardSavePermission(true)).toMatchObject({ granted: true })
    expect(mocks.getPermission).not.toHaveBeenCalled()
    expect(mocks.requestPermission).not.toHaveBeenCalled()
    mocks.nativeSave.mockImplementation((uri: string) => {
      expect(mocks.files.get(uri)).toBe(card.pngBase64)
      return Promise.resolve()
    })
    await saveShareCard(card, new AbortController().signal, () => true)
    expect(mocks.nativeSave).toHaveBeenCalledTimes(1)
    expect(mocks.remove).toHaveBeenCalledTimes(1)
    expect(mocks.files.size).toBe(0)
  })
  it('U-SINGLE-WRITE U-PENDING-FILE: concurrent delayed writes clean the loser while committed bytes survive cancellation', async () => {
    const firstWrite = deferred()
    const secondWrite = deferred()
    const native = deferred()
    mocks.write
      .mockImplementationOnce(async (uri: string, bytes: string) => {
        await firstWrite.promise
        mocks.files.set(uri, bytes)
      })
      .mockImplementationOnce(async (uri: string, bytes: string) => {
        await secondWrite.promise
        mocks.files.set(uri, bytes)
      })
    mocks.nativeSave.mockImplementation(async (uri: string) => {
      await native.promise
      expect(mocks.files.get(uri)).toBe(card.pngBase64)
    })
    const abort = new AbortController()
    const first = saveShareCard(card, abort.signal, () => true)
    const second = saveShareCard(card, new AbortController().signal, () => true)
    // Crypto is asynchronous; wait until both cache writes have begun.
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2))
    firstWrite.resolve()
    await vi.waitFor(() => expect(mocks.nativeSave).toHaveBeenCalledTimes(1))
    abort.abort()
    const rejected = expect(second).rejects.toThrow('finishingSave')
    secondWrite.resolve()
    await rejected
    expect(mocks.files.size).toBe(1)
    expect(mocks.remove).toHaveBeenCalledTimes(1)
    expect(nativeShareCardSavePending()).toBe(true)
    await cleanOrphanShareCards()
    expect(mocks.files.size).toBe(1)
    native.resolve()
    await first
    expect(mocks.remove).toHaveBeenCalledTimes(2)
    expect(mocks.files.size).toBe(0)
    expect(liveShareCardFiles().size).toBe(0)
  })
  it('U-CANCEL: cancellation during cache write deletes only after the write settles and never imports', async () => {
    const write = deferred()
    mocks.write.mockImplementation(async (uri: string, bytes: string) => {
      await write.promise
      mocks.files.set(uri, bytes)
    })
    const abort = new AbortController()
    const pending = saveShareCard(card, abort.signal, () => true)
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
    abort.abort()
    expect(mocks.remove).not.toHaveBeenCalled()
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    write.resolve()
    await rejected
    expect(mocks.nativeSave).not.toHaveBeenCalled()
    expect(mocks.files.size).toBe(0)
  })
  it('U-PERMISSION-DENIED U-PERMISSION-PERMANENT U-PERMISSION-LIMITED: legacy writes request add-only only on explicit activation', async () => {
    platform('android', 32)
    mocks.getPermission.mockResolvedValue({
      granted: false,
      canAskAgain: true,
      accessPrivileges: 'none',
    })
    expect(await shareCardSavePermission(false)).toMatchObject({ granted: false })
    expect(mocks.requestPermission).not.toHaveBeenCalled()
    mocks.requestPermission.mockResolvedValue({
      granted: false,
      canAskAgain: true,
      accessPrivileges: 'none',
    })
    expect(await shareCardSavePermission(true)).toMatchObject({
      granted: false,
      canAskAgain: true,
    })
    expect(mocks.getPermission).toHaveBeenCalledWith(true)
    expect(mocks.requestPermission).toHaveBeenCalledWith(true)
    mocks.getPermission.mockResolvedValue({
      granted: false,
      canAskAgain: false,
      accessPrivileges: 'none',
    })
    mocks.requestPermission.mockClear()
    expect(await shareCardSavePermission(true)).toMatchObject({ canAskAgain: false })
    expect(mocks.requestPermission).not.toHaveBeenCalled()
    mocks.getPermission.mockResolvedValue({
      granted: false,
      canAskAgain: true,
      accessPrivileges: 'limited',
    })
    expect(await shareCardSavePermission(true)).toMatchObject({
      granted: true,
      accessPrivileges: 'limited',
    })
    expect(mocks.requestPermission).not.toHaveBeenCalled()
  })
  it('U-NATIVE-UNAVAILABLE: iOS missing original-resource module refuses saving before any native permission/write', async () => {
    platform('ios', 26)
    expect(nativeShareCardSaveAvailable()).toBe(false)
    await expect(
      saveShareCard(card, new AbortController().signal, () => true)
    ).rejects.toThrow('nativeSaveUnavailable')
    expect(mocks.getPermission).not.toHaveBeenCalled()
    expect(mocks.nativeSave).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  })
  it.each(['ios', 'android'])(
    'refuses %s save and permission activation when MediaLibrary is absent',
    async (os) => {
      platform(os, 26)
      mocks.mediaAvailable = false
      mocks.originalAvailable = true
      expect(nativeShareCardSaveAvailable()).toBe(false)
      expect(await shareCardSavePermission(true)).toEqual({
        granted: false,
        canAskAgain: false,
      })
      await expect(
        saveShareCard(card, new AbortController().signal, () => true)
      ).rejects.toThrow('nativeSaveUnavailable')
      expect(mocks.getPermission).not.toHaveBeenCalled()
      expect(mocks.requestPermission).not.toHaveBeenCalled()
      expect(mocks.nativeSave).not.toHaveBeenCalled()
      expect(mocks.originalSave).not.toHaveBeenCalled()
      expect(mocks.write).not.toHaveBeenCalled()
    }
  )
  it('preserves precommit cancellation when deletion fails and retries cleanup without importing', async () => {
    vi.useFakeTimers()
    const abort = new AbortController()
    mocks.write.mockImplementation((uri: string, bytes: string) => {
      mocks.files.set(uri, bytes)
      abort.abort()
      return Promise.resolve()
    })
    mocks.remove.mockRejectedValueOnce(new Error('temporarily_busy'))
    await expect(saveShareCard(card, abort.signal, () => true)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(mocks.nativeSave).not.toHaveBeenCalled()
    expect(mocks.files.size).toBe(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.remove).toHaveBeenCalledTimes(2)
    expect(mocks.files.size).toBe(0)
    expect(mocks.nativeSave).not.toHaveBeenCalled()
  })
  it('U-STORAGE: rejected cache/native writes clean their files and retain an unlocked retry boundary', async () => {
    mocks.write.mockRejectedValueOnce(new Error('disk_full'))
    await expect(
      saveShareCard(card, new AbortController().signal, () => true)
    ).rejects.toThrow('disk_full')
    expect(mocks.nativeSave).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledTimes(1)
    mocks.nativeSave.mockRejectedValueOnce(new Error('native_rejected'))
    await expect(
      saveShareCard(card, new AbortController().signal, () => true)
    ).rejects.toThrow('native_rejected')
    expect(mocks.files.size).toBe(0)
    expect(nativeShareCardSavePending()).toBe(false)
  })
})
