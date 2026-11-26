// Story CC-7.2 & CC-7.3: Web client for account-backed saved looks and same-member legacy device import.
'use client'

import { ResponseError, withRequestDeadline } from '@couture/api-client'
import {
  savedLookListResponseSchema,
  savedLookResponseSchema,
  type CreateSavedLookInput,
  type GarmentItemContract,
  type SavedLookContract,
  type SavedLookListSort,
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
const ERROR_BODY_PARSE_TIMEOUT_MS = 2_000
const MAX_LEGACY_KEYS_PER_RUN = 32
const MAX_LEGACY_BYTES_PER_RUN = 64 * 1024
const MAX_LEGACY_IMPORT_DURATION_MS = 15_000

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
const inFlightWebImportByOwner = new Map<
  string,
  Promise<LegacyDeviceSavedLooksImportResult>
>()

export function resetWebLegacySavedLooksImportState(): void {
  acknowledgedWebImportKeys.clear()
  inFlightWebImportByOwner.clear()
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

async function readErrorJsonWithTimeout(
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

async function normalizeSavedLookError(error: unknown, fallback: string): Promise<Error> {
  if (error instanceof SavedLookRequestError) return error
  if (error instanceof ResponseError) {
    const payload = await readErrorJsonWithTimeout(error.response)
    if (payload) {
      return new SavedLookRequestError(
        payload.message ??
          `Saved looks request failed with status ${error.response.status}`,
        error.response.status,
        payload.code ?? payload.message
      )
    }
    return new SavedLookRequestError(
      `Saved looks request failed with status ${error.response.status}`,
      error.response.status
    )
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
    const keys = Object.keys(window.localStorage)
    for (const key of keys) {
      if (!key.startsWith('couturecast.style-piece.')) continue
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
  if (!(error instanceof SavedLookRequestError)) return false
  const tag = error.code ?? error.message
  if (error.status === 400) return true
  if (error.status === 404 && tag === 'GARMENT_NOT_FOUND') return true
  if (error.status === 409 && tag === 'SAVED_LOOK_ALREADY_REMOVED') return true
  return false
}

function isPayloadMismatchConflict(error: unknown): boolean {
  if (!(error instanceof SavedLookRequestError) || error.status !== 409) return false
  const tag = error.code ?? error.message
  return tag === 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'
}

function normalizedSwapsEqual(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined
): boolean {
  const leftEntries = Object.entries(left ?? {}).filter(([, value]) => Boolean(value))
  const rightEntries = Object.entries(right ?? {}).filter(([, value]) => Boolean(value))
  if (leftEntries.length !== rightEntries.length) return false
  const rightMap = new Map(rightEntries)
  return leftEntries.every(([key, value]) => rightMap.get(key) === value)
}

function savedLookMatchesImportPayload(
  item: SavedLookContract,
  payload: CreateSavedLookInput
): boolean {
  if (
    item.source !== payload.source ||
    item.lookId !== payload.lookId ||
    item.weather !== payload.weather ||
    (item.anchorGarmentId ?? null) !== (payload.anchorGarmentId ?? null) ||
    !normalizedSwapsEqual(item.swaps, payload.swaps)
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

function runWithRemainingDeadline<T>(
  deadlineMs: number,
  signal: AbortSignal | undefined,
  work: (scopedSignal: AbortSignal) => Promise<T>
): Promise<T> {
  const remainingMs = deadlineMs - Date.now()
  if (remainingMs <= 0) {
    return Promise.reject(
      new DOMException('Legacy import deadline exceeded', 'AbortError')
    )
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

async function reconcileExistingAccountLookFromWeb(params: {
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
      const page = await runWithRemainingDeadline(deadlineMs, signal, (scopedSignal) =>
        listSavedLooksPageFromWeb({
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
      const match = page.data.find((item) => savedLookMatchesImportPayload(item, payload))
      if (match) return match
      offset += page.data.length
      if (page.data.length === 0 || offset >= page.total) return null
    }
    return null
  } catch {
    return null
  }
}

function webAckKey(owner: string, entry: LegacySavedLookImportEntry<unknown>): string {
  return `${owner}:${entry.idempotencyKey}:${JSON.stringify(entry.rawEntry)}`
}

function finalizeWebStorageKey<TRaw>(params: {
  key: string
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
  const { key, originalRaw, owner, parsed, reparse, isCurrent } = params
  if (!isCurrent()) return true

  const currentRaw = safeReadLocalStorage(key)
  if (currentRaw === null) return false

  const activeParsed = currentRaw === originalRaw ? parsed : reparse(currentRaw)
  const remaining = activeParsed.entries.filter(
    (entry) => !acknowledgedWebImportKeys.has(webAckKey(owner, entry))
  )

  if (remaining.length === 0) {
    if (isCurrent()) safeRemoveLocalStorage(key)
    return false
  }

  const changed =
    currentRaw !== originalRaw ||
    remaining.length < parsed.entries.length ||
    activeParsed.hadInvalidEntries
  if (changed && isCurrent()) {
    safeWriteLocalStorage(key, JSON.stringify(remaining.map((entry) => entry.rawEntry)))
  }
  return true
}

async function importSingleWebEntry<TRaw>(params: {
  entry: LegacySavedLookImportEntry<TRaw>
  owner: string
  pinnedToken: string
  deadlineMs: number
  signal?: AbortSignal
  isCurrent: () => boolean
  imported: SavedLookContract[]
}): Promise<void> {
  const { entry, owner, pinnedToken, deadlineMs, signal, isCurrent, imported } = params
  const ackKey = webAckKey(owner, entry)
  try {
    const created = await runWithRemainingDeadline(deadlineMs, signal, (scopedSignal) =>
      createSavedLookFromWeb(entry.payload, {
        accessToken: pinnedToken,
        idempotencyKey: entry.idempotencyKey,
        signal: scopedSignal,
      })
    )
    if (!isCurrent()) return
    acknowledgedWebImportKeys.add(ackKey)
    imported.push(created)
  } catch (error) {
    if (!isCurrent()) return
    if (isTerminalImportError(error)) {
      acknowledgedWebImportKeys.add(ackKey)
      return
    }
    if (isPayloadMismatchConflict(error)) {
      const existing = await reconcileExistingAccountLookFromWeb({
        payload: entry.payload,
        pinnedToken,
        deadlineMs,
        signal,
        isCurrent,
      })
      if (existing && isCurrent()) {
        acknowledgedWebImportKeys.add(ackKey)
        imported.push(existing)
      }
    }
  }
}

async function importParsedWebStorageKey<TRaw>(params: {
  key: string
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
    key,
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
    if (isCurrent() && safeReadLocalStorage(key) === originalRaw) {
      safeRemoveLocalStorage(key)
    }
    return false
  }

  for (const entry of [...parsed.entries].reverse()) {
    if (!isCurrent() || Date.now() > deadlineMs) break
    await importSingleWebEntry({
      entry,
      owner,
      pinnedToken,
      deadlineMs,
      signal,
      isCurrent,
      imported,
    })
  }

  return finalizeWebStorageKey({
    key,
    originalRaw,
    owner,
    parsed,
    reparse,
    isCurrent,
  })
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
  deferredCount: number
} {
  const includeHomeSample = !sources || sources.includes('home_sample')
  const includeStylePiece = !sources || sources.includes('style_piece')
  const homeSampleTargets: { key: string; raw: string }[] = []
  const stylePieceTargets: { key: string; garmentId: string; raw: string }[] = []
  let keysUsed = 0
  let bytesUsed = 0
  let deferredCount = 0

  const takeBudget = (rawLength: number): boolean => {
    if (
      keysUsed >= MAX_LEGACY_KEYS_PER_RUN ||
      (bytesUsed + rawLength > MAX_LEGACY_BYTES_PER_RUN && keysUsed > 0)
    ) {
      deferredCount += 1
      return false
    }
    keysUsed += 1
    bytesUsed += rawLength
    return true
  }

  if (includeHomeSample) {
    const keys = memberSampleBookmarksStorageKeys(owner).filter(
      (key) => parseMemberSampleBookmarksStorageKey(key) === owner
    )
    for (const key of keys) {
      const raw = safeReadLocalStorage(key)
      if (raw !== null && takeBudget(raw.length)) {
        homeSampleTargets.push({ key, raw })
      }
    }
  }

  if (includeStylePiece) {
    for (const candidate of discoverWebStylePieceKeysForOwner(owner)) {
      const raw = safeReadLocalStorage(candidate.key)
      if (raw !== null && takeBudget(raw.length)) {
        stylePieceTargets.push({ ...candidate, raw })
      }
    }
  }

  return { homeSampleTargets, stylePieceTargets, deferredCount }
}

async function importWebStylePieceTargets(params: {
  targets: { key: string; garmentId: string; raw: string }[]
  owner: string
  pinnedToken: string
  deadlineMs: number
  garments?: readonly GarmentItemContract[]
  loadGarments?: (signal?: AbortSignal) => Promise<readonly GarmentItemContract[] | null>
  signal?: AbortSignal
  isCurrent: () => boolean
  imported: SavedLookContract[]
}): Promise<number> {
  const { targets, owner, pinnedToken, deadlineMs, signal, isCurrent, imported } = params
  let garments: readonly GarmentItemContract[] | null | undefined = params.garments
  if (!garments && isCurrent()) {
    if (Date.now() >= deadlineMs) return targets.length
    garments = await runWithRemainingDeadline(deadlineMs, signal, (scopedSignal) =>
      params.loadGarments
        ? params.loadGarments(scopedSignal)
        : listGarmentsFromWeb(scopedSignal)
    ).catch(() => null)
  }

  if (!garments || !isCurrent()) {
    return targets.length
  }

  const anchorsById = buildReadyAnchorsById(garments)
  let pendingKeys = 0
  for (const target of targets) {
    if (!isCurrent() || Date.now() > deadlineMs) {
      pendingKeys += 1
      continue
    }
    const anchor = anchorsById.get(target.garmentId) ?? null
    const reparse = (raw: string) =>
      parseLegacyStylePieceRecipesForImport(raw, owner, target.garmentId, anchor)
    const stillPending = await importParsedWebStorageKey({
      key: target.key,
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

  const { homeSampleTargets, stylePieceTargets, deferredCount } = collectWebLegacyTargets(
    owner,
    options.sources
  )
  if (homeSampleTargets.length === 0 && stylePieceTargets.length === 0) {
    return { imported: [], pendingKeys: deferredCount }
  }

  const pinnedToken = resolveAccessToken(options.accessToken)
  const deadlineMs = Date.now() + MAX_LEGACY_IMPORT_DURATION_MS
  const imported: SavedLookContract[] = []
  let pendingKeys = deferredCount

  for (const target of homeSampleTargets) {
    if (!isCurrent() || Date.now() > deadlineMs) {
      pendingKeys += 1
      continue
    }
    const reparse = (raw: string) => parseLegacyHomeSampleBookmarksForImport(raw, owner)
    const stillPending = await importParsedWebStorageKey({
      key: target.key,
      originalRaw: target.raw,
      owner,
      parsed: reparse(target.raw),
      reparse,
      pinnedToken,
      deadlineMs,
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
      deadlineMs,
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

/**
 * Starts at most one session-scoped legacy migration per verified owner.
 * Decoupled from transient component abort signals (e.g. Home replacing sample view)
 * so switching content does not cancel an in-flight migration.
 */
export function ensureWebLegacySavedLooksMigration(options: {
  owner: string | null | undefined
  accessToken?: string
  garments?: readonly GarmentItemContract[]
}): Promise<LegacyDeviceSavedLooksImportResult> | null {
  const owner = options.owner?.trim() ?? ''
  if (!owner || owner === UNVERIFIED_BEARER_OWNER) return null
  const existing = inFlightWebImportByOwner.get(owner)
  if (existing) return existing

  const expectedBearer =
    options.accessToken?.trim() ||
    currentWebSessionBearer()?.trim() ||
    readStorage('session', WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim() ||
    null

  const run = importLegacyDeviceSavedLooksFromWeb({
    owner,
    accessToken: options.accessToken,
    garments: options.garments,
    notify: true,
    isCurrentOwner: () => {
      const live = currentWebSessionOwner()
      if (live === owner) return true
      if (live === UNVERIFIED_BEARER_OWNER && expectedBearer) {
        const liveBearer =
          currentWebSessionBearer()?.trim() ||
          readStorage('session', WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim() ||
          null
        return liveBearer === expectedBearer
      }
      return false
    },
  })
    .catch(() => ({ imported: [], pendingKeys: 0 }))
    .finally(() => {
      if (inFlightWebImportByOwner.get(owner) === run) {
        inFlightWebImportByOwner.delete(owner)
      }
    })

  inFlightWebImportByOwner.set(owner, run)
  return run
}

export async function listSavedLooksPageFromWeb(
  options: {
    owner?: string | null
    accessToken?: string
    garments?: readonly GarmentItemContract[]
    source?: SavedLookSource
    anchorGarmentId?: string
    /** Story CC-7.12 D3: `created_desc` for the Looks tab's newest-first feed. */
    sort?: SavedLookListSort
    limit?: number
    offset?: number
    signal?: AbortSignal
    skipLegacyImport?: boolean
  } = {}
): Promise<SavedLookPageResult> {
  try {
    const accessToken = resolveAccessToken(options.accessToken)
    const activeOwner = options.owner ?? currentWebSessionOwner()
    if (
      !options.skipLegacyImport &&
      activeOwner &&
      activeOwner !== UNVERIFIED_BEARER_OWNER &&
      (options.offset ?? 0) === 0
    ) {
      void ensureWebLegacySavedLooksMigration({
        owner: activeOwner,
        accessToken,
        garments: options.garments,
      })
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
            sort: options.sort,
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
    skipLegacyImport?: boolean
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
