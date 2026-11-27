// Story CC-7.2 & CC-7.3: Mobile client for account-backed saved looks and same-member legacy device import.
import { abortError, ResponseError, withRequestDeadline } from '@couture/api-client'
import {
  savedLookListResponseSchema,
  savedLookResponseSchema,
  type CreateSavedLookInput,
  type GarmentItemContract,
  type ListSavedLooksQuery,
  type SavedLookContract,
  type SavedLookListSort,
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
  createMobileDiscoveryBudget,
  discoverMobileHomeSampleStorageForOwner,
  discoverMobileStylePieceStorageForOwner,
  type SampleRecipeStorageHandle,
} from './sample-recipe-storage'
import { listGarmentsFromMobile } from './wardrobe'

const SAVED_LOOK_REQUEST_TIMEOUT_MS = 15_000
const ERROR_BODY_PARSE_TIMEOUT_MS = 2_000
const MAX_LEGACY_IMPORT_DURATION_MS = 15_000

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

async function readMobileErrorJsonWithTimeout(
  response: Response
): Promise<{ message?: string; code?: string } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const payload = await Promise.race([
      response.json() as Promise<{ message?: string; code?: string }>,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ERROR_BODY_PARSE_TIMEOUT_MS)
      }),
    ])
    return payload
  } catch {
    return null
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function normalizeMobileSavedLookError(
  error: unknown,
  fallback: string
): Promise<Error> {
  if (error instanceof MobileSavedLookRequestError) return error
  if (error instanceof ResponseError) {
    const payload = await readMobileErrorJsonWithTimeout(error.response)
    if (payload) {
      return new MobileSavedLookRequestError(
        payload.message ??
          `Saved looks request failed with status ${error.response.status}`,
        error.response.status,
        payload.code ?? payload.message
      )
    }
    return new MobileSavedLookRequestError(
      `Saved looks request failed with status ${error.response.status}`,
      error.response.status
    )
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
const inFlightMobileImportBySession = new Map<
  string,
  Promise<MobileLegacySavedLooksImportResult>
>()

export function resetMobileLegacySavedLooksImportState(): void {
  acknowledgedMobileImportKeys.clear()
  inFlightMobileImportBySession.clear()
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
  if (!(error instanceof MobileSavedLookRequestError)) return false
  const tag = error.code ?? error.message
  if (error.status === 400) return true
  if (error.status === 404 && tag === 'GARMENT_NOT_FOUND') return true
  if (error.status === 409 && tag === 'SAVED_LOOK_ALREADY_REMOVED') return true
  return false
}

function isMobilePayloadMismatchConflict(error: unknown): boolean {
  if (!(error instanceof MobileSavedLookRequestError) || error.status !== 409) {
    return false
  }
  const tag = error.code ?? error.message
  return tag === 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'
}

function normalizedMobileSwapsEqual(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined
): boolean {
  const leftEntries = Object.entries(left ?? {}).filter(([, value]) => Boolean(value))
  const rightEntries = Object.entries(right ?? {}).filter(([, value]) => Boolean(value))
  if (leftEntries.length !== rightEntries.length) return false
  const rightMap = new Map(rightEntries)
  return leftEntries.every(([key, value]) => rightMap.get(key) === value)
}

function mobileSavedLookMatchesImportPayload(
  item: SavedLookContract,
  payload: CreateSavedLookInput
): boolean {
  if (
    item.source !== payload.source ||
    item.lookId !== payload.lookId ||
    item.weather !== payload.weather ||
    (item.anchorGarmentId ?? null) !== (payload.anchorGarmentId ?? null) ||
    !normalizedMobileSwapsEqual(item.swaps, payload.swaps)
  ) {
    return false
  }
  if (payload.source !== 'home_sample') return true
  return (
    (item.collection ?? null) === (payload.collection ?? null) &&
    item.comfort?.runsColdWarm === payload.comfort?.runsColdWarm &&
    item.comfort?.windTolerance === payload.comfort?.windTolerance &&
    item.comfort?.precipPreparedness === payload.comfort?.precipPreparedness
  )
}

function runMobileWithRemainingDeadline<T>(
  deadlineMs: number,
  signal: AbortSignal | undefined,
  work: (scopedSignal: AbortSignal) => Promise<T>
): Promise<T> {
  const remainingMs = deadlineMs - Date.now()
  if (remainingMs <= 0) {
    return Promise.reject(abortError('Legacy import deadline exceeded'))
  }
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), remainingMs)
  return work(controller.signal).finally(() => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  })
}

