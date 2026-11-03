// Story 6.10 web owner: the moderator console's transport and failure classification in `apps/web/src/lib/moderation.ts`.
// The console reads only the API. It decides nothing about roles: a 403 is a neutral state, never a guess.
'use client'

import { useTranslation } from 'react-i18next'
import { ResponseError } from '@couture/api-client'
import {
  moderationCaseDetailResponseSchema,
  moderationCasesResponseSchema,
  moderationQueueErrorCodeSchema,
  type ModerationCaseDetail,
  type ModerationCasesPage,
  type ModerationCasesQuery,
} from '@couture/api-client/contracts/http'
import { createWebApiClient } from './api-client'
import { getI18n } from '../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'

/** `useTranslation` bound to this app's instance, so the console renders before the locale bridge mounts. */
export function useModerationTranslation() {
  return useTranslation(undefined, { i18n: getI18n() })
}

/** The reason travels and the words do not: the console maps each reason onto a localized string. */
export type ModerationFailureReason =
  | 'signed_out'
  | 'forbidden'
  | 'disabled'
  | 'not_found'
  | 'invalid_cursor'
  | 'invalid_filter'
  | 'audit_unavailable'
  | 'unavailable'

export class ModerationRequestError extends Error {
  constructor(
    readonly reason: ModerationFailureReason,
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ModerationRequestError'
  }
}

export function moderationFailureReason(error: unknown): ModerationFailureReason {
  return error instanceof ModerationRequestError ? error.reason : 'unavailable'
}

/** Filters the console can set. `status` is always sent, the rest only when chosen. */
export type ModerationQueueFilters = Pick<
  ModerationCasesQuery,
  'source' | 'locale' | 'risk' | 'status' | 'sla'
>

export type ModerationQueueResult = ModerationCasesPage & {
  /** Server clock minus the browser clock, measured when the response arrived. */
  clockOffsetMs: number
}
export type ModerationCaseResult = ModerationCaseDetail & { clockOffsetMs: number }

function readAccessToken(): string {
  const token = window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim()
  if (!token) throw new ModerationRequestError('signed_out', 'Your session expired.')
  return token
}

async function readErrorCode(response: Response) {
  try {
    const body: unknown = await response.clone().json()
    const code = (body as { code?: unknown } | null)?.code
    const parsed = moderationQueueErrorCodeSchema.safeParse(code)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function moderationError(error: unknown): Promise<ModerationRequestError> {
  if (error instanceof ModerationRequestError) return error
  if (error instanceof ResponseError) {
    const { status } = error.response
    const code = await readErrorCode(error.response)
    const reason: ModerationFailureReason =
      status === 401
        ? 'signed_out'
        : status === 403
          ? 'forbidden'
          : status === 404
            ? 'not_found'
            : status === 400
              ? code === 'invalid_cursor'
                ? 'invalid_cursor'
                : 'invalid_filter'
              : status === 503 && code === 'moderation_console_disabled'
                ? 'disabled'
                : status === 503 && code === 'audit_unavailable'
                  ? 'audit_unavailable'
                  : 'unavailable'
    return new ModerationRequestError(
      reason,
      `Moderation request failed (${status}).`,
      status
    )
  }
  // A transport failure, an abort or a contract-parse failure. The reason stays generic.
  return new ModerationRequestError(
    'unavailable',
    error instanceof Error ? error.message : 'Moderation request failed.'
  )
}

export async function listModerationCasesFromWeb(params: {
  filters: ModerationQueueFilters
  cursor?: string | null
  limit?: number
  signal?: AbortSignal
}): Promise<ModerationQueueResult> {
  const accessToken = readAccessToken()
  try {
    const { filters } = params
    const response = await createWebApiClient({ accessToken }).listModerationCases(
      {
        source: filters.source,
        locale: filters.locale,
        risk: filters.risk,
        status: filters.status,
        sla: filters.sla,
        limit: params.limit,
        cursor: params.cursor ?? undefined,
      },
      { signal: params.signal }
    )
    const data = moderationCasesResponseSchema.parse(response).data
    return { ...data, clockOffsetMs: Date.parse(data.serverNow) - Date.now() }
  } catch (error: unknown) {
    throw await moderationError(error)
  }
}

/** One read per call. Every call writes one audit row on the server, so callers never poll it. */
export async function getModerationCaseFromWeb(
  caseId: string,
  signal?: AbortSignal
): Promise<ModerationCaseResult> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({ accessToken }).getModerationCase(
      { caseId },
      { signal }
    )
    const data = moderationCaseDetailResponseSchema.parse(response).data
    return { ...data, clockOffsetMs: Date.parse(data.serverNow) - Date.now() }
  } catch (error: unknown) {
    throw await moderationError(error)
  }
}

/** Milliseconds until `dueAt`, on the server's clock. Negative once breached. */
export function remainingMs(dueAt: string, clockOffsetMs: number, nowMs = Date.now()) {
  return Date.parse(dueAt) - (nowMs + clockOffsetMs)
}
