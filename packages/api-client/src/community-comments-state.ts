// Story 6.4 owner: screen-owned drafts, immutable retries, page merge and visibility fences.
import {
  createCommunityCommentInputSchema,
  COMMUNITY_COMMENT_PAGE_SIZE,
  type CommunityComment,
  type CommunityCommentSubmission,
  type CommunityCommentsPage,
  type CommunityReportReason,
  type CreateCommunityCommentInput,
} from './contracts/http/community'
import type { SupportedLocale } from './contracts/http/localization'

export interface CommunityCommentsTransport {
  roots(postId: string, cursor?: string): Promise<CommunityCommentsPage>
  replies(
    postId: string,
    parentId: string,
    cursor?: string
  ): Promise<CommunityCommentsPage>
  submissions(
    postId: string,
    cursor?: string
  ): Promise<{ items: CommunityCommentSubmission[]; nextCursor: string | null }>
  create(
    postId: string,
    input: CreateCommunityCommentInput
  ): Promise<CommunityCommentSubmission>
  delete(postId: string, commentId: string): Promise<CommunityCommentSubmission>
  report(
    postId: string,
    commentId: string,
    reason: CommunityReportReason
  ): Promise<unknown>
}
export interface CommentDraft {
  body: string
  parentId: string | null
}
export interface CommentThreadState {
  roots: CommunityCommentsPage | null
  replies: Map<string, CommunityCommentsPage>
  submissions: CommunityCommentSubmission[]
  submissionsCursor: string | null
  draft: CommentDraft
  unresolved: CreateCommunityCommentInput | null
  pending: boolean
  loading: boolean
  error: string | null
  announcement: { key: string; id: number } | null
}
function empty(): CommentThreadState {
  return {
    roots: null,
    replies: new Map(),
    submissions: [],
    submissionsCursor: null,
    draft: { body: '', parentId: null },
    unresolved: null,
    pending: false,
    loading: false,
    error: null,
    announcement: null,
  }
}
function mergePage(
  previous: CommunityCommentsPage | null | undefined,
  page: CommunityCommentsPage,
  append: boolean
) {
  if (!append || !previous || previous.snapshot !== page.snapshot) return page
  const map = new Map(previous.items.map((item) => [item.id, item]))
  page.items.forEach((item) => map.set(item.id, item))
  return {
    ...page,
    items: [...map.values()].sort(
      (a, b) => a.publicationSequence - b.publicationSequence
    ),
  }
}

export class CommunityCommentsState {
  private readonly threads = new Map<string, CommentThreadState>()
  private readonly fences = new Map<string, number>()
  private readonly requests = new Map<string, number>()
  private readonly statusPages = new Map<string, number>()
  private readonly statusesPending = new Map<string, Promise<void>>()
  private readonly listeners = new Set<() => void>()
  private version = 0
  private generation = 0
  private readonly consumedAnnouncements = new Map<string, number>()
  private announcementId = 0
  private session: string | null = null
  constructor(
    private readonly transport: CommunityCommentsTransport,
    private readonly newId: () => string,
    private readonly failureReason: (error: unknown) => string,
    private readonly onUnavailable?: (postId: string) => void
  ) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  getVersion = () => this.version
  private emit() {
    this.version++
    this.listeners.forEach((fn) => fn())
  }
  current(postId: string): CommentThreadState {
    let state = this.threads.get(postId)
    if (!state) {
      state = empty()
      this.threads.set(postId, state)
    }
    return state
  }
  setSession(identity: string | null): void {
    if (this.session === identity) return
    this.session = identity
    this.reset()
  }
  reset(): void {
    this.generation++
    this.threads.clear()
    this.fences.clear()
    this.requests.clear()
    this.statusPages.clear()
    this.statusesPending.clear()
    this.consumedAnnouncements.clear()
    this.emit()
  }
  evict(postId: string): void {
    this.fences.set(postId, (this.fences.get(postId) ?? 0) + 1)
    this.threads.delete(postId)
    this.onUnavailable?.(postId)
    this.statusPages.delete(postId)
    this.statusesPending.delete(postId)
    this.emit()
  }
  private ticket(postId: string) {
    const generation = this.generation,
      fence = this.fences.get(postId) ?? 0
    return () =>
      this.generation === generation && (this.fences.get(postId) ?? 0) === fence
  }
  draft(postId: string, draft: Partial<CommentDraft>): void {
    Object.assign(this.current(postId).draft, draft)
    this.emit()
  }
  private announce(state: CommentThreadState, key: string) {
    state.announcement = { key, id: ++this.announcementId }
  }
  private failed(postId: string, state: CommentThreadState, error: unknown): void {
    const reason = this.failureReason(error)
    if (reason === 'not_found') {
      this.evict(postId)
      return
    }
    if (reason === 'signed_out') {
      this.reset()
      return
    }
    const key =
      reason === 'disabled'
        ? 'community.error.disabled'
        : reason === 'rate_limited'
          ? 'community.comments.rateLimited'
          : reason === 'age_gate'
            ? 'community.error.ageGate'
            : 'community.comments.failed'
    if (state.error !== key) this.announce(state, key)
    state.error = key
  }

