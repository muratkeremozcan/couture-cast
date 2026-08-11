import { Platform } from 'react-native'
import {
  alertPreferencesSchema,
  ritualResponseSchema,
  type AlertPreferences,
  type RitualResponse,
  type SupportedLocale,
} from '@couture/api-client/contracts/http'
import { shareWidgetData } from './widget-share'

const cachePrefix = 'ritual'
const latestLocationKey = 'latest-location'

export type RitualCacheEntry = {
  data: RitualResponse
  timestamp: number
  alertPreferences?: AlertPreferences
}

const memoryCache: Record<string, RitualCacheEntry> = {}
const latestLocationByUserLocale: Record<string, string> = {}

function ritualCacheKey(userId: string, locale: SupportedLocale, locationKey: string) {
  return `${cachePrefix}:${userId}:${locale}:${locationKey}`
}

function userLocaleKey(userId: string, locale: SupportedLocale) {
  return `${userId}:${locale}`
}

function latestLocationCacheKey(userId: string, locale: SupportedLocale) {
  return `${cachePrefix}:${userId}:${locale}:${latestLocationKey}`
}

function storageFileName(key: string) {
  return `couture-cast-${encodeURIComponent(key)}.json`
}

function loadNativeFileSystem() {
  // The literal import lets Metro bundle the SDK 54 legacy module while keeping it out of web runs.
  return import('expo-file-system/legacy')
}

async function readStoredValue(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(key) ?? null
  }

  const fileSystem = await loadNativeFileSystem()
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

  const fileSystem = await loadNativeFileSystem()
  if (!fileSystem.documentDirectory) {
    return
  }

  await fileSystem.writeAsStringAsync(
    `${fileSystem.documentDirectory}${storageFileName(key)}`,
    value
  )
}

async function publishWidgetData(
  entry: RitualCacheEntry,
  locale: SupportedLocale
): Promise<void> {
  try {
    await shareWidgetData(entry.data, locale, entry.timestamp, entry.alertPreferences)
  } catch (error) {
    console.warn(
      '[RitualCache] Durable cache saved, but widget publication failed',
      error
    )
    // Background refresh must report a failed widget update instead of claiming NewData.
    throw error
  }
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

    const alertPreferences = alertPreferencesSchema.safeParse(parsed.alertPreferences)
    return {
      timestamp: parsed.timestamp,
      data: ritualResponseSchema.parse(parsed.data),
      alertPreferences: alertPreferences.success ? alertPreferences.data : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Story 5.1 decision 6: the affiliate block never enters the device cache.
 *
 * The screen serves this cache for fifteen minutes before it will touch the
 * network, and with no age bound at all when the network fails, so a persisted
 * `shopThisLook` would keep a CTA alive long after the user opted out. Every
 * caller of {@link saveRitualCache} runs its payload through here first, and
 * `saveRitualCache` applies it again so a future writer cannot reintroduce the
 * leak by forgetting.
 *
 * The key is set to `null` rather than deleted: `scenarioOutfitSchema` makes it
 * required-and-nullable, so deleting it would make the entry unparseable on
 * read and silently discard the whole cache.
 */
export function withoutShopThisLook(response: RitualResponse): RitualResponse {
  return {
    ...response,
    data: {
      ...response.data,
      outfits: response.data.outfits.map((outfit) => ({
        ...outfit,
        shopThisLook: null,
      })),
    },
  }
}

export async function readLatestRitualCache(
  userId: string,
  locale: SupportedLocale
): Promise<RitualCacheEntry | null> {
  try {
    const localeKey = userLocaleKey(userId, locale)
    let locationKey = latestLocationByUserLocale[localeKey]
    if (!locationKey) {
      locationKey =
        (await readStoredValue(latestLocationCacheKey(userId, locale))) ?? undefined
      if (locationKey) {
        latestLocationByUserLocale[localeKey] = locationKey
      }
    }

    if (!locationKey) {
      return null
    }

    const key = ritualCacheKey(userId, locale, locationKey)
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

export async function saveRitualCache(
  userId: string,
  locale: SupportedLocale,
  rawEntry: RitualCacheEntry
) {
  // Applied here as well as at every call site: this is the chokepoint every
  // cache writer passes through, so the commerce block cannot reach storage
  // even if a future caller forgets.
  const entry: RitualCacheEntry = {
    ...rawEntry,
    data: withoutShopThisLook(rawEntry.data),
  }
  const locationKey = entry.data.data.weather.locationKey
  const key = ritualCacheKey(userId, locale, locationKey)
  const localeKey = userLocaleKey(userId, locale)
  memoryCache[key] = entry
  latestLocationByUserLocale[localeKey] = locationKey

  try {
    await Promise.all([
      writeStoredValue(key, JSON.stringify(entry)),
      writeStoredValue(latestLocationCacheKey(userId, locale), locationKey),
    ])
  } catch (error) {
    console.warn('[RitualCache] Durable cache write failed', error)
    throw error
  }
  // Story 3.3 Task 1 step 2 owner: update widgets only after the durable cache writes finish.
  await publishWidgetData(entry, locale)
}

export function clearRitualMemoryCache() {
  for (const key of Object.keys(memoryCache)) {
    delete memoryCache[key]
  }
  for (const localeKey of Object.keys(latestLocationByUserLocale)) {
    delete latestLocationByUserLocale[localeKey]
  }
}
