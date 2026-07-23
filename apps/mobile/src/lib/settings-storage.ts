import { Platform } from 'react-native'
import {
  supportedLocaleSchema,
  type SupportedLocale,
} from '@couture/api-client/contracts/http'

const settingsFile = 'couture-cast-settings.json'

interface FileSystemShim {
  documentDirectory: string | null
  getInfoAsync(fileUri: string): Promise<{ exists: boolean }>
  readAsStringAsync(fileUri: string): Promise<string>
  writeAsStringAsync(fileUri: string, value: string): Promise<void>
}

const legacyFileSystemPath = 'expo-file-system/legacy'

export type SettingsData = {
  locale: SupportedLocale | null
  localeSyncPending: boolean
}

const defaultSettings: SettingsData = {
  locale: null,
  localeSyncPending: false,
}

async function readStoredSettings(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return globalThis.localStorage?.getItem(settingsFile) ?? null
    }

    const fileSystem = (await import(
      /* @vite-ignore */ /* @metro-ignore */ legacyFileSystemPath
    )) as unknown as FileSystemShim
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

async function writeStoredSettings(value: string) {
  try {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(settingsFile, value)
      return
    }

    const fileSystem = (await import(
      /* @vite-ignore */ /* @metro-ignore */ legacyFileSystemPath
    )) as unknown as FileSystemShim
    if (!fileSystem.documentDirectory) {
      return
    }

    const fileUri = `${fileSystem.documentDirectory}${settingsFile}`
    await fileSystem.writeAsStringAsync(fileUri, value)
  } catch {
    // ignore write errors
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

export async function saveSettings(settings: Partial<SettingsData>) {
  const current = await getSavedSettings()
  const updated = { ...current, ...settings }
  await writeStoredSettings(JSON.stringify(updated))
}
