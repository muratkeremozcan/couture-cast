// Native-only by import graph: only the `.native` save and share adapters load this file.
import { shareCardFixtureMode } from './share-card-native-fixture'
import * as FileSystem from 'expo-file-system/legacy'
import * as Crypto from 'expo-crypto'
import { decodeShareCardBase64, type PreparedShareCard } from '@couture/api-client'
import {
  enqueueShareCardCleanup,
  reserveShareCardFile,
} from './share-card-save-operations'

/**
 * Save files are `cc68-<uuid>.png`. Story 6.9 share handoff files are
 * `cc69-share-<uuid>/couturecast-card.png`, so every receiver sees the public name while the
 * directory keeps the prefix that separates the two sweeps.
 */
export type ShareCardFilePrefix = 'cc68' | 'cc69-share'
export const SHARE_CARD_PUBLIC_NAME = 'couturecast-card.png'

export function shareCardCacheDirectory() {
  if (!FileSystem.cacheDirectory) throw new Error('storage')
  return `${FileSystem.cacheDirectory}share-cards/`
}
async function digestHex(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}
/** The entry under `share-cards/` a file lives in: itself, or its share handoff directory. */
function shareCardEntry(fileUri: string) {
  const name = `/${SHARE_CARD_PUBLIC_NAME}`
  return fileUri.endsWith(name) ? fileUri.slice(0, -name.length) : fileUri
}
/** Deletes now, or queues a bounded retry when the file system refuses. */
export async function deleteShareCardFile(fileUri: string) {
  const entry = shareCardEntry(fileUri)
  try {
    await FileSystem.deleteAsync(entry, { idempotent: true })
  } catch {
    enqueueShareCardCleanup(fileUri, () =>
      FileSystem.deleteAsync(entry, { idempotent: true })
    )
  }
}
/**
 * The shared prepare-file step for Save and Share. The decoded bytes must hash to the
 * response digest, and the response digest must equal the previewed one, before anything
 * touches the disk. The file is reserved before the write, so no sweep can delete it, and
 * a failed write deletes it. The caller releases the reservation and owns the file after.
 */
export async function writeVerifiedShareCardFile(
  card: PreparedShareCard,
  prefix: ShareCardFilePrefix,
  expectedSha256: string = card.sha256
) {
  if (card.sha256 !== expectedSha256) throw new Error('render')
  if ((await digestHex(decodeShareCardBase64(card.pngBase64))) !== card.sha256)
    throw new Error('render')
  const entry = `${shareCardCacheDirectory()}${prefix}-${Crypto.randomUUID()}`
  const fileUri =
    prefix === 'cc68' ? `${entry}.png` : `${entry}/${SHARE_CARD_PUBLIC_NAME}`
  const releaseFile = reserveShareCardFile(fileUri)
  try {
    if (shareCardFixtureMode() === 'cache_failure') throw new Error('storage')
    await FileSystem.makeDirectoryAsync(fileUri.slice(0, fileUri.lastIndexOf('/') + 1), {
      intermediates: true,
    })
    await FileSystem.writeAsStringAsync(fileUri, card.pngBase64, {
      encoding: FileSystem.EncodingType.Base64,
    })
  } catch (failure) {
    releaseFile()
    await deleteShareCardFile(fileUri)
    throw failure
  }
  return { fileUri, releaseFile }
}
