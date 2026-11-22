// Story CC-7.2 & CC-7.3: Mobile client for account-backed saved looks and same-member legacy device import.
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
  parseLegacyHomeSampleBookmarksForImport,
  parseLegacyStylePieceRecipesForImport,
  type LegacySavedLookImportEntry,
  type StylePieceAnchor,
} from '@couture/utils'
import { createMobileApiClient } from './api-client'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  resolveMobileAccessToken,
} from './mobile-auth'
import {
  discoverMobileHomeSampleStorageForOwner,
  discoverMobileStylePieceStorageForOwner,
  type SampleRecipeStorageHandle,
} from './sample-recipe-storage'
import { listGarmentsFromMobile } from './wardrobe'

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

export type MobileLegacySavedLooksImportResult = {
  imported: SavedLookContract[]
  pendingKeys: number
}

const savedLookChangeListeners = new Set<(owner: string | null) => void>()
const acknowledgedMobileImportKeys = new Set<string>()

export function resetMobileLegacySavedLooksImportState(): void {
  acknowledgedMobileImportKeys.clear()
}

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

function isTerminalMobileImportError(error: unknown): boolean {
  return (
    error instanceof MobileSavedLookRequestError &&
    (error.status === 400 || error.status === 404 || error.status === 409)
  )
}

