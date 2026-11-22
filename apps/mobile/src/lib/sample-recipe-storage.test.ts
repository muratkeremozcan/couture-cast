// Learning path Step 61: Import device-saved looks for the same member.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-61-import-device-saved-looks-for-the-same-member
import { Platform } from 'react-native'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stylePieceStorageKey } from '@couture/utils'

const nativeState = vi.hoisted(() => ({
  files: new Map<string, string>(),
  throwOnTextSync: new Set<string>(),
  throwOnExists: new Set<string>(),
  throwOnDirList: false,
  throwOnWrite: false,
  throwOnDelete: false,
  omitDelete: false,
  oversizedUri: null as string | null,
}))

vi.mock('expo-file-system', () => ({
  Directory: class {
    uri: string
    constructor(uri: string) {
      this.uri = uri
    }
    list() {
      if (nativeState.throwOnDirList) throw new Error('dir error')
      const prefix = `${this.uri}/`
      return [
        {},
        ...Array.from(nativeState.files.keys())
          .filter((uri) => uri.startsWith(prefix))
          .map((uri) => ({ uri })),
      ]
    }
  },
  File: class {
    uri: string
    constructor(uri: string, name?: string) {
      this.uri = name ? `${uri}/${name}` : uri
    }
    get exists() {
      if (nativeState.throwOnExists.has(this.uri)) throw new Error('exists error')
      return nativeState.files.has(this.uri)
    }
    get size() {
      if (nativeState.oversizedUri === this.uri) return 1_000_000
      return (nativeState.files.get(this.uri) ?? '').length
    }
    textSync() {
      if (nativeState.throwOnTextSync.has(this.uri)) throw new Error('read error')
      return nativeState.files.get(this.uri) ?? ''
    }
    write(value: string) {
      if (nativeState.throwOnWrite) throw new Error('write error')
      nativeState.files.set(this.uri, value)
    }
    get delete() {
      if (nativeState.omitDelete) return undefined
      return () => {
        if (nativeState.throwOnDelete) throw new Error('delete error')
        nativeState.files.delete(this.uri)
      }
    }
  },
  Paths: { document: 'file:///docs' },
}))

import {
  createMobileDiscoveryBudget,
  discoverMobileHomeSampleStorageForOwner,
  discoverMobileStylePieceStorageForOwner,
  sampleRecipeStorage,
} from './sample-recipe-storage'

const originalPlatformOs = Platform.OS

function setPlatformOs(os: 'web' | 'ios') {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  })
}

