import {
  FLAT_LAY_CONFIRM_PATH,
  FLAT_LAY_REVIEW_LIFETIME_MS,
  FLAT_LAY_REVIEW_PATH,
  flatLayConfirmResponseSchema,
  flatLayReviewResponseSchema,
  isUploadInProgressCode,
  type FlatLayConfirmation,
  type FlatLayReview,
  type FlatLaySelection,
  type FlatLayTags,
  type UploadAttemptSession,
} from './contracts/http'
import { withRequestDeadline } from './request-deadline'

type CaptureError =
  | 'person'
  | 'uncertain'
  | 'unavailable'
  | 'expired'
  | 'saveFailed'
  | 'signedOut'
  | 'consentRequired'
type Piece = FlatLaySelection['items'][number]
type CaptureTicket = { session: UploadAttemptSession; abort: AbortController }

export type FlatLayCaptureState = {
  phase: 'source' | 'scanning' | 'review' | 'saving' | 'retry'
  pieces: readonly Piece[]
  error?: CaptureError
}

type Platform = {
  isCurrent: (session: UploadAttemptSession) => boolean
  review: (ticket: CaptureTicket, body: FormData) => Promise<FlatLayReview>
  confirm: (
    ticket: CaptureTicket,
    selection: FlatLaySelection
  ) => Promise<{
    confirmation: FlatLayConfirmation
    token: string
  }>
  onCommitted: (garment: FlatLayConfirmation['garments'][number], token: string) => void
  onComplete: () => void
}

class FlatLayRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null = null
  ) {
    super(`Flat-lay request failed (${status})`)
  }
}

function captureError(error: unknown, fallback: CaptureError): CaptureError {
  if (!(error instanceof FlatLayRequestError)) return fallback
  if (error.code === 'FLAT_LAY_PERSON') return 'person'
  if (error.code === 'FLAT_LAY_UNCERTAIN' || error.status === 413) return 'uncertain'
  if (error.code === 'FLAT_LAY_INVALID') return 'expired'
  if (error.code === 'GUARDIAN_CONSENT_REQUIRED') return 'consentRequired'
  if (error.status === 401) return 'signedOut'
  return fallback
}

function ambiguousSave(error: unknown) {
  return (
    !(error instanceof FlatLayRequestError) ||
    error.status >= 500 ||
    error.status === 408 ||
    error.status === 429 ||
    isUploadInProgressCode(error.code)
  )
}

