// Story 6.7b owner: every device persistence API mobile writes through, recorded,
// so a test can prove a sponsorship block never reaches storage. A block is per
// viewer and only as good as the live read that carried it; anything that keeps
// it on the device could render it after an opt-out or an ended link.
//
// In a vitest run Platform.OS is 'web', so the storage wrappers (ritual-cache,
// settings-storage, widget-share) write through `localStorage`. On a device they
// write through `expo-file-system` (legacy and File) and `expo-secure-store`. The
// browser APIs are spied here. The native modules cannot load in a browser at
// all, so each test entry replaces them with `nativeStorageMocks`, which record
// into the same list.
import type { CommunitySponsorship } from '@couture/api-client/contracts/http'
import { expect, vi } from 'vitest'

const nativeWrites: unknown[][] = []

function recordNative(...args: unknown[]) {
  nativeWrites.push(args)
  return Promise.resolve()
}

/** Replacements for the native storage modules, for `vi.mock` factories. */
export const nativeStorageMocks = {
  secureStore: {
    setItemAsync: recordNative,
    getItemAsync: () => Promise.resolve(null),
    deleteItemAsync: () => Promise.resolve(),
  },
  legacyFileSystem: {
    documentDirectory: 'file:///documents/',
    writeAsStringAsync: recordNative,
    readAsStringAsync: () => Promise.resolve(''),
    getInfoAsync: () => Promise.resolve({ exists: false }),
    deleteAsync: () => Promise.resolve(),
  },
  /** `File#write` on the SDK 54 `expo-file-system` File class. */
  fileWrite: recordNative,
}

function serialize(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Starts recording every persisted write: Web Storage, IndexedDB and the native
 * module mocks. Returns a reader for everything written since.
 */
export function recordPersistedWrites(): () => string[] {
  nativeWrites.length = 0
  const spies = [
    vi.spyOn(Storage.prototype, 'setItem'),
    vi.spyOn(IDBObjectStore.prototype, 'put'),
    vi.spyOn(IDBObjectStore.prototype, 'add'),
  ]
  return () =>
    [...spies.flatMap((spy) => spy.mock.calls as unknown[][]), ...nativeWrites].map(
      (args) => args.map(serialize).join(' ')
    )
}

/** No write carries the block, any of its values, or a `sponsorship` field. */
export function expectNoSponsorshipPersisted(
  writes: string[],
  sponsorship: CommunitySponsorship
) {
  const markers = [
    '"sponsorship"',
    sponsorship.partnerId,
    sponsorship.partnerDisplayName,
    sponsorship.offerId,
    sponsorship.offerTitle,
  ]
  expect(
    writes.filter((write) => markers.some((marker) => write.includes(marker)))
  ).toEqual([])
}
