import {
  shareCardFixtureMode,
  waitShareCardNativePreparation,
} from './share-card-native-fixture'
import {
  abortError,
  FetchError,
  decodeShareCardBase64,
  shareCardsClient,
  type PrepareShareCardInput,
} from '@couture/api-client'
import { createMobileApiClient } from './api-client'
import { resolveMobileAccessToken } from './mobile-auth'
import { sha256Hex } from './share-card-digest'
export async function prepareShareCardFromMobile(
  input: PrepareShareCardInput,
  signal: AbortSignal
) {
  if (signal.aborted) throw abortError('Preparation cancelled')
  if (shareCardFixtureMode() === 'offline') throw new Error('offline')
  await waitShareCardNativePreparation(signal, input.purpose)
  if (signal.aborted) throw abortError('Preparation cancelled')
  const api = createMobileApiClient({
    accessToken: async () => (await resolveMobileAccessToken()) ?? '',
  })
  const card = await shareCardsClient(api)
    .prepare(input, signal)
    .catch((error: unknown) => {
      if (signal.aborted) throw abortError('Preparation cancelled')
      if (error instanceof FetchError) {
        if (error.cause.name === 'AbortError') throw error.cause
        throw new Error('offline')
      }
      throw error
    })
  const bytes = decodeShareCardBase64(card.pngBase64)
  if ((await sha256Hex(bytes)) !== card.sha256) throw new Error('render')
  if (signal.aborted) throw abortError('Preparation cancelled')
  return card
}
