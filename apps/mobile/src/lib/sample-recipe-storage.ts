import { Platform } from 'react-native'
import { MAX_SAMPLE_BOOKMARK_BYTES } from '@couture/utils'

export async function sampleRecipeStorage(key: string) {
  if (Platform.OS === 'web') {
    return {
      read: () => globalThis.localStorage.getItem(key),
      write: (value: string) => globalThis.localStorage.setItem(key, value),
    }
  }
  const { File, Paths } = await import('expo-file-system')
  const file = new File(Paths.document, `${key}.json`)
  return {
    read: () =>
      file.exists && file.size <= MAX_SAMPLE_BOOKMARK_BYTES ? file.textSync() : null,
    write: (value: string) => file.write(value),
  }
}
