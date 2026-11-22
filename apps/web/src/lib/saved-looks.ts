// Story CC-7.2: Web client for account-backed saved looks.
'use client'

import { ResponseError, withRequestDeadline } from '@couture/api-client'
import {
  savedLookListResponseSchema,
  savedLookResponseSchema,
  type CreateSavedLookInput,
  type SavedLookContract,
  type SavedLookSource,
} from '@couture/api-client/contracts/http'
import { createWebApiClient } from './api-client'
import { readStorage, WEB_ACCESS_TOKEN_STORAGE_KEY } from './browser-persistence'
import { currentWebSessionBearer } from './use-web-session'

const SAVED_LOOK_REQUEST_TIMEOUT_MS = 15_000

export class SavedLookRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string
  ) {
    super(message)
    this.name = 'SavedLookRequestError'
  }
}

export function formatSavedLookIfMatch(savedLookId: string, revision: number): string {
  return `"saved-look:${savedLookId}:${revision}"`
}

function resolveAccessToken(): string {
  const verified = currentWebSessionBearer()?.trim()
  if (verified) return verified
  const stored = readStorage('session', WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim()
  if (stored) return stored
  throw new SavedLookRequestError(
    'Your session expired. Sign in again to view saved looks.',
    401,
    'SIGNED_OUT'
  )
}

async function normalizeSavedLookError(error: unknown, fallback: string): Promise<Error> {
  if (error instanceof SavedLookRequestError) return error
  if (error instanceof ResponseError) {
    try {
      const payload = (await error.response.json()) as {
        message?: string
        code?: string
      }
      return new SavedLookRequestError(
        payload.message ??
          `Saved looks request failed with status ${error.response.status}`,
        error.response.status,
        payload.code ?? payload.message
      )
    } catch {
      return new SavedLookRequestError(
        `Saved looks request failed with status ${error.response.status}`,
        error.response.status
      )
    }
  }
  return error instanceof Error ? error : new Error(fallback)
}

export async function listSavedLooksFromWeb(
  options: {
    source?: SavedLookSource
    anchorGarmentId?: string
    limit?: number
    offset?: number
    signal?: AbortSignal
  } = {}
): Promise<SavedLookContract[]> {
  try {
    const accessToken = resolveAccessToken()
    const client = createWebApiClient({ accessToken })
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
    return savedLookListResponseSchema.parse(response).data
  } catch (error) {
    throw await normalizeSavedLookError(error, 'Unable to load your saved looks.')
  }
}

export async function createSavedLookFromWeb(
  input: CreateSavedLookInput,
  options: {
    idempotencyKey?: string
    signal?: AbortSignal
  } = {}
): Promise<SavedLookContract> {
  try {
    const accessToken = resolveAccessToken()
    const client = createWebApiClient({ accessToken })
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
    throw await normalizeSavedLookError(error, 'Unable to save this look.')
  }
}

export async function getSavedLookFromWeb(
  savedLookId: string,
  signal?: AbortSignal
): Promise<SavedLookContract> {
  try {
    const accessToken = resolveAccessToken()
    const client = createWebApiClient({ accessToken })
    const response = await withRequestDeadline(
      SAVED_LOOK_REQUEST_TIMEOUT_MS,
      signal ? [signal] : [],
      (requestSignal) =>
        client.apiV1WardrobeSavedLooksSavedLookIdGet(
          { savedLookId },
          { signal: requestSignal }
        )
    )
    return savedLookResponseSchema.parse(response).data
  } catch (error) {
    throw await normalizeSavedLookError(error, 'Unable to open this saved look.')
  }
}

export async function deleteSavedLookFromWeb(
  savedLookId: string,
  ifMatch: string,
  signal?: AbortSignal
): Promise<void> {
  try {
    const accessToken = resolveAccessToken()
    const client = createWebApiClient({ accessToken })
    await withRequestDeadline(
      SAVED_LOOK_REQUEST_TIMEOUT_MS,
      signal ? [signal] : [],
      (requestSignal) =>
        client.apiV1WardrobeSavedLooksSavedLookIdDelete(
          { savedLookId, ifMatch },
          { signal: requestSignal }
        )
    )
  } catch (error) {
    throw await normalizeSavedLookError(error, 'Unable to remove this saved look.')
  }
}
