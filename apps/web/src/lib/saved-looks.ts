// Story CC-7.2 & CC-7.3: Web client for account-backed saved looks and same-member legacy device import.
'use client'

import { ResponseError, withRequestDeadline } from '@couture/api-client'
import {
  savedLookListResponseSchema,
  savedLookResponseSchema,
  type CreateSavedLookInput,
  type GarmentItemContract,
  type SavedLookContract,
  type SavedLookSource,
} from '@couture/api-client/contracts/http'
import {
  memberSampleBookmarksStorageKeys,
  parseLegacyHomeSampleBookmarksForImport,
  parseLegacyStylePieceRecipesForImport,
  parseMemberSampleBookmarksStorageKey,
  parseStylePieceStorageKey,
  type LegacySavedLookImportEntry,
  type StylePieceAnchor,
} from '@couture/utils'
import { createWebApiClient } from './api-client'
import { readStorage, WEB_ACCESS_TOKEN_STORAGE_KEY } from './browser-persistence'
import {
  currentWebSessionBearer,
  currentWebSessionOwner,
  isLiveOwner,
  UNVERIFIED_BEARER_OWNER,
} from './use-web-session'
import { listGarmentsFromWeb } from './wardrobe'

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

export type LegacyDeviceSavedLooksImportResult = {
  imported: SavedLookContract[]
  pendingKeys: number
}

const savedLookChangeListeners = new Set<(owner: string | null) => void>()
const acknowledgedWebImportKeys = new Set<string>()

export function resetWebLegacySavedLooksImportState(): void {
  acknowledgedWebImportKeys.clear()
}

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

function safeReadLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeWriteLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Ignore blocked or quota-exceeded storage
  }
}

function safeRemoveLocalStorage(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Ignore blocked storage
  }
}

function discoverWebStylePieceKeysForOwner(
  owner: string
): { key: string; garmentId: string }[] {
  const matches: { key: string; garmentId: string }[] = []
  try {
    const storage = window.localStorage
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (!key || !key.startsWith('couturecast.style-piece.')) continue
      const parsed = parseStylePieceStorageKey(key)
      if (parsed?.owner === owner) {
        matches.push({ key, garmentId: parsed.garmentId })
      }
    }
  } catch {
    return []
  }
  return matches
}

function isTerminalImportError(error: unknown): boolean {
  return (
    error instanceof SavedLookRequestError &&
    (error.status === 400 || error.status === 404 || error.status === 409)
  )
}

async function importParsedWebStorageKey<TRaw>(params: {
  key: string
  owner: string
  parsed: {
    entries: readonly LegacySavedLookImportEntry<TRaw>[]
    hadInvalidEntries: boolean
    malformedPayload: boolean
  }
  pinnedToken: string
  signal?: AbortSignal
  isCurrent: () => boolean
  imported: SavedLookContract[]
}): Promise<boolean> {
  const { key, owner, parsed, pinnedToken, signal, isCurrent, imported } = params
  if (parsed.malformedPayload || parsed.entries.length === 0) {
    if (isCurrent()) safeRemoveLocalStorage(key)
    return false
  }

  for (const entry of [...parsed.entries].reverse()) {
    if (!isCurrent()) break
    try {
      const created = await createSavedLookFromWeb(entry.payload, {
        accessToken: pinnedToken,
        idempotencyKey: entry.idempotencyKey,
        signal,
      })
      acknowledgedWebImportKeys.add(`${owner}:${entry.idempotencyKey}`)
      imported.push(created)
    } catch (error) {
      if (isTerminalImportError(error)) {
        acknowledgedWebImportKeys.add(`${owner}:${entry.idempotencyKey}`)
      }
    }
  }

  const remaining = parsed.entries.filter(
    (entry) => !acknowledgedWebImportKeys.has(`${owner}:${entry.idempotencyKey}`)
  )
  if (remaining.length === 0) {
    safeRemoveLocalStorage(key)
    return false
  }
  if (
    (remaining.length < parsed.entries.length || parsed.hadInvalidEntries) &&
    safeReadLocalStorage(key) !== null
  ) {
    safeWriteLocalStorage(key, JSON.stringify(remaining.map((entry) => entry.rawEntry)))
  }
  return true
}

function buildReadyAnchorsById(
  garments: readonly GarmentItemContract[]
): Map<string, StylePieceAnchor> {
  const anchorsById = new Map<string, StylePieceAnchor>()
  for (const garment of garments) {
    if (
      garment.status === 'ready' &&
      garment.retentionStatus === 'active' &&
      garment.category &&
      garment.comfortRange
    ) {
      anchorsById.set(garment.id, {
        category: garment.category,
        comfortRange: garment.comfortRange,
      })
    }
  }
  return anchorsById
}

function collectWebLegacyTargets(
  owner: string,
  sources?: readonly SavedLookSource[]
): {
  homeSampleTargets: { key: string; raw: string }[]
  stylePieceTargets: { key: string; garmentId: string; raw: string }[]
} {
  const includeHomeSample = !sources || sources.includes('home_sample')
  const includeStylePiece = !sources || sources.includes('style_piece')

  const homeSampleTargets = includeHomeSample
    ? memberSampleBookmarksStorageKeys(owner)
        .filter((key) => parseMemberSampleBookmarksStorageKey(key) === owner)
        .flatMap((key) => {
          const raw = safeReadLocalStorage(key)
          return raw !== null ? [{ key, raw }] : []
        })
    : []

  const stylePieceTargets = includeStylePiece
    ? discoverWebStylePieceKeysForOwner(owner).flatMap((candidate) => {
        const raw = safeReadLocalStorage(candidate.key)
        return raw !== null ? [{ ...candidate, raw }] : []
      })
    : []

  return { homeSampleTargets, stylePieceTargets }
}

