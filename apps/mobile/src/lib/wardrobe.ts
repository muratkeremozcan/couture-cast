import {
  ResponseError,
  type GarmentItemContract,
  type SuggestGarmentTagsData,
  type GarmentCategory,
  type GarmentMaterial,
  type GarmentComfortRange,
} from '@couture/api-client'
import { createMobileApiClient } from './api-client'

async function actionableWardrobeError(error: unknown, fallback: string): Promise<Error> {
  if (error instanceof ResponseError) {
    try {
      const payload = (await error.response.json()) as {
        error?: { message?: string }
        message?: string
      }
      return new Error(
        payload.error?.message ??
          payload.message ??
          `Wardrobe request failed with status ${error.response.status}`
      )
    } catch {
      return new Error(`Wardrobe request failed with status ${error.response.status}`)
    }
  }
  return error instanceof Error ? error : new Error(fallback)
}

async function withRequestTimeout<T>(
  signal: AbortSignal | undefined,
  request: (requestSignal: AbortSignal) => Promise<T>,
  timeoutMs = 15_000
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort(signal?.reason)

  if (signal?.aborted) {
    abortFromCaller()
  } else {
    signal?.addEventListener('abort', abortFromCaller, { once: true })
  }

  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    return await request(controller.signal)
  } catch (error) {
    if (timedOut) {
      throw new Error('Wardrobe request timed out. Please try again.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

export async function listGarmentsFromMobile(
  accessToken: string,
  signal?: AbortSignal
): Promise<GarmentItemContract[]> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({
        accessToken,
      }).apiV1WardrobeGarmentsGet({ signal: requestSignal })
    )
    return response.data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to load your wardrobe.')
  }
}

export async function suggestGarmentTagsFromMobile(
  accessToken: string,
  garmentId: string,
  signal?: AbortSignal
): Promise<SuggestGarmentTagsData> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({
        accessToken,
      }).apiV1WardrobeGarmentsGarmentIdSuggestTagsPost(
        { garmentId },
        { signal: requestSignal }
      )
    )
    return response.data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to load smart suggestions.')
  }
}

export async function updateGarmentTagsFromMobile(
  accessToken: string,
  garmentId: string,
  tags: {
    category: GarmentCategory
    material?: GarmentMaterial | null
    comfortRange: GarmentComfortRange
  },
  signal?: AbortSignal
): Promise<GarmentItemContract> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({
        accessToken,
      }).apiV1WardrobeGarmentsGarmentIdTagsPatch(
        { garmentId, updateGarmentTagsInput: tags },
        { signal: requestSignal }
      )
    )
    return response.data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to save garment tags.')
  }
}