export function createFlatLayClient(
  baseUrl: () => string,
  bearer: (session: UploadAttemptSession) => string | null | Promise<string | null>
) {
  const request = async (
    ticket: CaptureTicket,
    path: string,
    body: FormData | string
  ) => {
    const token = await bearer(ticket.session)
    if (!token) throw new FlatLayRequestError(401)
    return withRequestDeadline(28_000, [ticket.abort.signal], async (signal) => {
      if (signal.aborted) throw new Error('Flat-lay request cancelled')
      const response = await fetch(`${baseUrl()}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(typeof body === 'string' && { 'Content-Type': 'application/json' }),
        },
        body,
        signal,
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const value = payload as { code?: unknown; message?: unknown } | null
        const code = value?.code ?? value?.message
        throw new FlatLayRequestError(
          response.status,
          typeof code === 'string' ? code : null
        )
      }
      return { token, payload }
    })
  }
  return {
    async review(ticket: CaptureTicket, body: FormData) {
      return flatLayReviewResponseSchema.parse(
        (await request(ticket, FLAT_LAY_REVIEW_PATH, body)).payload
      )
    },
    async confirm(ticket: CaptureTicket, selection: FlatLaySelection) {
      const { payload, token } = await request(
        ticket,
        FLAT_LAY_CONFIRM_PATH,
        JSON.stringify(selection)
      )
      return { confirmation: flatLayConfirmResponseSchema.parse(payload), token }
    },
  }
}

/** Owns the current picker, previews, deadline and immutable retry payload. */
export class FlatLayCapture {
  private ticket: CaptureTicket | null = null
  private deadline: ReturnType<typeof setTimeout> | undefined
  private expiresAt = 0
  private selection: FlatLaySelection | null = null
  state: FlatLayCaptureState = { phase: 'source', pieces: [] }

  constructor(
    private readonly platform: Platform,
    private readonly notify: (state: FlatLayCaptureState) => void
  ) {}

  private publish(state: FlatLayCaptureState, notify = true) {
    this.state = state
    if (notify) this.notify(state)
  }

  reset(notify = true, error?: CaptureError) {
    this.ticket?.abort.abort()
    this.ticket = null
    clearTimeout(this.deadline)
    this.deadline = undefined
    this.selection = null
    this.expiresAt = 0
    this.publish({ phase: 'source', pieces: [], error }, notify)
  }

  open(session: UploadAttemptSession) {
    this.reset()
    const ticket = { session, abort: new AbortController() }
    this.ticket = ticket
    return ticket
  }

  isActive(ticket: CaptureTicket) {
    return this.ticket === ticket && this.platform.isCurrent(ticket.session)
  }

  cancelPick(ticket: CaptureTicket, error?: CaptureError) {
    if (this.isActive(ticket)) this.reset(true, error)
  }

  async review(ticket: CaptureTicket, body: FormData) {
    if (!this.isActive(ticket)) return
    this.publish({ phase: 'scanning', pieces: [] })
    try {
      const result = await this.platform.review(ticket, body)
      if (!this.isActive(ticket)) return
      this.expiresAt = Math.min(
        Date.parse(result.expiresAt),
        Date.now() + FLAT_LAY_REVIEW_LIFETIME_MS
      )
      if (this.expiresAt <= Date.now()) return this.reset(true, 'expired')
      this.deadline = setTimeout(
        () => this.reset(true, 'expired'),
        this.expiresAt - Date.now()
      )
      this.publish({
        phase: 'review',
        pieces: result.items.map(({ category, ...piece }) => ({
          ...piece,
          tags: { category },
        })),
      })
    } catch (error) {
      this.cancelPick(ticket, captureError(error, 'unavailable'))
    }
  }

  remove(id: string) {
    if (this.state.phase !== 'review') return
    if (Date.now() >= this.expiresAt) return this.reset(true, 'expired')
    this.publish({
      phase: 'review',
      pieces: this.state.pieces.filter((piece) => piece.id !== id),
    })
  }

  setTags(id: string, tags: FlatLayTags) {
    if (this.state.phase !== 'review') return
    if (Date.now() >= this.expiresAt) return this.reset(true, 'expired')
    this.publish({
      phase: 'review',
      pieces: this.state.pieces.map((piece) =>
        piece.id === id ? { ...piece, tags } : piece
      ),
    })
  }

  async save() {
    const { phase, pieces } = this.state
    const ticket = this.ticket
    if (
      !ticket ||
      !this.isActive(ticket) ||
      !pieces.length ||
      (phase !== 'review' && phase !== 'retry')
    )
      return
    if (Date.now() >= this.expiresAt) return this.reset(true, 'expired')
    this.selection ??= { items: [...pieces] }
    this.publish({ phase: 'saving', pieces })
    let result: Awaited<ReturnType<Platform['confirm']>>
    try {
      result = await this.platform.confirm(ticket, this.selection)
    } catch (error) {
      if (!this.isActive(ticket)) return
      if (Date.now() >= this.expiresAt) return this.reset(true, 'expired')
      if (ambiguousSave(error))
        this.publish({ phase: 'retry', pieces, error: 'saveFailed' })
      else this.reset(true, captureError(error, 'saveFailed'))
      return
    }
    if (!this.isActive(ticket)) return
    if (Date.now() >= this.expiresAt) return this.reset(true, 'expired')
    this.reset()
    for (const garment of result.confirmation.garments)
      this.platform.onCommitted(garment, result.token)
    this.platform.onComplete()
  }
}