  consumeAnnouncement(postId: string): CommentThreadState['announcement'] {
    const announcement = this.current(postId).announcement
    if (!announcement || (this.consumedAnnouncements.get(postId) ?? 0) >= announcement.id)
      return null
    this.consumedAnnouncements.set(postId, announcement.id)
    return announcement
  }

  /** Poll only known screening work, serially; failures back off to thirty seconds. */
  watchSubmissions(postId: string): () => void {
    let valid = this.ticket(postId)
    let cycle = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false,
      busy = false,
      failures = 0
    const schedule = () => {
      if (!valid()) {
        if (timer) clearTimeout(timer)
        timer = undefined
        busy = false
        failures = 0
        valid = this.ticket(postId)
        cycle++
      }
      if (
        stopped ||
        !valid() ||
        busy ||
        timer ||
        !this.current(postId).submissions.some(
          (item) => item.status === 'pending_screening'
        )
      )
        return
      const owns = valid
      const scheduledCycle = cycle
      timer = setTimeout(
        () => {
          timer = undefined
          if (
            stopped ||
            !owns() ||
            scheduledCycle !== cycle ||
            !this.current(postId).submissions.some(
              (item) => item.status === 'pending_screening'
            )
          )
            return
          busy = true
          void this.statuses(postId).finally(() => {
            if (stopped || !owns() || scheduledCycle !== cycle) return
            busy = false
            failures = this.current(postId).error ? Math.min(failures + 1, 4) : 0
            schedule()
          })
        },
        Math.min(30_000, 3000 * 2 ** failures)
      )
    }
    const unsubscribe = this.subscribe(schedule)
    schedule()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }

  private invalidateReads(postId: string, includePrivate = true): void {
    for (const key of this.requests.keys())
      if (key.startsWith(`${postId}/`) && (includePrivate || key !== `${postId}/private`))
        this.requests.set(key, (this.requests.get(key) ?? 0) + 1)
    if (includePrivate) this.statusesPending.delete(postId)
    this.current(postId).loading = false
  }

  private suppress(state: CommentThreadState, id: string): void {
    const tombstone = (item: CommunityComment) =>
      item.id === id ? { ...item, body: null, author: null, unavailable: true } : item
    if (state.roots)
      state.roots = { ...state.roots, items: state.roots.items.map(tombstone) }
    state.replies.forEach((page, key) =>
      state.replies.set(key, { ...page, items: page.items.map(tombstone) })
    )
  }

  private publicIds(state: CommentThreadState): Set<string> {
    return new Set(
      [
        ...(state.roots?.items ?? []),
        ...[...state.replies.values()].flatMap((page) => page.items),
      ].map((item) => item.id)
    )
  }

  private clearReplies(postId: string, state: CommentThreadState): void {
    const rootKey = `${postId}/`
    const privateKey = `${postId}/private`
    for (const key of this.requests.keys()) {
      // Include first expansions that have no accepted reply page yet.
      if (key.startsWith(rootKey) && key !== rootKey && key !== privateKey)
        this.requests.set(key, (this.requests.get(key) ?? 0) + 1)
    }
    state.replies.clear()
  }

