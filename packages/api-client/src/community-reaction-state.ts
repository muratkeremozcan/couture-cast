import type {
  CommunityReactionFeedItem,
  CommunityReactionSelection,
  CommunityReactionSummary,
  SetCommunityReactionInput,
} from './contracts/http/community'

export interface ReactionControlState {
  pending: boolean
  errorKey: string | null
  canRetry: boolean
}

export interface ReactionControls extends ReactionControlState {
  onSubmit: (selection?: CommunityReactionSelection) => void
}

interface Intent extends ReactionControlState {
  request: SetCommunityReactionInput | null
}

interface ReactionStateOptions {
  mutate: (
    postId: string,
    request: SetCommunityReactionInput
  ) => Promise<{
    summary: CommunityReactionSummary
    conflict: boolean
  }>
  newId: () => string
  failureReason: (error: unknown) => string
  onChange: (postId: string, summary: CommunityReactionSummary | null | undefined) => void
  onAnnounce: (key: string, success: boolean) => void
}

const IDLE: ReactionControlState = { pending: false, errorKey: null, canRetry: false }

function reactionFailureKey(reason: string): string {
  const keys: Record<string, string> = {
    age_gate: 'community.reactions.ineligible',
    disabled: 'community.error.disabled',
    signed_out: 'community.error.signedOut',
    rate_limited: 'community.reactions.rateLimited',
  }
  return keys[reason] ?? 'community.reactions.failed'
}

/** Screen-owned state survives card virtualization and modal closure. */
export class CommunityReactionState {
  private readonly summaries = new Map<string, CommunityReactionSummary | undefined>()
  private readonly intents = new Map<string, Intent>()
  private readonly evictions = new Map<string, number>()
  private clock = 0
  private version = 0
  private readonly listeners = new Set<() => void>()

  constructor(private readonly options: ReactionStateOptions) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = (): number => this.version

  private emit(): void {
    this.version += 1
    this.listeners.forEach((listener) => listener())
  }

  beginRead(): number {
    this.clock += 1
    return this.clock
  }

  private fenceReads(postId: string): void {
    this.clock += 1
    this.evictions.set(postId, this.clock)
  }

  private isFenced(postId: string, ticket: number): boolean {
    return ticket <= (this.evictions.get(postId) ?? -1)
  }

  evict(postId: string): void {
    this.fenceReads(postId)
    this.summaries.delete(postId)
    this.options.onChange(postId, null)
  }

  /** Every reader shares the latest confirmed summary and its visibility fence. */
  read(
    item: CommunityReactionFeedItem,
    ticket: number
  ): CommunityReactionFeedItem | null {
    if (this.isFenced(item.id, ticket)) return null
    if (!item.reactions) {
      // An omitted capability field cannot inherit an older public aggregate.
      this.fenceReads(item.id)
      this.summaries.set(item.id, undefined)
      this.options.onChange(item.id, undefined)
      return item
    }
    const confirmed = this.confirm(item.id, item.reactions)
    this.options.onChange(item.id, confirmed)
    return this.current(item)
  }

  current(item: CommunityReactionFeedItem): CommunityReactionFeedItem {
    if (!item.reactions) return item
    return this.summaries.has(item.id)
      ? { ...item, reactions: this.summaries.get(item.id) }
      : item
  }

  private confirm(
    postId: string,
    summary: CommunityReactionSummary
  ): CommunityReactionSummary {
    const previous = this.summaries.get(postId)
    if (
      previous &&
      (previous.revision > summary.revision || previous.generation > summary.generation)
    )
      return previous
    this.summaries.set(postId, summary)
    return summary
  }

  controls(postId: string): ReactionControls {
    return {
      ...(this.intents.get(postId) ?? IDLE),
      onSubmit: (selection) => {
        void this.submit(postId, selection)
      },
    }
  }

  private async submit(
    postId: string,
    selection?: CommunityReactionSelection
  ): Promise<void> {
    const existing = this.intents.get(postId)
    const summary = this.summaries.get(postId)
    if (existing?.pending || !summary || (selection && existing?.request)) return
    const request = selection
      ? {
          selection: summary.viewerReaction === selection ? null : selection,
          mutationId: this.options.newId(),
          baseRevision: summary.revision,
        }
      : existing?.request
    if (!request) return
    const mutationTicket = this.beginRead()
    const intent: Intent = { request, pending: true, errorKey: null, canRetry: false }
    this.intents.set(postId, intent)
    this.emit()
    try {
      const result = await this.options.mutate(postId, request)
      intent.request = null
      if (this.isFenced(postId, mutationTicket)) return
      const confirmed = this.confirm(postId, result.summary)
      this.options.onChange(postId, confirmed)
      intent.request = null
      intent.errorKey = result.conflict ? 'community.reactions.conflict' : null
      this.options.onAnnounce(
        result.conflict ? 'community.reactions.conflict' : 'community.reactions.updated',
        !result.conflict
      )
    } catch (error: unknown) {
      if (this.isFenced(postId, mutationTicket)) {
        intent.request = null
        return
      }
      const reason = this.options.failureReason(error)
      if (reason !== 'unknown') intent.request = null
      if (reason === 'not_found') {
        this.evict(postId)
      } else {
        intent.errorKey = reactionFailureKey(reason)
        this.options.onAnnounce(intent.errorKey, false)
      }
    } finally {
      intent.pending = false
      intent.canRetry = intent.request !== null
      this.emit()
    }
  }
}
