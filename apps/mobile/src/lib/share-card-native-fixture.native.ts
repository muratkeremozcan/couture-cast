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
export function startShareCardNativeFixture(): () => void {
  if (!fixtureBuild()) return () => undefined
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
  return () => subscription.remove()
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