describe('sampleRecipeStorage and legacy discovery', () => {
  beforeEach(() => {
    nativeState.files.clear()
    nativeState.throwOnTextSync.clear()
    nativeState.throwOnExists.clear()
    nativeState.throwOnDirList = false
    nativeState.throwOnWrite = false
    nativeState.throwOnDelete = false
    nativeState.omitDelete = false
    nativeState.oversizedUri = null
    globalThis.localStorage.clear()
    setPlatformOs('web')
  })

  afterEach(() => {
    setPlatformOs(originalPlatformOs as 'web' | 'ios')
    vi.restoreAllMocks()
  })

  it('handles web localStorage read/write/remove and error fallbacks cleanly', async () => {
    const handle = await sampleRecipeStorage('k1')
    handle.write('["ok"]')
    expect(handle.read()).toBe('["ok"]')
    handle.remove()
    expect(handle.read()).toBeNull()

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    handle.write('x')
    handle.remove()
    expect(handle.read()).toBeNull()

    // Discovery gracefully handles blocked Object.keys(localStorage)
    vi.spyOn(Object, 'keys').mockImplementationOnce(() => {
      throw new Error('blocked keys')
    })
    expect(await discoverMobileStylePieceStorageForOwner('u1', [])).toEqual([])

    // Byte budget defers extra entries once remainingBytes is exhausted
    vi.restoreAllMocks()
    const tightBudget = { remainingKeys: 10, remainingBytes: 10, deferredCount: 0 }
    globalThis.localStorage.setItem(stylePieceStorageKey('u-budget', 'g1'), '1234567890')
    globalThis.localStorage.setItem(stylePieceStorageKey('u-budget', 'g2'), '12345678901')
    const foundBudget = await discoverMobileStylePieceStorageForOwner(
      'u-budget',
      [],
      () => true,
      tightBudget
    )
    expect(foundBudget).toHaveLength(1)
    expect(tightBudget.deferredCount).toBe(1)
  })

  it('discovers native Home and Style files with per-file error resilience, budget, and identity fencing', async () => {
    setPlatformOs('ios')
    const owner = 'native-user-1'
    const homeKey = `couturecast.member-sample-bookmarks.${owner}`
    const homeUri = `file:///docs/${homeKey}.json`
    const validKey = stylePieceStorageKey(owner, 'g-ok')
    const validUri = `file:///docs/${validKey}.json`
    const unreadableKey = stylePieceStorageKey(owner, 'g-bad-read')
    const unreadableUri = `file:///docs/${unreadableKey}.json`
    const existsErrKey = stylePieceStorageKey(owner, 'g-exists-err')
    const existsErrUri = `file:///docs/${existsErrKey}.json`
    const oversizedKey = stylePieceStorageKey(owner, 'g-huge')
    const oversizedUri = `file:///docs/${oversizedKey}.json`
    const otherUri = `file:///docs/${stylePieceStorageKey('other-user', 'g-other')}.json`

    nativeState.files.set(homeUri, '[{"lookId":"sample:l:office-oxford"}]')
    nativeState.files.set(validUri, '[{"lookId":"sample:l:office-oxford"}]')
    nativeState.files.set(unreadableUri, '[]')
    nativeState.files.set(existsErrUri, '[]')
    nativeState.files.set(oversizedUri, '[]')
    nativeState.files.set(otherUri, '[]')
    nativeState.throwOnTextSync.add(unreadableUri)
    nativeState.throwOnExists.add(existsErrUri)
    nativeState.oversizedUri = oversizedUri

    const budget = createMobileDiscoveryBudget()
    const homeFound = await discoverMobileHomeSampleStorageForOwner(
      owner,
      () => true,
      budget
    )
    expect(homeFound).toHaveLength(1)
    expect(homeFound[0]?.key).toBe(homeKey)

    // One corrupt/oversized/throwing file does not abort discovery of valid files
    const styleFound = await discoverMobileStylePieceStorageForOwner(
      owner,
      ['g-missing'],
      () => true,
      budget
    )
    expect(styleFound.map((f) => f.garmentId)).toEqual(['g-ok'])

    // Native remove with delete() vs fallback write('[]') vs error swallow
    styleFound[0]?.handle.remove()
    expect(nativeState.files.has(validUri)).toBe(false)

    nativeState.omitDelete = true
    const homeHandle = await sampleRecipeStorage(homeKey)
    homeHandle.remove()
    expect(nativeState.files.get(homeUri)).toBe('[]')

    nativeState.omitDelete = false
    nativeState.throwOnWrite = true
    nativeState.throwOnDelete = true
    homeHandle.write('ignored')
    homeHandle.remove()

    // Directory.list() failure falls back to knownGarmentIds
    nativeState.throwOnWrite = false
    nativeState.throwOnDelete = false
    nativeState.throwOnDirList = true
    nativeState.files.set(validUri, '[{"lookId":"sample:l:office-oxford"}]')
    const fallbackFound = await discoverMobileStylePieceStorageForOwner(owner, ['g-ok'])
    expect(fallbackFound.map((f) => f.garmentId)).toEqual(['g-ok'])

    // Fencing stops immediately when isCurrent returns false
    expect(await discoverMobileHomeSampleStorageForOwner(owner, () => false)).toEqual([])
    expect(
      await discoverMobileStylePieceStorageForOwner(owner, ['g-ok'], () => false)
    ).toEqual([])
  })
})