  private readPage(
    postId: string,
    parentId: string | null,
    page: CommunityCommentsPage | null | undefined,
    append: boolean
  ) {
    const cursor = append ? (page?.nextCursor ?? undefined) : undefined
    return parentId
      ? this.transport.replies(postId, parentId, cursor)
      : this.transport.roots(postId, cursor)
  }

  private reconcileSubmissions(
    state: CommentThreadState,
    items: CommunityCommentSubmission[],
    append: boolean
  ): void {
    const publicIds = this.publicIds(state)
    const map = new Map((append ? state.submissions : []).map((item) => [item.id, item]))
    items.forEach((item) => {
      if (!publicIds.has(item.id)) map.set(item.id, item)
    })
    state.submissions = [...map.values()]
  }

  private ownRequest(postId: string, key: string): () => boolean {
    const valid = this.ticket(postId)
    const request = (this.requests.get(key) ?? 0) + 1
    this.requests.set(key, request)
    return () => valid() && this.requests.get(key) === request
  }

  private privatePageCount(postId: string): number {
    return this.statusPages.get(postId) ?? 1
  }

  async load(
    postId: string,
    parentId: string | null = null,
    append = false
  ): Promise<void> {
    const state = this.current(postId)
    const key = `${postId}/${parentId ?? ''}`
    const current = parentId ? state.replies.get(parentId) : state.roots
    if (append && !current?.nextCursor) return
    const isCurrent = this.ownRequest(postId, key)
    if (!parentId && !append) {
      this.clearReplies(postId, state)
    }
    state.loading = true
    state.error = null
    this.emit()
    try {
      const page = await this.readPage(postId, parentId, current, append)
      if (!isCurrent()) return
      const merged = mergePage(current, page, append)
      if (parentId) state.replies.set(parentId, merged)
      else state.roots = merged
      // Public pages own each published ID. Owner status remains private until refreshed.
      const published = this.publicIds(state)
      state.submissions = state.submissions.filter((item) => !published.has(item.id))
    } catch (error) {
      if (isCurrent()) this.failed(postId, state, error)
    } finally {
      if (isCurrent()) {
        state.loading = false
        this.emit()
      }
    }
  }

  statuses(postId: string, append = false): Promise<void> {
    const pending = this.statusesPending.get(postId)
    if (pending) return append ? pending.then(() => this.statuses(postId, true)) : pending
    const operation = this.readStatuses(postId, append)
    this.statusesPending.set(postId, operation)
    return operation.finally(() => {
      if (this.statusesPending.get(postId) === operation)
        this.statusesPending.delete(postId)
    })
  }

  private async readStatuses(postId: string, append: boolean): Promise<void> {
    const state = this.current(postId)
    if (append && !state.submissionsCursor) return
    const isCurrent = this.ownRequest(postId, `${postId}/private`)
    const targetPages = append
      ? 1
      : Math.max(
          this.privatePageCount(postId),
          Math.ceil(state.submissions.length / COMMUNITY_COMMENT_PAGE_SIZE)
        )
    const collected: CommunityCommentSubmission[] = []
    let cursor = append ? (state.submissionsCursor ?? undefined) : undefined
    let pages = 0
    try {
      do {
        const page = await this.transport.submissions(postId, cursor)
        if (!isCurrent()) return
        collected.push(...page.items)
        cursor = page.nextCursor ?? undefined
        pages++
      } while (cursor && pages < targetPages)
      this.acceptStatuses(postId, state, collected, append, cursor, pages)
    } catch (error) {
      if (isCurrent()) {
        this.failed(postId, state, error)
        this.emit()
      }
    }
  }

