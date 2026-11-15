// Story 6.16 D7: the mobile guest preview store over its own local file. Kept apart from
// the analytics and API helpers so sign-in can clear guest state without loading them.
import { Platform } from 'react-native'
import {
  createGuestPreviewStore,
  SAMPLE_CATALOG,
  type GuestPreviewStorageAdapter,
  type GuestPreviewStore,
} from '@couture/utils'

export const GUEST_PREVIEW_STORAGE_KEY = 'couturecast.guest-preview'
export const GUEST_PREVIEW_FILE_NAME = 'couture-cast-guest-preview.json'

function loadNativeFileSystem() {
  // The literal import lets Metro bundle the SDK 54 legacy module while keeping it out of web runs.
  return import('expo-file-system/legacy')
}

async function guestPreviewFileUri(): Promise<string> {
  const fileSystem = await loadNativeFileSystem()
  if (!fileSystem.documentDirectory)
    throw new Error('Guest preview storage is unavailable.')
  return `${fileSystem.documentDirectory}${GUEST_PREVIEW_FILE_NAME}`
}

/** D7: guest state lives in its own file, apart from tokens, caches and settings. */
export const fileGuestPreviewAdapter: GuestPreviewStorageAdapter = {
  async read() {
    if (Platform.OS === 'web') {
      return globalThis.localStorage?.getItem(GUEST_PREVIEW_STORAGE_KEY) ?? null
    }
    const fileSystem = await loadNativeFileSystem()
    const uri = await guestPreviewFileUri()
    const info = await fileSystem.getInfoAsync(uri)
    return info.exists ? await fileSystem.readAsStringAsync(uri) : null
  },
  async write(value) {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(GUEST_PREVIEW_STORAGE_KEY, value)
      return
    }
    const fileSystem = await loadNativeFileSystem()
    await fileSystem.writeAsStringAsync(await guestPreviewFileUri(), value)
  },
  async remove() {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.removeItem(GUEST_PREVIEW_STORAGE_KEY)
      return
    }
    const fileSystem = await loadNativeFileSystem()
    await fileSystem.deleteAsync(await guestPreviewFileUri(), { idempotent: true })
  },
}

let store: GuestPreviewStore | undefined

export function mobileGuestPreviewStore(): GuestPreviewStore {
  store ??= createGuestPreviewStore({
    adapter: fileGuestPreviewAdapter,
    catalog: SAMPLE_CATALOG,
  })
  return store
}

/** Tests replace the store so each starts from its own adapter. */
export function setMobileGuestPreviewStoreForTests(next: GuestPreviewStore | undefined) {
  store = next
}
