import { Platform } from 'react-native'
import {
  ritualResponseSchema,
  type RitualResponse,
} from '@couture/api-client/contracts/http'

const cachePrefix = 'ritual'
const latestLocationKey = 'latest-location'

export type RitualCacheEntry = {
  data: RitualResponse
  timestamp: number
}

const memoryCache: Record<string, RitualCacheEntry> = {}
const latestLocationByUser: Record<string, string> = {}

function ritualCacheKey(userId: string, locationKey: string) {
  return `${cachePrefix}:${userId}:${locationKey}`
}

function latestLocationCacheKey(userId: string) {
  return `${cachePrefix}:${userId}:${latestLocationKey}`
}

function storageFileName(key: string) {
  return `couture-cast-${encodeURIComponent(key)}.json`
}

interface FileSystemShim {
  documentDirectory: string | null
  getInfoAsync(fileUri: string): Promise<{ exists: boolean }>
  readAsStringAsync(fileUri: string): Promise<string>
  writeAsStringAsync(fileUri: string, value: string): Promise<void>
}

// Bypasses static TS analysis to avoid "module not found" errors
const legacyFileSystemPath = 'expo-file-system/legacy'

async function readStoredValue(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(key) ?? null
  }

  const fileSystem = (await import(
    /* @vite-ignore */ /* @metro-ignore */ legacyFileSystemPath
  )) as unknown as FileSystemShim
  if (!fileSystem.documentDirectory) {
    return null
  }

  const fileUri = `${fileSystem.documentDirectory}${storageFileName(key)}`
  const info = await fileSystem.getInfoAsync(fileUri)
  return info.exists ? await fileSystem.readAsStringAsync(fileUri) : null
}

async function writeStoredValue(key: string, value: string) {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value)
    return
  }

  const fileSystem = (await import(
    /* @vite-ignore */ /* @metro-ignore */ legacyFileSystemPath
  )) as unknown as FileSystemShim
  if (!fileSystem.documentDirectory) {
    return
  }

  await fileSystem.writeAsStringAsync(
    `${fileSystem.documentDirectory}${storageFileName(key)}`,
    value
  )
}

function parseCacheEntry(value: string | null): RitualCacheEntry | null {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as Partial<RitualCacheEntry>
    if (typeof parsed.timestamp !== 'number') {
      return null
    }

    return {
      timestamp: parsed.timestamp,
      data: ritualResponseSchema.parse(parsed.data),
    }
  } catch {
    return null
  }
}

export async function readLatestRitualCache(
  userId: string
): Promise<RitualCacheEntry | null> {
  try {
    let locationKey = latestLocationByUser[userId]
    if (!locationKey) {
      locationKey = (await readStoredValue(latestLocationCacheKey(userId))) ?? undefined
      if (locationKey) {
        latestLocationByUser[userId] = locationKey
      }
    }

    if (!locationKey) {
      return null
    }

    const key = ritualCacheKey(userId, locationKey)
    if (memoryCache[key]) {
      return memoryCache[key]
    }

    const entry = parseCacheEntry(await readStoredValue(key))
    if (entry) {
      memoryCache[key] = entry
    }
    return entry
  } catch {
    return null
  }
}

export async function saveRitualCache(userId: string, entry: RitualCacheEntry) {
  const locationKey = entry.data.data.weather.locationKey
  const key = ritualCacheKey(userId, locationKey)
  memoryCache[key] = entry
  latestLocationByUser[userId] = locationKey

  await Promise.all([
    writeStoredValue(key, JSON.stringify(entry)),
    writeStoredValue(latestLocationCacheKey(userId), locationKey),
  ])
}

export function clearRitualMemoryCache() {
  for (const key of Object.keys(memoryCache)) {
    delete memoryCache[key]
  }
  for (const userId of Object.keys(latestLocationByUser)) {
    delete latestLocationByUser[userId]
  }
}
