import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import type { PreparedShareCard } from '@couture/api-client/contracts/http'

// The mobile workspace typechecks the production module. Keeping this Node VM
// boundary structural avoids importing React Native's global environment types.
type SaveModule = {
  nativeShareCardSaveAvailable: () => boolean
  cleanOrphanShareCards: () => Promise<void>
  shareCardSavePermission: (
    request: boolean
  ) => Promise<{ granted: boolean; canAskAgain: boolean }>
  saveShareCard: (
    card: PreparedShareCard,
    signal: AbortSignal,
    isCurrent: () => boolean
  ) => Promise<void>
}
const root = process.cwd()
const card = JSON.parse(
  fs.readFileSync('packages/api-client/src/testing/share-card-fixture.json', 'utf8')
) as Parameters<SaveModule['saveShareCard']>[0]

/** Actual SDK initialization and native optional lookup, with a baseline-client registry. */
function boot(os: string, mediaPresent: boolean, originalPresent: boolean, version = 34) {
  const files = new Map<string, string>()
  const getPermission = vi.fn(() => Promise.resolve({ granted: true, canAskAgain: true }))
  const requestPermission = vi.fn(() =>
    Promise.resolve({ granted: true, canAskAgain: true })
  )
  const imported = vi.fn((uri: string) => {
    expect(files.get(uri)).toBe(card.pngBase64)
    return Promise.resolve()
  })
  const write = vi.fn((uri: string, bytes: string) => {
    files.set(uri, bytes)
    return Promise.resolve()
  })
  const remove = vi.fn((uri: string) => {
    files.delete(uri)
    return Promise.resolve()
  })
  const registry: Record<string, unknown> = {
    // These dependencies already exist in the baseline development client.
    ExpoCrypto: {},
    ExponentFileSystem: {},
    ...(mediaPresent
      ? {
          ExpoMediaLibrary: {
            MediaType: {},
            SortBy: {},
            getPermissionsAsync: getPermission,
            requestPermissionsAsync: requestPermission,
            saveToLibraryAsync: imported,
          },
        }
      : {}),
    ...(originalPresent ? { ShareCardPhotoSave: { saveOriginalPng: imported } } : {}),
  }
  const context = vm.createContext({
    expo: { modules: registry },
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    DOMException,
    Uint8Array,
    ArrayBuffer,
  })
  const cache = new Map<string, Record<string, unknown>>()
  let mediaImports = 0
  const platform = { OS: os, Version: version }
  const load = (name: string): Record<string, unknown> => {
    const filename = path.resolve(root, name)
    const existing = cache.get(filename)
    if (existing) return existing
    const module = { exports: {} as Record<string, unknown> }
    cache.set(filename, module.exports)
    const reproduction = process.env.CC68_REPRO_NATIVE_SOURCE
    const source =
      reproduction && filename.endsWith('/src/lib/share-card-save.native.ts')
        ? fs.readFileSync(reproduction, 'utf8')
        : fs.readFileSync(filename, 'utf8')
    const code = transpileModule(source, {
      compilerOptions: {
        module: ModuleKind.CommonJS,
        target: ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText
    const requireFrom = (id: string): unknown => {
      if (id === 'react-native')
        return { Platform: platform, TurboModuleRegistry: { get: () => null } }
      if (id === 'expo-modules-core')
        return {
          ...load('node_modules/expo-modules-core/src/requireNativeModule.ts'),
          PermissionStatus: { GRANTED: 'granted', DENIED: 'denied' },
          createPermissionHook: () => () => undefined,
          UnavailabilityError: Error,
        }
      if (id === './NativeModulesProxy') return { __esModule: true, default: {} }
      if (id === './TurboModuleToExpoModuleProxy')
        return { createTurboModuleToExpoProxy: () => null }
      if (id === './ensureNativeModulesAreInstalled')
        return { ensureNativeModulesAreInstalled: () => undefined }
      if (id === 'expo-media-library') {
        mediaImports++
        return load('node_modules/expo-media-library/src/MediaLibrary.ts')
      }
      if (id === 'expo-file-system/legacy')
        return {
          cacheDirectory: 'file:///baseline-cache/',
          EncodingType: { Base64: 'base64' },
          getInfoAsync: () => Promise.resolve({ exists: false }),
          makeDirectoryAsync: () => Promise.resolve(),
          writeAsStringAsync: write,
          deleteAsync: remove,
        }
      if (id === 'expo-crypto')
        return {
          CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
          digest: (_algorithm: string, bytes: Uint8Array<ArrayBuffer>) =>
            webcrypto.subtle.digest('SHA-256', bytes),
          randomUUID: () => '00000000-0000-4000-8000-000000000001',
        }
      if (id === '@couture/api-client')
        return {
          abortError: () => new DOMException('aborted', 'AbortError'),
          decodeShareCardBase64: (value: string) =>
            Uint8Array.from(Buffer.from(value, 'base64')),
        }
      if (id === './share-card-native-fixture')
        return {
          shareCardFixtureMode: () => 'real',
          runShareCardNativeAdapter: (_uri: string, save: () => Promise<void>) => save(),
        }
      if (id === '../../modules/share-card-photo-save')
        return load('apps/mobile/modules/share-card-photo-save/index.native.ts')
      if (id.startsWith('.'))
        return load(path.resolve(path.dirname(filename), id + '.ts'))
      throw new Error(`Unexpected native startup dependency: ${id}`)
    }
    const evaluate = vm.runInContext(
      `(function(module,exports,require){${code}\n})`,
      context,
      { filename }
    ) as (
      module: { exports: Record<string, unknown> },
      exports: Record<string, unknown>,
      require: (id: string) => unknown
    ) => void
    evaluate(module, module.exports, requireFrom)
    return module.exports
  }
  return {
    loadSave: () => load('apps/mobile/src/lib/share-card-save.native.ts') as SaveModule,
    loadSdk: () => load('node_modules/expo-media-library/src/MediaLibrary.ts'),
    mediaImports: () => mediaImports,
    imported,
    getPermission,
    requestPermission,
    files,
    write,
    remove,
  }
}

describe('share-card startup with actual Expo native-registry requirements', () => {
  it('keeps the real SDK throwing initialization in the missing-registry reproduction', () => {
    expect(() => boot('ios', false, false).loadSdk()).toThrow(
      "Cannot find native module 'ExpoMediaLibrary'"
    )
  })

  it.each(['ios', 'android'])(
    'baseline %s client boots with both new native modules absent and requests no permissions',
    async (os) => {
      const host = boot(os, false, false)
      const save = host.loadSave()
      await expect(save.cleanOrphanShareCards()).resolves.toBeUndefined()
      expect(save.nativeShareCardSaveAvailable()).toBe(false)
      expect(await save.shareCardSavePermission(true)).toEqual({
        granted: false,
        canAskAgain: false,
      })
      await expect(
        save.saveShareCard(card, new AbortController().signal, () => true)
      ).rejects.toThrow('nativeSaveUnavailable')
      expect(host.mediaImports()).toBe(0)
      expect(host.getPermission).not.toHaveBeenCalled()
      expect(host.requestPermission).not.toHaveBeenCalled()
      expect(host.imported).not.toHaveBeenCalled()
    }
  )

  it('L6: preserves a precommit abort and retries a failed deletion without importing', async () => {
    vi.useFakeTimers()
    try {
      const host = boot('android', true, false)
      const save = host.loadSave()
      const abort = new AbortController()
      host.write.mockImplementation((uri: string, bytes: string) => {
        host.files.set(uri, bytes)
        abort.abort()
        return Promise.resolve()
      })
      host.remove.mockRejectedValueOnce(new Error('temporarily_busy'))
      await expect(
        save.saveShareCard(card, abort.signal, () => true)
      ).rejects.toMatchObject({
        name: 'AbortError',
      })
      expect(host.files.size).toBe(1)
      expect(host.imported).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1000)
      expect(host.remove).toHaveBeenCalledTimes(2)
      expect(host.files.size).toBe(0)
      expect(host.imported).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('Expo Go iOS boots with MediaLibrary present and the original-resource module absent', async () => {
    const host = boot('ios', true, false)
    const save = host.loadSave()
    expect(save.nativeShareCardSaveAvailable()).toBe(false)
    expect(await save.shareCardSavePermission(true)).toMatchObject({ granted: false })
    expect(host.mediaImports()).toBe(0)
    expect(host.getPermission).not.toHaveBeenCalled()
    expect(host.requestPermission).not.toHaveBeenCalled()
  })

  it.each(['ios', 'android'])(
    'rebuilt %s client imports the SDK only after supported explicit Save activation',
    async (os) => {
      const host = boot(os, true, true)
      const save = host.loadSave()
      expect(save.nativeShareCardSaveAvailable()).toBe(true)
      expect(host.mediaImports()).toBe(0)
      expect(await save.shareCardSavePermission(true)).toMatchObject({ granted: true })
      await save.saveShareCard(card, new AbortController().signal, () => true)
      expect(host.imported).toHaveBeenCalledOnce()
      expect(host.files.size).toBe(0)
      if (os === 'ios') expect(host.getPermission).toHaveBeenCalledWith(true)
      else expect(host.getPermission).not.toHaveBeenCalled()
    }
  )
})
