// Story 6.9 Task 8 step 1 owner: validate results and sweep leases in `apps/mobile/src/lib/share-card-share.native.ts`
import {
  runShareCardNativeShare,
  shareCardFixtureMode,
} from './share-card-native-fixture'
import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import {
  abortError,
  ResponseError,
  SHARE_CARD_SHARE_VALID_TARGETS,
  type PrepareShareCardInput,
  type ShareCardShareOutcome,
  type ShareCardShareTarget,
} from '@couture/api-client'
import { shareCardNativeShareModule } from '../../modules/share-card-native-share'
import type {
  ShareCardNativeShareCode,
  ShareCardShareAnchor,
} from '../../modules/share-card-native-share/types'
import { prepareShareCardFromMobile } from './share-cards'
import {
  commitShareCardShare,
  liveShareCardFiles,
  nativeShareCardSavePending,
  ownsCommittedShareCardFile,
} from './share-card-save-operations'
import {
  deleteShareCardFile,
  SHARE_CARD_PUBLIC_NAME,
  shareCardCacheDirectory,
  writeVerifiedShareCardFile,
} from './share-card-file'

export type ShareCardShareCode = ShareCardNativeShareCode | 'invalid_result'
/** One validated settlement. Only these closed values ever leave this module. */
export type ShareCardShareSettlement = {
  target: ShareCardShareTarget
  outcome: ShareCardShareOutcome
  code?: ShareCardShareCode
}
/** The share prepare request without its purpose; `expectedSha256` is the previewed digest. */
export type ShareCardShareInput = Omit<
  Extract<PrepareShareCardInput, { purpose: 'save' | 'share' }>,
  'purpose'
>

/** Story 6.9: the handoff file lease, by file modification time. */
export const SHARE_CARD_SHARE_LEASE_MS = 30 * 60 * 1000
const SHARE_ENTRY = /^cc69-share-[a-f0-9-]+$/
const nativeCodes: readonly ShareCardNativeShareCode[] = [
  'presenter_unavailable',
  'file_invalid',
  'chooser_unavailable',
  'start_failed',
  'native_error',
  'busy',
]
/** The outcomes each platform's module can observe. */
const platformOutcomes: Readonly<Record<string, readonly ShareCardShareOutcome[]>> = {
  ios: ['completed', 'cancelled', 'failed'],
  android: ['target_chosen', 'not_confirmed', 'failed', 'unavailable'],
}
const resultKeys = new Set(['target', 'outcome', 'code'])
const invalidResult: ShareCardShareSettlement = {
  target: 'none',
  outcome: 'failed',
  code: 'invalid_result',
}

export const nativeShareCardShareAvailable = () =>
  shareCardFixtureMode() !== 'unavailable' &&
  (Platform.OS === 'ios' || Platform.OS === 'android') &&
  shareCardNativeShareModule() !== null

/**
 * The strict bridge validator. Keys stay within `{target, outcome, code}`, `code` comes
 * from the closed set and rides only on failed or unavailable, and only the platform's valid
 * outcome-to-target pairs pass. Any other shape, including a raw activity id, package or URI,
 * settles as failed/none.
 */
export function validateShareCardShareResult(
  raw: unknown,
  os: string = Platform.OS
): ShareCardShareSettlement {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return invalidResult
  const result = raw as Record<string, unknown>
  if (Object.keys(result).some((key) => !resultKeys.has(key))) return invalidResult
  const { target, outcome, code } = result
  const outcomes = platformOutcomes[os] ?? []
  const known = outcomes.find((candidate) => candidate === outcome)
  if (!known) return invalidResult
  const validTarget = SHARE_CARD_SHARE_VALID_TARGETS[known].find(
    (candidate) => candidate === target
  )
  if (!validTarget) return invalidResult
  if (code === undefined) return { target: validTarget, outcome: known }
  if (known !== 'failed' && known !== 'unavailable') return invalidResult
  const validCode = nativeCodes.find((candidate) => candidate === code)
  return validCode
    ? { target: validTarget, outcome: known, code: validCode }
    : invalidResult
}

