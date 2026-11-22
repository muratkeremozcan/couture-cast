// Story CC-7.2: Mobile client for account-backed saved looks.
import { ResponseError, withRequestDeadline } from '@couture/api-client'
import {
  savedLookListResponseSchema,
  savedLookResponseSchema,
  type CreateSavedLookInput,
  type SavedLookContract,
  type SavedLookSource,
} from '@couture/api-client/contracts/http'
import { createMobileApiClient } from './api-client'
import { resolveMobileAccessToken } from './mobile-auth'

const SAVED_LOOK_REQUEST_TIMEOUT_MS = 15_000

export class MobileSavedLookRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string
  ) {
    super(message)
    this.name = 'MobileSavedLookRequestError'
  }
}

export function formatSavedLookIfMatch(savedLookId: string, revision: number): string {
  return `"saved-look:${savedLookId}:${revision}"`
}

async function requireAccessToken(explicitToken?: string): Promise<string> {
  const token = explicitToken?.trim() || (await resolveMobileAccessToken())?.trim()
  if (!token) {
    throw new MobileSavedLookRequestError(
      'AUTHENTICATION_REQUIRED',
      401,
      'AUTHENTICATION_REQUIRED'
    )
  }
  return token
}

async function normalizeMobileSavedLookError(
  error: unknown,
  fallback: string
): Promise<Error> {
  if (error instanceof MobileSavedLookRequestError) return error
  if (error instanceof ResponseError) {
    try {
      const payload = (await error.response.json()) as {
        message?: string
        code?: string
      }
      return new MobileSavedLookRequestError(
        payload.message ??
          `Saved looks request failed with status ${error.response.status}`,
        error.response.status,
        payload.code ?? payload.message
      )
    } catch {
      return new MobileSavedLookRequestError(
        `Saved looks request failed with status ${error.response.status}`,
        error.response.status
      )
    }
  }
  return error instanceof Error ? error : new Error(fallback)
}

export type MobileSavedLookPageResult = {
  data: SavedLookContract[]
  total: number
  limit: number
  offset: number
}

const savedLookChangeListeners = new Set<(owner: string | null) => void>()

export function notifyMobileSavedLooksChanged(owner: string | null): void {
  for (const listener of savedLookChangeListeners) {
    listener(owner)
  }
}

export function subscribeMobileSavedLooksChanged(
  listener: (owner: string | null) => void
): () => void {
  savedLookChangeListeners.add(listener)
  return () => {
    savedLookChangeListeners.delete(listener)
  }
}

export async function listSavedLooksPageFromMobile(
  options: {
    accessToken?: string
    source?: SavedLookSource
    anchorGarmentId?: string
    limit?: number
    offset?: number
    signal?: AbortSignal
  } = {}
): Promise<MobileSavedLookPageResult> {
  try {
    const accessToken = await requireAccessToken(options.accessToken)
    const client = createMobileApiClient({ accessToken })
    const response = await withRequestDeadline(
      SAVED_LOOK_REQUEST_TIMEOUT_MS,
      options.signal ? [options.signal] : [],
      (requestSignal) =>
        client.apiV1WardrobeSavedLooksGet(
          {
            source: options.source,
            anchorGarmentId: options.anchorGarmentId,
            limit: options.limit,
            offset: options.offset,
          },
          { signal: requestSignal }
        )
    )
    return savedLookListResponseSchema.parse(response)
  } catch (error) {
    throw await normalizeMobileSavedLookError(error, 'Unable to load your saved looks.')
  }
}

export async function listSavedLooksFromMobile(
  options: {
    accessToken?: string
    source?: SavedLookSource
    anchorGarmentId?: string
    limit?: number
    offset?: number
    signal?: AbortSignal
  } = {}
): Promise<SavedLookContract[]> {
  const page = await listSavedLooksPageFromMobile(options)
  return page.data
}

export async function createSavedLookFromMobile(
  input: CreateSavedLookInput,
  options: {
    accessToken?: string
    idempotencyKey?: string
    signal?: AbortSignal
  } = {}
): Promise<SavedLookContract> {
  try {
    const accessToken = await requireAccessToken(options.accessToken)
    const client = createMobileApiClient({ accessToken })
    const response = await withRequestDeadline(
      SAVED_LOOK_REQUEST_TIMEOUT_MS,
      options.signal ? [options.signal] : [],
      (requestSignal) =>
        client.apiV1WardrobeSavedLooksPost(
          {
            idempotencyKey: options.idempotencyKey,
            createSavedLookInput: input,
          },
          { signal: requestSignal }
        )
    )
    return savedLookResponseSchema.parse(response).data
  } catch (error) {
    throw await normalizeMobileSavedLookError(error, 'Unable to save this look.')
  }
}

export async function getSavedLookFromMobile(
  savedLookId: string,
  options: { accessToken?: string; signal?: AbortSignal } = {}
): Promise<SavedLookContract> {
  try {
    const accessToken = await requireAccessToken(options.accessToken)
    const client = createMobileApiClient({ accessToken })
    const response = await withRequestDeadline(
      SAVED_LOOK_REQUEST_TIMEOUT_MS,
      options.signal ? [options.signal] : [],
      (requestSignal) =>
        client.apiV1WardrobeSavedLooksSavedLookIdGet(
          { savedLookId },
          { signal: requestSignal }
        )
    )
    return savedLookResponseSchema.parse(response).data
  } catch (error) {
    throw await normalizeMobileSavedLookError(error, 'Unable to open this saved look.')
  }
}

export async function restoreSavedLookFromMobile(
  savedLookId: string,
  options: { accessToken?: string; signal?: AbortSignal } = {}
): Promise<SavedLookContract> {
  try {
    const accessToken = await requireAccessToken(options.accessToken)
    const client = createMobileApiClient({ accessToken })
    const response = await withRequestDeadline(
      SAVED_LOOK_REQUEST_TIMEOUT_MS,
      options.signal ? [options.signal] : [],
      (requestSignal) =>
        client.apiV1WardrobeSavedLooksSavedLookIdRestorePost(
          { savedLookId },
          { signal: requestSignal }
        )
    )
    return savedLookResponseSchema.parse(response).data
  } catch (error) {
    throw await normalizeMobileSavedLookError(error, 'Unable to restore this saved look.')
  }
}

export async function deleteSavedLookFromMobile(
  savedLookId: string,
  ifMatch: string,
  options: { accessToken?: string; signal?: AbortSignal } = {}
): Promise<void> {
  try {
    const accessToken = await requireAccessToken(options.accessToken)
    const client = createMobileApiClient({ accessToken })
    await withRequestDeadline(
      SAVED_LOOK_REQUEST_TIMEOUT_MS,
      options.signal ? [options.signal] : [],
      (requestSignal) =>
        client.apiV1WardrobeSavedLooksSavedLookIdDelete(
          { savedLookId, ifMatch },
          { signal: requestSignal }
        )
    )
  } catch (error) {
    throw await normalizeMobileSavedLookError(error, 'Unable to remove this saved look.')
  }
}
