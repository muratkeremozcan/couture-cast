import {
  shareCardFixtureMode,
  runShareCardNativeAdapter,
} from './share-card-native-fixture'
import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as MediaLibrary from 'expo-media-library'
import * as Crypto from 'expo-crypto'
import {
  abortError,
  decodeShareCardBase64,
  type PreparedShareCard,
} from '@couture/api-client'
import { shareCardPhotoSaveModule } from '../../modules/share-card-photo-save'
import {
  commitShareCardSave,
  liveShareCardFiles,
  nativeShareCardSavePending,
  retryShareCardCleanup,
  reserveShareCardFile,
  ownsCommittedShareCardFile,
} from './share-card-save-operations'

export const nativeShareCardSaveAvailable = () =>
  shareCardFixtureMode() !== 'unavailable' &&
  (Platform.OS === 'android' ||
    (Platform.OS === 'ios' && shareCardPhotoSaveModule() !== null))
const needsPermission = () =>
  Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) < 33)
export async function shareCardSavePermission(request: boolean) {
  if (['permission_denied', 'permission_permanent'].includes(shareCardFixtureMode()))
    return { granted: false, canAskAgain: shareCardFixtureMode() === 'permission_denied' }
  if (shareCardFixtureMode() === 'limited')
    return { granted: true, canAskAgain: true, accessPrivileges: 'limited' as const }
  if (!needsPermission()) return { granted: true, canAskAgain: true }
  const permission = await MediaLibrary.getPermissionsAsync(true)
  if (permission.granted || permission.accessPrivileges === 'limited')
    return { ...permission, granted: true }
  if (!request || !permission.canAskAgain) return permission
  const asked = await MediaLibrary.requestPermissionsAsync(true)
  return { ...asked, granted: asked.granted || asked.accessPrivileges === 'limited' }
}
function cacheDirectory() {
  if (!FileSystem.cacheDirectory) throw new Error('storage')
  return `${FileSystem.cacheDirectory}share-cards/`
}
export async function cleanOrphanShareCards() {
  await retryShareCardCleanup()
  const directory = cacheDirectory()
  if (!(await FileSystem.getInfoAsync(directory)).exists) return
  for (const name of await FileSystem.readDirectoryAsync(directory)) {
    const uri = directory + name
    if (/^cc68-[a-f0-9-]+\.png$/.test(name) && !liveShareCardFiles().has(uri))
      await FileSystem.deleteAsync(uri, { idempotent: true })
  }
}
/** Call only after explicit Save, fresh API authorization and permission activation. */
export async function saveShareCard(
  card: PreparedShareCard,
  signal: AbortSignal,
  isCurrent: () => boolean
) {
  if (!nativeShareCardSaveAvailable()) throw new Error('nativeSaveUnavailable')
  if (nativeShareCardSavePending()) throw new Error('finishingSave')
  const bytes = decodeShareCardBase64(card.pngBase64)
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)
  if (
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    ) !== card.sha256
  )
    throw new Error('render')
  const directory = cacheDirectory()
  const fileUri = `${directory}cc68-${Crypto.randomUUID()}.png`
  const releaseFile = reserveShareCardFile(fileUri)
  let committed = false
  try {
    if (shareCardFixtureMode() === 'cache_failure') throw new Error('storage')
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true })
    await FileSystem.writeAsStringAsync(fileUri, card.pngBase64, {
      encoding: FileSystem.EncodingType.Base64,
    })
    if (signal.aborted || !isCurrent()) throw abortError('Save cancelled')
    // Every check above happens before atomic ownership transfer. Nothing below cancels it.
    const adapter = shareCardPhotoSaveModule()
    if (Platform.OS === 'ios' && !adapter) throw new Error('nativeSaveUnavailable')
    const pending = commitShareCardSave({
      fileUri,
      save: () =>
        runShareCardNativeAdapter(fileUri, () =>
          Platform.OS === 'ios' && adapter
            ? adapter.saveOriginalPng(fileUri, card.sha256)
            : MediaLibrary.saveToLibraryAsync(fileUri)
        ),
      cleanup: () => FileSystem.deleteAsync(fileUri, { idempotent: true }),
    })
    // If another composer owns the guard, this file was never committed.
    committed = ownsCommittedShareCardFile(fileUri)
    await pending
  } finally {
    releaseFile()
    if (!committed) await FileSystem.deleteAsync(fileUri, { idempotent: true })
  }
}
