import { Platform } from 'react-native'
import {
  MAX_SAMPLE_BOOKMARK_BYTES,
  memberSampleBookmarksStorageKeys,
  parseMemberSampleBookmarksStorageKey,
  parseStylePieceStorageKey,
  stylePieceStorageKey,
} from '@couture/utils'

const MAX_DISCOVERY_KEYS = 32
const MAX_DISCOVERY_BYTES = 64 * 1024

export type SampleRecipeStorageHandle = {
  read: () => string | null
  write: (value: string) => void
  remove: () => void
}

type ExpoFsFileLike = {
  uri?: string
  name?: string
  exists?: boolean
  size?: number
  textSync?: () => string
  write?: (value: string) => void
  delete?: () => void
}

type ExpoFsModuleLike = {
  File: new (uri: unknown, name?: string) => ExpoFsFileLike
  Directory?: new (uri: unknown) => { list?: () => ExpoFsFileLike[] }
  Paths: { document: unknown }
}

function safeNativeReadFile(file: ExpoFsFileLike): string | null {
  try {
    if (!file.exists) return null
    if (typeof file.size === 'number' && file.size > MAX_SAMPLE_BOOKMARK_BYTES) {
      return null
    }
    return typeof file.textSync === 'function' ? file.textSync() : null
  } catch {
    return null
  }
}

function safeNativeRemoveFile(file: ExpoFsFileLike): void {
  try {
    if (!file.exists) return
    if (typeof file.delete === 'function') {
      file.delete()
    } else if (typeof file.write === 'function') {
      file.write('[]')
    }
  } catch {
    // Ignore native deletion errors; retry remains safe
  }
}

function extractNativeEntryName(entry: ExpoFsFileLike): string | null {
  if (typeof entry.name === 'string' && entry.name.length > 0) return entry.name
  if (typeof entry.uri === 'string' && entry.uri.length > 0) {
    const slash = entry.uri.lastIndexOf('/')
    return slash >= 0 ? entry.uri.slice(slash + 1) : entry.uri
  }
  return null
}

function listNativeStylePieceCandidates(
  fsMod: ExpoFsModuleLike,
  owner: string,
  knownGarmentIds: readonly string[]
): Map<string, string> {
  const candidates = new Map<string, string>()
  try {
    if (typeof fsMod.Directory === 'function') {
      const dir = new fsMod.Directory(fsMod.Paths.document)
      const entries = typeof dir.list === 'function' ? dir.list() : []
      for (const entry of entries) {
        const name = extractNativeEntryName(entry)
        if (!name || !name.startsWith('couturecast.style-piece.')) continue
        const parsed = parseStylePieceStorageKey(name, { allowJsonExtension: true })
        if (parsed?.owner === owner) {
          candidates.set(
            stylePieceStorageKey(parsed.owner, parsed.garmentId),
            parsed.garmentId
          )
        }
      }
    }
  } catch {
    // Directory enumeration failed; fall back to known garment IDs below
  }

  for (const garmentId of knownGarmentIds) {
    if (garmentId) {
      candidates.set(stylePieceStorageKey(owner, garmentId), garmentId)
    }
  }
  return candidates
}

function listWebStylePieceCandidates(
  owner: string,
  knownGarmentIds: readonly string[]
): Map<string, string> {
  const candidates = new Map<string, string>()
  try {
    const storage = globalThis.localStorage
    const keys = Object.keys(storage)
    for (const key of keys) {
      if (!key.startsWith('couturecast.style-piece.')) continue
      const parsed = parseStylePieceStorageKey(key)
      if (parsed?.owner === owner) {
        candidates.set(key, parsed.garmentId)
      }
    }
  } catch {
    return candidates
  }
  for (const garmentId of knownGarmentIds) {
    if (garmentId) candidates.set(stylePieceStorageKey(owner, garmentId), garmentId)
  }
  return candidates
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
  const fsMod = (await import('expo-file-system')) as unknown as ExpoFsModuleLike
  const file = new fsMod.File(fsMod.Paths.document, `${key}.json`)
  return {
    read: () => safeNativeReadFile(file),
    write: (value: string) => {
      try {
        file.write?.(value)
      } catch {
        // Ignore native write errors
      }
    },
    remove: () => safeNativeRemoveFile(file),
  }
}

