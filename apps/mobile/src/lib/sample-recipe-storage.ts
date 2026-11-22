import { Platform } from 'react-native'
import {
  MAX_SAMPLE_BOOKMARK_BYTES,
  memberSampleBookmarksStorageKeys,
  parseMemberSampleBookmarksStorageKey,
  parseStylePieceStorageKey,
  stylePieceStorageKey,
} from '@couture/utils'

export type SampleRecipeStorageHandle = {
  read: () => string | null
  write: (value: string) => void
  remove: () => void
}

export async function sampleRecipeStorage(
  key: string
): Promise<SampleRecipeStorageHandle> {
  if (Platform.OS === 'web') {
    return {
      read: () => {
        try {
          return globalThis.localStorage.getItem(key)
        } catch {
          return null
        }
      },
      write: (value: string) => {
        try {
          globalThis.localStorage.setItem(key, value)
        } catch {
          // Ignore blocked or quota-exceeded storage
        }
      },
      remove: () => {
        try {
          globalThis.localStorage.removeItem(key)
        } catch {
          // Ignore blocked storage
        }
      },
    }
  }
  const { File, Paths } = await import('expo-file-system')
  const file = new File(Paths.document, `${key}.json`)
  return {
    read: () =>
      file.exists && file.size <= MAX_SAMPLE_BOOKMARK_BYTES ? file.textSync() : null,
    write: (value: string) => file.write(value),
    remove: () => {
      if (!file.exists) return
      const deletable = file as unknown as { delete?: () => void }
      if (typeof deletable.delete === 'function') {
        deletable.delete()
      } else {
        file.write('[]')
      }
    },
  }
}

export async function discoverMobileHomeSampleStorageForOwner(
  owner: string
): Promise<{ key: string; raw: string; handle: SampleRecipeStorageHandle }[]> {
  const keys = memberSampleBookmarksStorageKeys(owner).filter(
    (key) => parseMemberSampleBookmarksStorageKey(key) === owner
  )
  const results: { key: string; raw: string; handle: SampleRecipeStorageHandle }[] = []

  if (Platform.OS === 'web') {
    for (const key of keys) {
      const handle = await sampleRecipeStorage(key)
      const raw = handle.read()
      if (raw !== null) results.push({ key, raw, handle })
    }
    return results
  }

  const { File, Paths } = await import('expo-file-system')
  for (const key of keys) {
    const file = new File(Paths.document, `${key}.json`)
    if (!file.exists) continue
    const handle = await sampleRecipeStorage(key)
    results.push({ key, raw: handle.read() ?? '', handle })
  }
  return results
}

export async function discoverMobileStylePieceStorageForOwner(
  owner: string,
  knownGarmentIds: readonly string[] = []
): Promise<
  {
    key: string
    garmentId: string
    raw: string
    handle: SampleRecipeStorageHandle
  }[]
> {
  const results: {
    key: string
    garmentId: string
    raw: string
    handle: SampleRecipeStorageHandle
  }[] = []

  if (Platform.OS === 'web') {
    const candidates = new Map<string, string>()
    try {
      const storage = globalThis.localStorage
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index)
        if (!key || !key.startsWith('couturecast.style-piece.')) continue
        const parsed = parseStylePieceStorageKey(key)
        if (parsed?.owner === owner) {
          candidates.set(key, parsed.garmentId)
        }
      }
    } catch {
      return []
    }
    for (const garmentId of knownGarmentIds) {
      if (garmentId) candidates.set(stylePieceStorageKey(owner, garmentId), garmentId)
    }
    for (const [key, garmentId] of candidates) {
      const handle = await sampleRecipeStorage(key)
      const raw = handle.read()
      if (raw !== null) results.push({ key, garmentId, raw, handle })
    }
    return results
  }

  const { File, Paths } = await import('expo-file-system')
  for (const garmentId of new Set(knownGarmentIds.filter(Boolean))) {
    const key = stylePieceStorageKey(owner, garmentId)
    const file = new File(Paths.document, `${key}.json`)
    if (!file.exists) continue
    const handle = await sampleRecipeStorage(key)
    results.push({ key, garmentId, raw: handle.read() ?? '', handle })
  }
  return results
}