  private acceptStatuses(
    postId: string,
    state: CommentThreadState,
    collected: CommunityCommentSubmission[],
    append: boolean,
    cursor: string | undefined,
    pages: number
  ): void {
    const previous = new Map(state.submissions.map((item) => [item.id, item.status]))
    for (const item of collected) {
      if (['author_deleted', 'consent_suspended', 'erased'].includes(item.status)) {
        this.invalidateReads(postId, false)
        this.suppress(state, item.id)
      }
      if (
        previous.get(item.id) === 'pending_screening' &&
        item.status !== 'pending_screening'
      )
        this.announce(state, `community.comments.status.${item.status}`)
    }
    this.reconcileSubmissions(state, collected, append)
    state.error = null
    state.submissionsCursor = cursor ?? null
    this.statusPages.set(postId, append ? this.privatePageCount(postId) + pages : pages)
    this.emit()
  }

  private isDefinitiveRejection(error: unknown): boolean {
    const status =
      error && typeof error === 'object' && 'httpStatus' in error
        ? error.httpStatus
        : undefined
    return (
      [400, 403, 409, 429].includes(status as number) ||
      ['age_gate', 'disabled', 'rate_limited', 'reason_changed', 'self_report'].includes(
        this.failureReason(error)
      )
    )
  }

  async submit(postId: string, locale: SupportedLocale): Promise<void> {
    const state = this.current(postId)
    if (state.pending) return
    // A transport-uncertain submission retains the exact UUID and payload until reconciled.
    let input = state.unresolved
    if (!input) {
      const parsed = createCommunityCommentInputSchema.safeParse({
        ...state.draft,
        mutationId: this.newId(),
        locale,
      })
      if (!parsed.success) {
        state.error = 'community.comments.invalid'
        this.emit()
        return
      }
      input = parsed.data
      state.unresolved = input
    }
    const valid = this.ticket(postId)
    state.pending = true
    state.error = null
    this.emit()
    try {
      const result = await this.transport.create(postId, input)
      if (!valid()) return
      const privateKey = `${postId}/private`
      this.requests.set(privateKey, (this.requests.get(privateKey) ?? 0) + 1)
      this.statusesPending.delete(postId)
      this.reconcileSubmissions(
        state,
        [result, ...state.submissions.filter((item) => item.id !== result.id)],
        false
      )
      state.unresolved = null
      if (
        state.draft.body.normalize('NFC').trim() === input.body &&
        state.draft.parentId === input.parentId
      )
        state.draft = { body: '', parentId: null }
      this.announce(state, 'community.comments.submitted')
    } catch (error) {
      if (valid()) {
        if (this.isDefinitiveRejection(error)) state.unresolved = null
        this.failed(postId, state, error)
      }
    } finally {
      if (valid()) {
        state.pending = false
        this.emit()
      }
    }
  }

  async delete(postId: string, commentId: string): Promise<void> {
    const state = this.current(postId),
      valid = this.ticket(postId)
    try {
      const deleted = await this.transport.delete(postId, commentId)
      if (!valid()) return
      this.invalidateReads(postId)
      this.suppress(state, commentId)
      state.error = null
      state.submissions = state.submissions.map((item) =>
        item.id === commentId ? deleted : item
      )
      this.announce(state, 'community.comments.deleted')
      this.emit()
    } catch (error) {
      if (valid()) {
        this.failed(postId, state, error)
        this.emit()
      }
    }
  }

  async report(
    postId: string,
    commentId: string,
    reason: CommunityReportReason
  ): Promise<boolean> {
    const state = this.current(postId),
      valid = this.ticket(postId)
    try {
      await this.transport.report(postId, commentId, reason)
      if (valid()) {
        state.error = null
        this.announce(state, 'community.comments.reported')
        this.emit()
        return true
      }
    } catch (error) {
      if (valid()) {
        this.failed(postId, state, error)
        this.emit()
      }
    }
    return false
  }
}

/** A local cache scope only. Authentication remains owned by each platform. */
export function commentSessionIdentity(token: string | null | undefined): string | null {
  if (!token) return null
  try {
    const encoded = token.split('.')[1]
    if (!encoded) return token
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const claims: unknown = JSON.parse(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
    )
    if (
      claims &&
      typeof claims === 'object' &&
      'sub' in claims &&
      typeof claims.sub === 'string'
    )
      return claims.sub
  } catch {
    /* Synthetic opaque tokens still receive an isolated cache scope. */
  }
  return token
}