async function importParsedMobileStorageKey<TRaw>(params: {
  handle: SampleRecipeStorageHandle
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
  const { handle, owner, parsed, pinnedToken, signal, isCurrent, imported } = params
  if (parsed.malformedPayload || parsed.entries.length === 0) {
    if (isCurrent()) handle.remove()
    return false
  }

  for (const entry of [...parsed.entries].reverse()) {
    if (!isCurrent()) break
    try {
      const created = await createSavedLookFromMobile(entry.payload, {
        accessToken: pinnedToken,
        idempotencyKey: entry.idempotencyKey,
        signal,
      })
      acknowledgedMobileImportKeys.add(`${owner}:${entry.idempotencyKey}`)
      imported.push(created)
    } catch (error) {
      if (isTerminalMobileImportError(error)) {
        acknowledgedMobileImportKeys.add(`${owner}:${entry.idempotencyKey}`)
      }
    }
  }

  const remaining = parsed.entries.filter(
    (entry) => !acknowledgedMobileImportKeys.has(`${owner}:${entry.idempotencyKey}`)
  )
  if (remaining.length === 0) {
    handle.remove()
    return false
  }
  if (
    (remaining.length < parsed.entries.length || parsed.hadInvalidEntries) &&
    handle.read() !== null
  ) {
    handle.write(JSON.stringify(remaining.map((entry) => entry.rawEntry)))
  }
  return true
}

function buildMobileReadyAnchorsById(
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

async function importMobileStylePieceTargets(params: {
  targets: Awaited<ReturnType<typeof discoverMobileStylePieceStorageForOwner>>
  owner: string
  pinnedToken: string
  garments?: readonly GarmentItemContract[]
  loadGarments?: (
    accessToken: string,
    signal?: AbortSignal
  ) => Promise<readonly GarmentItemContract[] | null>
  signal?: AbortSignal
  isCurrent: () => boolean
  imported: SavedLookContract[]
}): Promise<number> {
  const { targets, owner, pinnedToken, signal, isCurrent, imported } = params
  let garments: readonly GarmentItemContract[] | null | undefined = params.garments
  if (!garments && isCurrent()) {
    garments = await (
      params.loadGarments
        ? params.loadGarments(pinnedToken, signal)
        : listGarmentsFromMobile(pinnedToken, signal)
    ).catch(() => null)
  }

  if (!garments || !isCurrent()) {
    return targets.length
  }

  const anchorsById = buildMobileReadyAnchorsById(garments)
  let pendingKeys = 0
  for (const target of targets) {
    const stillPending = await importParsedMobileStorageKey({
      handle: target.handle,
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

async function collectMobileLegacyTargets(params: {
  owner: string
  sources?: readonly SavedLookSource[]
  knownGarmentIds?: readonly string[]
  garments?: readonly GarmentItemContract[]
}) {
  const { owner, sources, knownGarmentIds, garments } = params
  const includeHomeSample = !sources || sources.includes('home_sample')
  const includeStylePiece = !sources || sources.includes('style_piece')

  const homeSampleTargets = includeHomeSample
    ? await discoverMobileHomeSampleStorageForOwner(owner)
    : []

  const initialKnownIds = [
    ...(knownGarmentIds ?? []),
    ...(garments?.map((item) => item.id) ?? []),
  ]
  const stylePieceTargets = includeStylePiece
    ? await discoverMobileStylePieceStorageForOwner(owner, initialKnownIds)
    : []

  return { homeSampleTargets, stylePieceTargets }
}

/**
 * Story CC-7.3: Imports pre-CC-7.2 device-saved looks (`couturecast.member-sample-bookmarks.<owner>`
 * and `couturecast.style-piece.<scope>`) belonging strictly to the authenticated `owner`.
 * Guest preview storage (`couturecast.guest-preview.v1`) and keys belonging to any other member
 * are never read, imported, or deleted.
 */
export async function importLegacyDeviceSavedLooksFromMobile(
  options: {
    owner?: string | null
    epoch?: number
    accessToken?: string
    garments?: readonly GarmentItemContract[]
    knownGarmentIds?: readonly string[]
    loadGarments?: (
      accessToken: string,
      signal?: AbortSignal
    ) => Promise<readonly GarmentItemContract[] | null>
    sources?: readonly SavedLookSource[]
    signal?: AbortSignal
    isCurrentSession?: () => boolean
    notify?: boolean
  } = {}
): Promise<MobileLegacySavedLooksImportResult> {
  const owner = (options.owner ?? mobileApplicationUserId())?.trim() ?? ''
  const startEpoch = options.epoch ?? mobileIdentityEpoch()
  const isCurrent = () =>
    Boolean(owner) &&
    !options.signal?.aborted &&
    (options.isCurrentSession
      ? options.isCurrentSession()
      : mobileApplicationUserId() === owner && mobileIdentityEpoch() === startEpoch)

  if (!isCurrent()) {
    return { imported: [], pendingKeys: 0 }
  }

  const { homeSampleTargets, stylePieceTargets } = await collectMobileLegacyTargets({
    owner,
    sources: options.sources,
    knownGarmentIds: options.knownGarmentIds,
    garments: options.garments,
  })

  if (homeSampleTargets.length === 0 && stylePieceTargets.length === 0) {
    return { imported: [], pendingKeys: 0 }
  }

  const pinnedToken = await requireAccessToken(options.accessToken)
  if (!isCurrent()) {
    return {
      imported: [],
      pendingKeys: homeSampleTargets.length + stylePieceTargets.length,
    }
  }

  const imported: SavedLookContract[] = []
  let pendingKeys = 0

  for (const target of homeSampleTargets) {
    const stillPending = await importParsedMobileStorageKey({
      handle: target.handle,
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
    pendingKeys += await importMobileStylePieceTargets({
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
    notifyMobileSavedLooksChanged(owner)
  }

  return { imported, pendingKeys }
}

export async function listSavedLooksPageFromMobile(
  options: {
    owner?: string | null
    epoch?: number
    accessToken?: string
    garments?: readonly GarmentItemContract[]
    knownGarmentIds?: readonly string[]
    source?: SavedLookSource
    anchorGarmentId?: string
    limit?: number
    offset?: number
    signal?: AbortSignal
  } = {}
): Promise<MobileSavedLookPageResult> {
  try {
    const startEpoch = options.epoch ?? mobileIdentityEpoch()
    const activeOwner = options.owner ?? mobileApplicationUserId()
    const accessToken = await requireAccessToken(options.accessToken)
    if (activeOwner && (options.offset ?? 0) === 0) {
      await importLegacyDeviceSavedLooksFromMobile({
        owner: activeOwner,
        epoch: startEpoch,
        accessToken,
        garments: options.garments,
        knownGarmentIds: [
          ...(options.knownGarmentIds ?? []),
          ...(options.anchorGarmentId ? [options.anchorGarmentId] : []),
        ],
        signal: options.signal,
      }).catch(() => undefined)
    }

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
    owner?: string | null
    epoch?: number
    accessToken?: string
    garments?: readonly GarmentItemContract[]
    knownGarmentIds?: readonly string[]
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
