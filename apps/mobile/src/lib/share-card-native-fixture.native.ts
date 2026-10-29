import { enableStory68FocusObservation } from '../../modules/accessibility-focus'
import { abortError } from '@couture/api-client'
import {
  isShareCardNativeFixtureBuild,
  isShareCardNativeFixtureUrl,
} from './share-card-native-fixture-url'
// Restricted native-adapter fixtures never change API source authorization.
import * as Application from 'expo-application'
import Constants from 'expo-constants'
import * as Linking from 'expo-linking'
import * as FileSystem from 'expo-file-system/legacy'
import {
  installShareCardOpenerTrace,
  installShareCardPresentationTrace,
  type ShareCardOpenerEvent,
} from './share-card-presentation-trace'

const fixtureBuild = () =>
  isShareCardNativeFixtureBuild(
    __DEV__,
    Application.applicationId,
    Constants.expoConfig?.extra?.story68NativeFixtures
  )
const modes = [
  'real',
  'limited',
  'prepare_deferred',
  'authorization_deferred',
  'permission_denied',
  'permission_permanent',
  'storage',
  'cache_failure',
  'offline',
  'unavailable',
  'deferred',
] as const
type Mode = (typeof modes)[number]
let mode: Mode = 'real'
const preparationWaiters = new Set<() => void>()
let releasePending: (() => void) | null = null
export function shareCardFixtureMode(): string {
  return fixtureBuild() ? mode : 'real'
}
export function shareCardPreviewTestId(loaded: boolean, digest: string) {
  if (!loaded) return 'share-card-preview'
  return fixtureBuild()
    ? `share-card-preview-loaded-${digest}`
    : 'share-card-preview-loaded'
}
const OPENER_TRACE_LIMIT = 40
/**
 * The opener trace as a small file in the app's Documents directory, which the harness reads
 * from the simulator container after a failed flow. Writes are chained so they never interleave.
 */
export function openerTraceRecorder(
  directory: string | null,
  write: (uri: string, contents: string) => Promise<void>,
  now: () => number = Date.now
) {
  const events: { e: ShareCardOpenerEvent; t: number; n?: number }[] = []
  let started: number | null = null
  let pending: Promise<void> = Promise.resolve()
  return (event: ShareCardOpenerEvent, length?: number) => {
    if (!directory) return
    started ??= now()
    // A length is a small count; anything else is dropped so no input text can ride along.
    const n =
      typeof length === 'number' && Number.isSafeInteger(length) && length >= 0
        ? Math.min(length, 99)
        : undefined
    events.push(
      n === undefined
        ? { e: event, t: now() - started }
        : { e: event, t: now() - started, n }
    )
    if (events.length > OPENER_TRACE_LIMIT) events.shift()
    const contents = JSON.stringify({ version: 1, events })
    pending = pending
      .then(() => write(`${directory}cc68-opener-trace.json`, contents))
      .catch(() => undefined)
  }
}
export function startShareCardNativeFixture(): () => void {
  if (!fixtureBuild()) return () => undefined
  // The module also checks Debug and the exact owned bundle before recording.
  void enableStory68FocusObservation()?.catch(() => undefined)
  // CI diagnostics read these closed lifecycle names from logcat after a failed flow.
  installShareCardPresentationTrace((event) =>
    console.info(`[cc68-presentation] ${event}`)
  )
  installShareCardOpenerTrace(
    openerTraceRecorder(FileSystem.documentDirectory, (uri, contents) =>
      FileSystem.writeAsStringAsync(uri, contents)
    )
  )
  const subscription = Linking.addEventListener('url', ({ url }) => {
    if (!isShareCardNativeFixtureUrl(url)) return
    const parsed = new URL(url)
    const next = parsed.searchParams.get('mode')
    if (next === 'release') {
      for (const release of [...preparationWaiters]) release()
      releasePending?.()
      releasePending = null
      return
    }
    if (modes.some((candidate) => candidate === next)) mode = next as Mode
  })
  return () => {
    subscription.remove()
    installShareCardPresentationTrace(null)
    installShareCardOpenerTrace(null)
    void enableStory68FocusObservation(false)?.catch(() => undefined)
  }
}
export async function runShareCardNativeAdapter(
  fileUri: string,
  save: () => Promise<void>
): Promise<void> {
  const fixture = shareCardFixtureMode()
  if (fixture === 'storage') throw new Error('storage')
  if (fixture === 'deferred') {
    await new Promise<void>((resolve) => {
      releasePending = resolve
    })
    // A real late native-boundary read proves navigation never deleted the owned file.
    if (!(await FileSystem.getInfoAsync(fileUri)).exists)
      throw new Error('pending_file_missing')
  }
  await save()
}

export async function waitShareCardNativePreparation(
  signal: AbortSignal,
  purpose?: 'preview' | 'save'
): Promise<void> {
  const current = shareCardFixtureMode()
  if (
    current !== 'prepare_deferred' &&
    !(current === 'authorization_deferred' && purpose === 'save')
  )
    return
  await new Promise<void>((resolve, reject) => {
    const stop = () => {
      preparationWaiters.delete(release)
      signal.removeEventListener('abort', cancel)
    }
    const release = () => {
      stop()
      resolve()
    }
    const cancel = () => {
      stop()
      reject(abortError('Preparation cancelled'))
    }
    preparationWaiters.add(release)
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
  })
}