async function importWebStylePieceTargets(params: {
  targets: { key: string; garmentId: string; raw: string }[]
  owner: string
  pinnedToken: string
  garments?: readonly GarmentItemContract[]
  loadGarments?: (signal?: AbortSignal) => Promise<readonly GarmentItemContract[] | null>
  signal?: AbortSignal
  isCurrent: () => boolean
  imported: SavedLookContract[]
}): Promise<number> {
  const { targets, owner, pinnedToken, signal, isCurrent, imported } = params
  let garments: readonly GarmentItemContract[] | null | undefined = params.garments
  if (!garments && isCurrent()) {
    garments = await (
      params.loadGarments ? params.loadGarments(signal) : listGarmentsFromWeb(signal)
    ).catch(() => null)
  }

  if (!garments || !isCurrent()) {
    return targets.length
  }

  const anchorsById = buildReadyAnchorsById(garments)
  let pendingKeys = 0
  for (const target of targets) {
    const stillPending = await importParsedWebStorageKey({
      key: target.key,
      owner,
      parsed: parseLegacyStylePieceRecipesForImport(
        target.raw,
        owner,
        target.garmentId,
        anchorsById.get(target.garmentId) ?? null
      ),
      pinnedToken,
      signal,
      isCurrent,
      imported,
    })
    if (stillPending) pendingKeys += 1
  }
  return pendingKeys
}

/**
 * Story CC-7.3: Imports pre-CC-7.2 device-saved looks (`couturecast.member-sample-bookmarks.<owner>`
 * and `couturecast.style-piece.<scope>`) belonging strictly to the authenticated `owner`.
 * Guest preview storage (`couturecast.guest-preview.v1`) and keys belonging to any other member
 * are never read, imported, or deleted.
 */
export async function importLegacyDeviceSavedLooksFromWeb(options: {
  owner: string | null | undefined
  accessToken?: string
  garments?: readonly GarmentItemContract[]
  loadGarments?: (signal?: AbortSignal) => Promise<readonly GarmentItemContract[] | null>
  sources?: readonly SavedLookSource[]
  signal?: AbortSignal
  isCurrentOwner?: () => boolean
  notify?: boolean
}): Promise<LegacyDeviceSavedLooksImportResult> {
  const owner = options.owner?.trim() ?? ''
  const isCurrent = () =>
    Boolean(owner && owner !== UNVERIFIED_BEARER_OWNER) &&
    !options.signal?.aborted &&
    (options.isCurrentOwner ? options.isCurrentOwner() : isLiveOwner(owner))

  if (!isCurrent()) {
    return { imported: [], pendingKeys: 0 }
  }

  const { homeSampleTargets, stylePieceTargets } = collectWebLegacyTargets(
    owner,
    options.sources
  )
  if (homeSampleTargets.length === 0 && stylePieceTargets.length === 0) {
    return { imported: [], pendingKeys: 0 }
  }

  const pinnedToken = resolveAccessToken(options.accessToken)
  const imported: SavedLookContract[] = []
  let pendingKeys = 0

  for (const target of homeSampleTargets) {
    const stillPending = await importParsedWebStorageKey({
      key: target.key,
      owner,
      parsed: parseLegacyHomeSampleBookmarksForImport(target.raw, owner),
      pinnedToken,
      signal: options.signal,
      isCurrent,
      imported,
    })
    if (stillPending) pendingKeys += 1
  }

  if (stylePieceTargets.length > 0) {
    pendingKeys += await importWebStylePieceTargets({
      targets: stylePieceTargets,
      owner,
      pinnedToken,
      garments: options.garments,
      loadGarments: options.loadGarments,
      signal: options.signal,
      isCurrent,
      imported,
    })
  }

  if (imported.length > 0 && isCurrent() && options.notify) {
    notifySavedLooksChanged(owner)
  }

  return { imported, pendingKeys }
}

export async function listSavedLooksPageFromWeb(
  options: {
    owner?: string | null
    accessToken?: string
    garments?: readonly GarmentItemContract[]
    source?: SavedLookSource
    anchorGarmentId?: string
    limit?: number
    offset?: number
    signal?: AbortSignal
  } = {}
): Promise<SavedLookPageResult> {
  try {
    const accessToken = resolveAccessToken(options.accessToken)
    const activeOwner = options.owner ?? currentWebSessionOwner()
    if (
      activeOwner &&
      activeOwner !== UNVERIFIED_BEARER_OWNER &&
      (options.offset ?? 0) === 0
    ) {
      await importLegacyDeviceSavedLooksFromWeb({
        owner: activeOwner,
        accessToken,
        garments: options.garments,
        signal: options.signal,
        isCurrentOwner: () => {
          const live = currentWebSessionOwner()
          return live === activeOwner || live === UNVERIFIED_BEARER_OWNER
        },
      }).catch(() => undefined)
    }

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
    owner?: string | null
    accessToken?: string
    garments?: readonly GarmentItemContract[]
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