async function reconcileExistingAccountLookFromMobile(params: {
  payload: CreateSavedLookInput
  pinnedToken: string
  deadlineMs: number
  signal?: AbortSignal
  isCurrent: () => boolean
}): Promise<SavedLookContract | null> {
  const { payload, pinnedToken, deadlineMs, signal, isCurrent } = params
  let offset = 0
  try {
    while (isCurrent() && Date.now() < deadlineMs) {
      const page = await runMobileWithRemainingDeadline(
        deadlineMs,
        signal,
        (scopedSignal) =>
          listSavedLooksPageFromMobile({
            accessToken: pinnedToken,
            source: payload.source,
            anchorGarmentId: payload.anchorGarmentId ?? undefined,
            limit: 50,
            offset,
            signal: scopedSignal,
            skipLegacyImport: true,
          })
      )
      if (!isCurrent()) return null
      const match = page.data.find((item) =>
        mobileSavedLookMatchesImportPayload(item, payload)
      )
      if (match) return match
      offset += page.data.length
      if (page.data.length === 0 || offset >= page.total) return null
    }
    return null
  } catch {
    return null
  }
}

function mobileAckKey(owner: string, entry: LegacySavedLookImportEntry<unknown>): string {
  return `${owner}:${entry.idempotencyKey}:${JSON.stringify(entry.rawEntry)}`
}

function finalizeMobileStorageKey<TRaw>(params: {
  handle: SampleRecipeStorageHandle
  originalRaw: string
  owner: string
  parsed: {
    entries: readonly LegacySavedLookImportEntry<TRaw>[]
    hadInvalidEntries: boolean
  }
  reparse: (raw: string) => {
    entries: readonly LegacySavedLookImportEntry<TRaw>[]
    hadInvalidEntries: boolean
    malformedPayload: boolean
  }
  isCurrent: () => boolean
}): boolean {
  const { handle, originalRaw, owner, parsed, reparse, isCurrent } = params
  if (!isCurrent()) return true

  const currentRaw = handle.read()
  if (currentRaw === null) return false

  const activeParsed = currentRaw === originalRaw ? parsed : reparse(currentRaw)
  const remaining = activeParsed.entries.filter(
    (entry) => !acknowledgedMobileImportKeys.has(mobileAckKey(owner, entry))
  )

  if (remaining.length === 0) {
    if (isCurrent()) handle.remove()
    return false
  }

  const changed =
    currentRaw !== originalRaw ||
    remaining.length < parsed.entries.length ||
    activeParsed.hadInvalidEntries
  if (changed && isCurrent()) {
    handle.write(JSON.stringify(remaining.map((entry) => entry.rawEntry)))
  }
  return true
}

