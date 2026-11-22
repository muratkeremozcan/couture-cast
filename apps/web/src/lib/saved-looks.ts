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

export type SavedLookPageResult = {
  data: SavedLookContract[]
  total: number
  limit: number
  offset: number
}

const savedLookChangeListeners = new Set<(owner: string | null) => void>()

export function notifySavedLooksChanged(owner: string | null): void {
  for (const listener of savedLookChangeListeners) {
    listener(owner)
  }
}

export function subscribeSavedLooksChanged(
  listener: (owner: string | null) => void
): () => void {
  savedLookChangeListeners.add(listener)
  return () => {
    savedLookChangeListeners.delete(listener)
  }
}

function resolveAccessToken(explicitToken?: string): string {
  const pinned = explicitToken?.trim()
  if (pinned) return pinned
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

export async function listSavedLooksPageFromWeb(
  options: {
    accessToken?: string
    source?: SavedLookSource
    anchorGarmentId?: string
    limit?: number
    offset?: number
    signal?: AbortSignal
  } = {}
): Promise<SavedLookPageResult> {
  try {
    const accessToken = resolveAccessToken(options.accessToken)
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
    return savedLookListResponseSchema.parse(response)
  } catch (error) {
    throw await normalizeSavedLookError(error, 'Unable to load your saved looks.')
  }
}

export async function listSavedLooksFromWeb(
  options: {
    accessToken?: string
    source?: SavedLookSource
    anchorGarmentId?: string
    limit?: number
    offset?: number
    signal?: AbortSignal
  } = {}
): Promise<SavedLookContract[]> {
  const page = await listSavedLooksPageFromWeb(options)
  return page.data
}

export async function createSavedLookFromWeb(
  input: CreateSavedLookInput,
  options: {
    accessToken?: string
    idempotencyKey?: string
    signal?: AbortSignal
  } = {}
): Promise<SavedLookContract> {
  try {
    const accessToken = resolveAccessToken(options.accessToken)
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
  options?: AbortSignal | { accessToken?: string; signal?: AbortSignal }
): Promise<SavedLookContract> {
  const resolved =
    options && typeof options === 'object' && 'aborted' in options
      ? { signal: options }
      : (options ?? {})
  try {
    const accessToken = resolveAccessToken(resolved.accessToken)
    const client = createWebApiClient({ accessToken })
    const response = await withRequestDeadline(
      SAVED_LOOK_REQUEST_TIMEOUT_MS,
      resolved.signal ? [resolved.signal] : [],
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

export async function restoreSavedLookFromWeb(
  savedLookId: string,
  options: { accessToken?: string; signal?: AbortSignal } = {}
): Promise<SavedLookContract> {
  try {
    const accessToken = resolveAccessToken(options.accessToken)
    const client = createWebApiClient({ accessToken })
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
    throw await normalizeSavedLookError(error, 'Unable to restore this saved look.')
  }
}

export async function deleteSavedLookFromWeb(
  savedLookId: string,
  ifMatch: string,
  options?: AbortSignal | { accessToken?: string; signal?: AbortSignal }
): Promise<void> {
  const resolved =
    options && typeof options === 'object' && 'aborted' in options
      ? { signal: options }
      : (options ?? {})
  try {
    const accessToken = resolveAccessToken(resolved.accessToken)
    const client = createWebApiClient({ accessToken })
    await withRequestDeadline(
      SAVED_LOOK_REQUEST_TIMEOUT_MS,
      resolved.signal ? [resolved.signal] : [],
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
