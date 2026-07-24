import { Platform } from 'react-native'
import {
  supportedLocaleSchema,
  type SupportedLocale,
} from '@couture/api-client/contracts/http'

const settingsFile = 'couture-cast-settings.json'

export type SettingsData = {
  locale: SupportedLocale | null
  localeSyncPending: boolean
}

const defaultSettings: SettingsData = {
  locale: null,
  localeSyncPending: false,
}

function loadNativeFileSystem() {
  // The literal import lets Metro bundle the SDK 54 legacy module while keeping it out of web runs.
  return import('expo-file-system/legacy')
}

async function readStoredSettings(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return globalThis.localStorage?.getItem(settingsFile) ?? null
    }

    const fileSystem = await loadNativeFileSystem()
    if (!fileSystem.documentDirectory) {
      return null
    }

    const fileUri = `${fileSystem.documentDirectory}${settingsFile}`
    const info = await fileSystem.getInfoAsync(fileUri)
    return info.exists ? await fileSystem.readAsStringAsync(fileUri) : null
  } catch {
    return null
  }
}

async function writeStoredSettings(value: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      const storage = globalThis.localStorage
      if (!storage) {
        return false
      }
      storage.setItem(settingsFile, value)
      return true
    }

    const fileSystem = await loadNativeFileSystem()
    if (!fileSystem.documentDirectory) {
      return false
    }

    const fileUri = `${fileSystem.documentDirectory}${settingsFile}`
    await fileSystem.writeAsStringAsync(fileUri, value)
    return true
  } catch {
    return false
  }
}

export async function getSavedSettings(): Promise<SettingsData> {
  const value = await readStoredSettings()
  if (!value) {
    return defaultSettings
  }
  try {
    const parsed = JSON.parse(value) as Partial<SettingsData>
    const localeResult = supportedLocaleSchema.safeParse(parsed.locale)
    return {
      locale: localeResult.success ? localeResult.data : defaultSettings.locale,
      localeSyncPending:
        typeof parsed.localeSyncPending === 'boolean'
          ? parsed.localeSyncPending
          : defaultSettings.localeSyncPending,
    }
  } catch {
    return defaultSettings
  }
}

export async function saveSettings(settings: Partial<SettingsData>): Promise<boolean> {
  const current = await getSavedSettings()
  const updated = { ...current, ...settings }
  return writeStoredSettings(JSON.stringify(updated))
}