/** Closed failure codes for logs. Error text can carry a URI, digest or package. */
export function shareCardShareFailureCode(error: unknown): string {
  if (error instanceof ResponseError) {
    const status = error.response.status
    if (status === 409) return 'preview_changed'
    if (status === 403) return 'forbidden'
    if (status === 401 || status === 404) return 'source_unavailable'
    return 'server'
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'aborted'
    const known: Record<string, string> = {
      previewChanged: 'preview_changed',
      render: 'render',
      offline: 'offline',
      storage: 'storage',
      finishingSave: 'busy',
      file_busy: 'busy',
      nativeShareUnavailable: 'unavailable',
    }
    return known[error.message] ?? 'error'
  }
  return 'unknown'
}
function logShareFailure(code: string) {
  console.warn(`[cc69-share] ${code}`)
}

/**
 * The 30-minute lease. Deletes each `cc69-share-<uuid>/` directory whose card's modification
 * time is older than the lease, or in the future, or that has no card, and never touches
 * `cc68-*` save files or the live handoff.
 */
export async function sweepExpiredShareCardFiles(now: number = Date.now()) {
  const directory = shareCardCacheDirectory()
  if (!(await FileSystem.getInfoAsync(directory)).exists) return
  for (const name of await FileSystem.readDirectoryAsync(directory)) {
    const entry = directory + name
    const uri = `${entry}/${SHARE_CARD_PUBLIC_NAME}`
    if (!SHARE_ENTRY.test(name) || liveShareCardFiles().has(uri)) continue
    const info = await FileSystem.getInfoAsync(uri)
    // A directory without its card was left by an interrupted write.
    const modified = info.exists ? info.modificationTime * 1000 : NaN
    const expired =
      !Number.isFinite(modified) ||
      modified > now ||
      now - modified >= SHARE_CARD_SHARE_LEASE_MS
    if (expired) await FileSystem.deleteAsync(entry, { idempotent: true })
  }
}

/**
 * Call only after an enabled Share activation. Reauthorizes the previewed bytes with
 * `purpose:'share'`, checks the response and decoded digests before any write, writes a
 * leased `cc69-share-<uuid>/couturecast-card.png`, then hands it to the OS sheet under the
 * global operation.
 * Throws before handoff; resolves with one validated settlement after it.
 */
export async function shareShareCard(
  input: ShareCardShareInput,
  options: {
    signal: AbortSignal
    isCurrent: () => boolean
    owner?: object
    anchor: () => Promise<ShareCardShareAnchor | null>
  }
): Promise<ShareCardShareSettlement> {
  try {
    const module = shareCardNativeShareModule()
    if (!nativeShareCardShareAvailable() || !module)
      throw new Error('nativeShareUnavailable')
    if (nativeShareCardSavePending()) throw new Error('finishingSave')
    await sweepExpiredShareCardFiles().catch(() => undefined)
    const authorized = await prepareShareCardFromMobile(
      { ...input, purpose: 'share' },
      options.signal
    )
    if (authorized.sha256 !== input.expectedSha256) throw new Error('previewChanged')
    if (options.signal.aborted || !options.isCurrent())
      throw abortError('Share cancelled')
    const { fileUri, releaseFile } = await writeVerifiedShareCardFile(
      authorized,
      'cc69-share',
      input.expectedSha256
    )
    let committed = false
    try {
      if (options.signal.aborted || !options.isCurrent())
        throw abortError('Share cancelled')
      // Measured at handoff, after the pending copy may have moved the button.
      const anchor = await options.anchor().catch(() => null)
      if (options.signal.aborted || !options.isCurrent())
        throw abortError('Share cancelled')
      const settled = commitShareCardShare({
        fileUri,
        owner: options.owner,
        share: () =>
          runShareCardNativeShare(() =>
            module.shareFile(fileUri, input.expectedSha256, anchor)
          ).then(
            (raw) => validateShareCardShareResult(raw),
            (): ShareCardShareSettlement => ({
              target: 'none',
              outcome: 'failed',
              code: 'native_error',
            })
          ),
      })
      // If another composer owns the guard, this file was never handed off.
      committed = ownsCommittedShareCardFile(fileUri)
      const result = await settled
      if (result.code) logShareFailure(result.code)
      return result
    } finally {
      releaseFile()
      // A handed-off file belongs to its lease; an unused one is deleted now.
      if (!committed) await deleteShareCardFile(fileUri)
    }
  } catch (failure) {
    logShareFailure(shareCardShareFailureCode(failure))
    throw failure
  }
}