async function importSingleMobileEntry<TRaw>(params: {
  entry: LegacySavedLookImportEntry<TRaw>
  owner: string
  pinnedToken: string
  deadlineMs: number
  signal?: AbortSignal
  isCurrent: () => boolean
  imported: SavedLookContract[]
}): Promise<void> {
  const { entry, owner, pinnedToken, deadlineMs, signal, isCurrent, imported } = params
  const ackKey = mobileAckKey(owner, entry)
  try {
    const created = await runMobileWithRemainingDeadline(
      deadlineMs,
      signal,
      (scopedSignal) =>
        createSavedLookFromMobile(entry.payload, {
          accessToken: pinnedToken,
          idempotencyKey: entry.idempotencyKey,
          signal: scopedSignal,
        })
    )
    if (!isCurrent()) return
    acknowledgedMobileImportKeys.add(ackKey)
    imported.push(created)
  } catch (error) {
    if (!isCurrent()) return
    if (isTerminalMobileImportError(error)) {
      acknowledgedMobileImportKeys.add(ackKey)
      return
    }
    if (isMobilePayloadMismatchConflict(error)) {
      const existing = await reconcileExistingAccountLookFromMobile({
        payload: entry.payload,
        pinnedToken,
        deadlineMs,
        signal,
        isCurrent,
      })
      if (existing && isCurrent()) {
        acknowledgedMobileImportKeys.add(ackKey)
        imported.push(existing)
      }
    }
  }
}

