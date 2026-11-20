// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import { useEffect } from 'react'
import {
  DirectUploadAttemptRegistry,
  isTerminalUploadStatus,
  uploadAttemptEnding,
  type UploadAttemptEnding,
  isUploadInProgressCode,
  UPLOAD_IN_PROGRESS_USER_MESSAGE,
  type DirectUploadAttempts,
  type DirectUploadSteps,
  type UploadAttemptSession,
} from '@couture/api-client/contracts/http'
import { ResponseError } from '@couture/api-client'

/** What the API answered to a failed allocate or commit: its status and error code. */
export type UploadFailure = { status: number; code: string | null }

/**
 * Each flow turns a failed request into its own error (with its own wording) before it reaches
 * the caller. The answer's status and code ride along here, keyed on that surfaced error, so the
 * attempt runner can still tell "bytes missing" and "this attempt is over" apart from a fault a
 * retry can fix.
 */
const failures = new WeakMap<object, UploadFailure>()

function errorCodeOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const payload = body as { error?: unknown; code?: unknown; message?: unknown }
  if (payload.error && typeof payload.error === 'object') {
    const nested = (payload.error as { code?: unknown }).code
    if (typeof nested === 'string') return nested
  }
  if (typeof payload.code === 'string') return payload.code
  return typeof payload.message === 'string' ? payload.message : null
}

/** The status and code of a failed API answer; null for a network fault, abort or parse error. */
export async function readUploadFailure(error: unknown): Promise<UploadFailure | null> {
  const response = error instanceof ResponseError ? error.response : null
  if (!response) return null
  let code: string | null = null
  try {
    // A clone, so the caller's own error conversion can still read the body.
    code = errorCodeOf(await response.clone().json())
  } catch {
    code = null
  }
  return { status: response.status, code }
}

/**
 * Converts a failed step into the flow's own error and throws it, remembering the API's status
 * and code on it first. A commit that met another commit of the same upload still publishing
 * reads as a plain "try again" to the member: the attempt stays open for that retry.
 */
export async function throwUploadStepError(
  raw: unknown,
  convert: (raw: unknown) => Promise<Error>
): Promise<never> {
  const failure = await readUploadFailure(raw)
  const surfaced = await convert(raw)
  if (failure) {
    failures.set(surfaced, failure)
    if (isUploadInProgressCode(failure.code))
      surfaced.message = UPLOAD_IN_PROGRESS_USER_MESSAGE
  }
  throw surfaced
}

function failureOf(error: unknown): UploadFailure | undefined {
  return typeof error === 'object' && error ? failures.get(error) : undefined
}

/** The API status and code a surfaced upload error carries, or null for a client-side fault. */
export function uploadFailureOf(error: unknown): UploadFailure | null {
  return failureOf(error) ?? null
}

function isBytesMissing(error: unknown): boolean {
  const failure = failureOf(error)
  return failure?.status === 409 && failure.code === 'UPLOAD_BYTES_MISSING'
}

/** True when the server ended the attempt, so no retry of it can succeed and it is forgotten. */
export function isTerminalUploadFailure(error: unknown): boolean {
  const failure = failureOf(error)
  return failure ? isTerminalUploadStatus(failure.status, failure.code) : false
}

/**
 * How the server ended the attempt for good (`session` or `rejected`), or null. The runner starts
 * one fresh attempt on that same Retry or pick; see `shouldRestartUploadAttempt`.
 */
export function uploadFailureEnding(error: unknown): UploadAttemptEnding | null {
  const failure = failureOf(error)
  return failure ? uploadAttemptEnding(failure.status, failure.code) : null
}

/**
 * Every web upload flow's open attempts, scoped to the signed-in account. `web-session.ts`
 * reports each account change, sign-out included, through {@link setUploadAttemptAccount}.
 */
const registry = new DirectUploadAttemptRegistry()

/** A store of open upload attempts, registered so an account change forgets them all. */
export function createUploadAttempts<TAllocation>(
  newKey: () => string
): DirectUploadAttempts<TAllocation> {
  return registry.createStore<TAllocation>(newKey)
}

/**
 * The signed-in account and session epoch, captured before a picker or camera opens. The photo
 * the picker returns, its preview and the confirmation the member gave for it belong to this
 * session: a flow drops them once {@link isUploadSessionCurrent} turns false, and hands the
 * session to its upload, which resolves the bearer for it ({@link resolveUploadBearer}) and
 * runs under it ({@link runTrackedUpload}).
 */
export function currentUploadSession(): UploadAttemptSession {
  return registry.session()
}

/** False once the account signed out or changed after `session` was captured. */
export function isUploadSessionCurrent(session: UploadAttemptSession): boolean {
  return registry.isCurrent(session)
}

/**
 * The bearer token for the account `session` captured. Refuses with
 * `UploadSessionChangedError` when the signed-in account is no longer that one, so a photo
 * picked under one account never uploads with another account's token.
 */
export function resolveUploadBearer<TBearer>(
  session: UploadAttemptSession,
  read: () => TBearer | Promise<TBearer>
): Promise<TBearer> {
  return registry.bearerFor(session, read)
}

/**
 * Calls `onChange` after every account change (sign-in, sign-out, an auth state change that
 * switches accounts). A picker flow clears its preview, its confirmation and anything else
 * bound to the old session there. Pass a stable callback (`useCallback`).
 */
export function useUploadSessionChange(onChange: () => void): void {
  useEffect(() => onUploadSessionChange(onChange), [onChange])
}

/** Calls `listener` after every account change; returns the unsubscribe. */
export function onUploadSessionChange(listener: () => void): () => void {
  return registry.subscribe(listener)
}

/** Reports the verified account (null when signed out); a change forgets every attempt. */
export function setUploadAttemptAccount(account: string | null): void {
  registry.setAccount(account)
}

/** Forgets every open attempt of every flow and fences uploads still under way. */
export function forgetAllUploadAttempts(): void {
  registry.forgetAll()
}

/**
 * Runs the attempt `id` names in `store` for the session the flow began under: a first run
 * allocates, uploads and commits; a retry of an attempt that already holds its allocation
 * commits first and re-uploads only when commit reports the bytes missing. The attempt is
 * forgotten on success and on a terminal failure; a network fault, timeout, abort, 5xx or
 * `UPLOAD_IN_PROGRESS` keeps it, with its keys, for the member's retry. A session change while
 * it runs fails it with `UploadSessionChangedError` and keeps nothing.
 */
export function runTrackedUpload<TAllocation, TResult>(
  store: DirectUploadAttempts<TAllocation>,
  session: UploadAttemptSession,
  id: string,
  steps: Omit<DirectUploadSteps<TAllocation, TResult>, 'isBytesMissing'>
): Promise<TResult> {
  return registry.run(store, session, id, steps, {
    isBytesMissing,
    isTerminal: isTerminalUploadFailure,
    ending: uploadFailureEnding,
  })
}

/** Identifies a retry of the same prepared image: same bytes, type, size and framing. */
export function preparedImageFingerprint(image: {
  sha256: string
  fileSizeBytes: number
  mimeType: string
  widthPx: number
  heightPx: number
}): string {
  return [
    image.sha256,
    image.fileSizeBytes,
    image.mimeType,
    image.widthPx,
    image.heightPx,
  ].join(':')
}