export type MobileDiscoveryBudget = {
  remainingKeys: number
  remainingBytes: number
  deferredCount: number
}

export function createMobileDiscoveryBudget(): MobileDiscoveryBudget {
  return {
    remainingKeys: MAX_DISCOVERY_KEYS,
    remainingBytes: MAX_DISCOVERY_BYTES,
    deferredCount: 0,
  }
}

function consumeMobileBudget(
  budget: MobileDiscoveryBudget,
  rawLength: number,
  collectedCount: number
): boolean {
  if (
    budget.remainingKeys <= 0 ||
    (budget.remainingBytes < rawLength && collectedCount > 0)
  ) {
    budget.deferredCount += 1
    return false
  }
  budget.remainingKeys -= 1
  budget.remainingBytes -= rawLength
  return true
}

export async function discoverMobileHomeSampleStorageForOwner(
  owner: string,
  isCurrent: () => boolean = () => true,
  budget: MobileDiscoveryBudget = createMobileDiscoveryBudget()
): Promise<{ key: string; raw: string; handle: SampleRecipeStorageHandle }[]> {
  if (!isCurrent()) return []
  const keys = memberSampleBookmarksStorageKeys(owner).filter(
    (key) => parseMemberSampleBookmarksStorageKey(key) === owner
  )
  const results: { key: string; raw: string; handle: SampleRecipeStorageHandle }[] = []

  if (Platform.OS === 'web') {
    for (const key of keys) {
      if (!isCurrent()) return []
      const handle = await sampleRecipeStorage(key)
      if (!isCurrent()) return []
      const raw = handle.read()
      if (raw !== null && consumeMobileBudget(budget, raw.length, results.length)) {
        results.push({ key, raw, handle })
      }
    }
    return results
  }

  const fsMod = (await import('expo-file-system')) as unknown as ExpoFsModuleLike
  if (!isCurrent()) return []
  for (const key of keys) {
    if (!isCurrent()) return []
    const file = new fsMod.File(fsMod.Paths.document, `${key}.json`)
    if (!file.exists) continue
    const handle = await sampleRecipeStorage(key)
    if (!isCurrent()) return []
    const raw = handle.read()
    if (raw !== null && consumeMobileBudget(budget, raw.length, results.length)) {
      results.push({ key, raw, handle })
    }
  }
  return results
}

async function readMobileStylePieceCandidates(params: {
  candidates: Map<string, string>
  isCurrent: () => boolean
  budget: MobileDiscoveryBudget
  fsMod?: ExpoFsModuleLike
}): Promise<
  {
    key: string
    garmentId: string
    raw: string
    handle: SampleRecipeStorageHandle
  }[]
> {
  const { candidates, isCurrent, budget, fsMod } = params
  const results: {
    key: string
    garmentId: string
    raw: string
    handle: SampleRecipeStorageHandle
  }[] = []

  for (const [key, garmentId] of candidates) {
    if (!isCurrent()) break
    if (fsMod) {
      let exists = false
      try {
        exists = Boolean(new fsMod.File(fsMod.Paths.document, `${key}.json`).exists)
      } catch {
        exists = false
      }
      if (!exists) continue
    }
    const handle = await sampleRecipeStorage(key)
    if (!isCurrent()) return []
    const raw = handle.read()
    if (raw === null) continue
    if (!consumeMobileBudget(budget, raw.length, results.length)) continue
    results.push({ key, garmentId, raw, handle })
  }
  return results
}

export async function discoverMobileStylePieceStorageForOwner(
  owner: string,
  knownGarmentIds: readonly string[] = [],
  isCurrent: () => boolean = () => true,
  budget: MobileDiscoveryBudget = createMobileDiscoveryBudget()
): Promise<
  {
    key: string
    garmentId: string
    raw: string
    handle: SampleRecipeStorageHandle
  }[]
> {
  if (!isCurrent()) return []
  if (Platform.OS === 'web') {
    const candidates = listWebStylePieceCandidates(owner, knownGarmentIds)
    return readMobileStylePieceCandidates({ candidates, isCurrent, budget })
  }

  const fsMod = (await import('expo-file-system')) as unknown as ExpoFsModuleLike
  if (!isCurrent()) return []
  const candidates = listNativeStylePieceCandidates(fsMod, owner, knownGarmentIds)
  return readMobileStylePieceCandidates({ candidates, isCurrent, budget, fsMod })
}