async function importParsedMobileStorageKey<TRaw>(params: {
  handle: SampleRecipeStorageHandle
  originalRaw: string
  owner: string
  parsed: {
    entries: readonly LegacySavedLookImportEntry<TRaw>[]
    hadInvalidEntries: boolean
    malformedPayload: boolean
  }
  reparse: (raw: string) => {
    entries: readonly LegacySavedLookImportEntry<TRaw>[]
    hadInvalidEntries: boolean
    malformedPayload: boolean
  }
  pinnedToken: string
  deadlineMs: number
  signal?: AbortSignal
  isCurrent: () => boolean
  imported: SavedLookContract[]
}): Promise<boolean> {
  const {
    handle,
    originalRaw,
    owner,
    parsed,
    reparse,
    pinnedToken,
    deadlineMs,
    signal,
    isCurrent,
    imported,
  } = params
  if (parsed.malformedPayload || parsed.entries.length === 0) {
    if (isCurrent() && handle.read() === originalRaw) {
      handle.remove()
    }
    return false
  }

  for (const entry of [...parsed.entries].reverse()) {
    if (!isCurrent() || Date.now() > deadlineMs) break
    await importSingleMobileEntry({
      entry,
      owner,
      pinnedToken,
      deadlineMs,
      signal,
      isCurrent,
      imported,
    })
  }

  return finalizeMobileStorageKey({
    handle,
    originalRaw,
    owner,
    parsed,
    reparse,
    isCurrent,
  })
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
  deadlineMs: number
  garments?: readonly GarmentItemContract[]
  loadGarments?: (
    accessToken: string,
    signal?: AbortSignal
  ) => Promise<readonly GarmentItemContract[] | null>
  signal?: AbortSignal
  isCurrent: () => boolean
  imported: SavedLookContract[]
}): Promise<number> {
  const { targets, owner, pinnedToken, deadlineMs, signal, isCurrent, imported } = params
  let garments: readonly GarmentItemContract[] | null | undefined = params.garments
  if (!garments && isCurrent()) {
    if (Date.now() >= deadlineMs) return targets.length
    garments = await runMobileWithRemainingDeadline(deadlineMs, signal, (scopedSignal) =>
      params.loadGarments
        ? params.loadGarments(pinnedToken, scopedSignal)
        : listGarmentsFromMobile(pinnedToken, scopedSignal)
    ).catch(() => null)
  }

  if (!garments || !isCurrent()) {
    return targets.length
  }

  const anchorsById = buildMobileReadyAnchorsById(garments)
  let pendingKeys = 0
  for (const target of targets) {
    if (!isCurrent() || Date.now() > deadlineMs) {
      pendingKeys += 1
      continue
    }
    const anchor = anchorsById.get(target.garmentId) ?? null
    const reparse = (raw: string) =>
      parseLegacyStylePieceRecipesForImport(raw, owner, target.garmentId, anchor)
    const stillPending = await importParsedMobileStorageKey({
      handle: target.handle,
      originalRaw: target.raw,
      owner,
      parsed: reparse(target.raw),
      reparse,
      pinnedToken,
      deadlineMs,
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
  isCurrent: () => boolean
}) {
  const { owner, sources, knownGarmentIds, garments, isCurrent } = params
  const includeHomeSample = !sources || sources.includes('home_sample')
  const includeStylePiece = !sources || sources.includes('style_piece')
  const budget = createMobileDiscoveryBudget()

  const homeSampleTargets = includeHomeSample
    ? await discoverMobileHomeSampleStorageForOwner(owner, isCurrent, budget)
    : []

  if (!isCurrent()) {
    return { homeSampleTargets: [], stylePieceTargets: [], deferredCount: 0 }
  }

  const initialKnownIds = [
    ...(knownGarmentIds ?? []),
    ...(garments?.map((item) => item.id) ?? []),
  ]
  const stylePieceTargets = includeStylePiece
    ? await discoverMobileStylePieceStorageForOwner(
        owner,
        initialKnownIds,
        isCurrent,
        budget
      )
    : []

  return {
    homeSampleTargets,
    stylePieceTargets,
    deferredCount: budget.deferredCount,
  }
}

async function importMobileHomeSampleTargets(params: {
  targets: Awaited<ReturnType<typeof discoverMobileHomeSampleStorageForOwner>>
  owner: string
  pinnedToken: string
  deadlineMs: number
  signal?: AbortSignal
  isCurrent: () => boolean
  imported: SavedLookContract[]
}): Promise<number> {
  const { targets, owner, pinnedToken, deadlineMs, signal, isCurrent, imported } = params
  let pendingKeys = 0
  for (const target of targets) {
    if (!isCurrent() || Date.now() > deadlineMs) {
      pendingKeys += 1
      continue
    }
    const reparse = (raw: string) => parseLegacyHomeSampleBookmarksForImport(raw, owner)
    const stillPending = await importParsedMobileStorageKey({
      handle: target.handle,
      originalRaw: target.raw,
      owner,
      parsed: reparse(target.raw),
      reparse,
      pinnedToken,
      deadlineMs,
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

  const deadlineMs = Date.now() + MAX_LEGACY_IMPORT_DURATION_MS
  const { homeSampleTargets, stylePieceTargets, deferredCount } =
    await collectMobileLegacyTargets({
      owner,
      sources: options.sources,
      knownGarmentIds: options.knownGarmentIds,
      garments: options.garments,
      isCurrent,
    })

  if (
    !isCurrent() ||
    (homeSampleTargets.length === 0 && stylePieceTargets.length === 0)
  ) {
    return {
      imported: [],
      pendingKeys: homeSampleTargets.length + stylePieceTargets.length + deferredCount,
    }
  }

  const pinnedToken = await requireAccessToken(options.accessToken)
  if (!isCurrent()) {
    return {
      imported: [],
      pendingKeys: homeSampleTargets.length + stylePieceTargets.length + deferredCount,
    }
  }

  const imported: SavedLookContract[] = []
  let pendingKeys =
    deferredCount +
    (await importMobileHomeSampleTargets({
      targets: homeSampleTargets,
      owner,
      pinnedToken,
      deadlineMs,
      signal: options.signal,
      isCurrent,
      imported,
    }))

  if (stylePieceTargets.length > 0) {
    pendingKeys += await importMobileStylePieceTargets({
      targets: stylePieceTargets,
      owner,
      pinnedToken,
      deadlineMs,
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

/**
 * Starts at most one session-scoped legacy migration per `(owner, epoch)`.
 * Decoupled from transient view abort signals so replacing Home content never
 * interrupts a migration already in flight.
 */
export function ensureMobileLegacySavedLooksMigration(options: {
  owner?: string | null
  epoch?: number
  accessToken?: string
  garments?: readonly GarmentItemContract[]
  knownGarmentIds?: readonly string[]
}): Promise<MobileLegacySavedLooksImportResult> | null {
  const owner = (options.owner ?? mobileApplicationUserId())?.trim() ?? ''
  if (!owner) return null
  const epoch = options.epoch ?? mobileIdentityEpoch()
  const sessionKey = `${owner}:${epoch}`
  const existing = inFlightMobileImportBySession.get(sessionKey)
  if (existing) return existing

  const run = importLegacyDeviceSavedLooksFromMobile({
    owner,
    epoch,
    accessToken: options.accessToken,
    garments: options.garments,
    knownGarmentIds: options.knownGarmentIds,
    notify: true,
  })
    .catch(() => ({ imported: [], pendingKeys: 0 }))
    .finally(() => {
      if (inFlightMobileImportBySession.get(sessionKey) === run) {
        inFlightMobileImportBySession.delete(sessionKey)
      }
    })

  inFlightMobileImportBySession.set(sessionKey, run)
  return run
}

export async function listSavedLooksPageFromMobile(
  options: {
    owner?: string | null
    epoch?: number
    accessToken?: string
    garments?: readonly GarmentItemContract[]
    knownGarmentIds?: readonly string[]
    source?: ListSavedLooksQuery['source']
    includeToday?: boolean
    anchorGarmentId?: string
    /** Story CC-7.12 D3: `created_desc` for the Looks tab's newest-first feed. */
    sort?: SavedLookListSort
    limit?: number
    offset?: number
    signal?: AbortSignal
    skipLegacyImport?: boolean
  } = {}
): Promise<MobileSavedLookPageResult> {
  try {
    const token = await requireAccessToken(options.accessToken)
    const activeOwner = options.owner ?? mobileApplicationUserId()
    if (!options.skipLegacyImport && activeOwner && (options.offset ?? 0) === 0) {
      void ensureMobileLegacySavedLooksMigration({
        owner: activeOwner,
        epoch: options.epoch,
        accessToken: token,
        garments: options.garments,
        knownGarmentIds: options.knownGarmentIds,
      })
    }

    const client = createMobileApiClient({ accessToken: token })
    const response = await withRequestDeadline(
      SAVED_LOOK_REQUEST_TIMEOUT_MS,
      options.signal ? [options.signal] : [],
      (requestSignal) =>
        client.apiV1WardrobeSavedLooksGet(
          {
            source: options.source,
            includeToday: options.includeToday ? 'true' : undefined,
            anchorGarmentId: options.anchorGarmentId,
            sort: options.sort,
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
    source?: ListSavedLooksQuery['source']
    anchorGarmentId?: string
    limit?: number
    offset?: number
    signal?: AbortSignal
    skipLegacyImport?: boolean
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
    const token = await requireAccessToken(options.accessToken)
    const client = createMobileApiClient({ accessToken: token })
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
  options?: AbortSignal | { accessToken?: string; signal?: AbortSignal }
): Promise<SavedLookContract> {
  const resolved =
    options && typeof options === 'object' && 'aborted' in options
      ? { signal: options }
      : (options ?? {})
  try {
    const token = await requireAccessToken(resolved.accessToken)
    const client = createMobileApiClient({ accessToken: token })
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
    throw await normalizeMobileSavedLookError(error, 'Unable to open this saved look.')
  }
}

export async function restoreSavedLookFromMobile(
  savedLookId: string,
  options: { accessToken?: string; signal?: AbortSignal } = {}
): Promise<SavedLookContract> {
  try {
    const token = await requireAccessToken(options.accessToken)
    const client = createMobileApiClient({ accessToken: token })
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
  options?: AbortSignal | { accessToken?: string; signal?: AbortSignal }
): Promise<void> {
  const resolved =
    options && typeof options === 'object' && 'aborted' in options
      ? { signal: options }
      : (options ?? {})
  try {
    const token = await requireAccessToken(resolved.accessToken)
    const client = createMobileApiClient({ accessToken: token })
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
    throw await normalizeMobileSavedLookError(error, 'Unable to remove this saved look.')
  }
}
