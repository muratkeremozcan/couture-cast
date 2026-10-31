// Story 6.8 Task 5 step 3 owner: check permission and commit the save in `apps/mobile/src/lib/share-card-save.native.ts`
import {
  shareCardFixtureMode,
  runShareCardNativeAdapter,
} from './share-card-native-fixture'
import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import { requireOptionalNativeModule } from 'expo-modules-core'
import { abortError, type PreparedShareCard } from '@couture/api-client'
import { shareCardPhotoSaveModule } from '../../modules/share-card-photo-save'
import {
  commitShareCardSave,
  liveShareCardFiles,
  nativeShareCardSavePending,
  retryShareCardCleanup,
  ownsCommittedShareCardFile,
} from './share-card-save-operations'
import {
  deleteShareCardFile,
  shareCardCacheDirectory,
  writeVerifiedShareCardFile,
} from './share-card-file'

export const nativeShareCardSaveAvailable = () =>
  shareCardFixtureMode() !== 'unavailable' &&
  requireOptionalNativeModule('ExpoMediaLibrary') !== null &&
  (Platform.OS === 'android' ||
    (Platform.OS === 'ios' && shareCardPhotoSaveModule() !== null))
const needsPermission = () =>
  Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) < 33)
export async function shareCardSavePermission(request: boolean) {
  if (!nativeShareCardSaveAvailable()) return { granted: false, canAskAgain: false }
  if (['permission_denied', 'permission_permanent'].includes(shareCardFixtureMode()))
    return { granted: false, canAskAgain: shareCardFixtureMode() === 'permission_denied' }
  if (shareCardFixtureMode() === 'limited')
    return { granted: true, canAskAgain: true, accessPrivileges: 'limited' as const }
  if (!needsPermission()) return { granted: true, canAskAgain: true }
  const MediaLibrary = await import('expo-media-library')
  const permission = await MediaLibrary.getPermissionsAsync(true)
  if (permission.granted || permission.accessPrivileges === 'limited')
    return { ...permission, granted: true }
  if (!request || !permission.canAskAgain) return permission
  const asked = await MediaLibrary.requestPermissionsAsync(true)
  return { ...asked, granted: asked.granted || asked.accessPrivileges === 'limited' }
}
/** Removes only abandoned `cc68-*` save files. Leased `cc69-share-*` files are never touched. */
export async function cleanOrphanShareCards() {
  await retryShareCardCleanup()
  const directory = shareCardCacheDirectory()
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
  isCurrent: () => boolean,
  owner?: object
) {
  if (!nativeShareCardSaveAvailable()) throw new Error('nativeSaveUnavailable')
  if (nativeShareCardSavePending()) throw new Error('finishingSave')
  const { fileUri, releaseFile } = await writeVerifiedShareCardFile(card, 'cc68')
  let committed = false
  try {
    if (signal.aborted || !isCurrent()) throw abortError('Save cancelled')
    // Every check above happens before atomic ownership transfer. Nothing below cancels it.
    const adapter = shareCardPhotoSaveModule()
    if (Platform.OS === 'ios' && !adapter) throw new Error('nativeSaveUnavailable')
    const pending = commitShareCardSave({
      fileUri,
      owner,
      save: () =>
        runShareCardNativeAdapter(fileUri, async () => {
          if (Platform.OS === 'ios' && adapter)
            return adapter.saveOriginalPng(fileUri, card.sha256)
          const MediaLibrary = await import('expo-media-library')
          await MediaLibrary.saveToLibraryAsync(fileUri)
        }),
      cleanup: () => FileSystem.deleteAsync(fileUri, { idempotent: true }),
    })
    // If another composer owns the guard, this file was never committed.
    committed = ownsCommittedShareCardFile(fileUri)
    await pending
  } finally {
    releaseFile()
    if (!committed) await deleteShareCardFile(fileUri)
  }
}
