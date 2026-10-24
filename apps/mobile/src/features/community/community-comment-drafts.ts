// Story 6.5 (R46): content that hides as unverified (D3) unmounts the comments sheet, and
// a reset or eviction meanwhile wipes the shared comment state. The member's own unsent
// comment stays here, in memory only, so the sheet can give it back when access returns.
import type { CreateCommunityCommentInput } from '@couture/api-client/contracts/http'

export type CommunityCommentDraft = {
  body: string
  parentId: string | null
  /** Whether the composer had focus when the sheet last unmounted. */
  focused: boolean
  /**
   * R47: the submission whose outcome the client never learned. Its mutation ID returns
   * with the draft, so a resend after access returns posts the comment at most once.
   */
  unresolved: CreateCommunityCommentInput | null
}

/** One member's unsent comments, keyed by member and post. Never persisted. */
export class CommunityCommentDrafts {
  private readonly members = new Map<string, Map<string, CommunityCommentDraft>>()

  /** Records an edit to the member's draft for this post, creating it when needed. */
  remember(member: string, postId: string, draft: Partial<CommunityCommentDraft>): void {
    let posts = this.members.get(member)
    if (!posts) {
      posts = new Map()
      this.members.set(member, posts)
    }
    const previous = posts.get(postId) ?? {
      body: '',
      parentId: null,
      focused: false,
      unresolved: null,
    }
    posts.set(postId, { ...previous, ...draft })
  }

  /** Records whether the composer had focus, for a draft that is already held. */
  retainFocus(member: string, postId: string, focused: boolean): void {
    const draft = this.members.get(member)?.get(postId)
    if (draft) draft.focused = focused
  }

  restore(member: string, postId: string): CommunityCommentDraft | null {
    const draft = this.members.get(member)?.get(postId)
    return draft ? { ...draft } : null
  }

  forget(member: string, postId: string): void {
    const posts = this.members.get(member)
    posts?.delete(postId)
    if (posts?.size === 0) this.members.delete(member)
  }

  /** A different member owns the screen now; nothing of the previous one stays. */
  forgetAll(): void {
    this.members.clear()
  }
}
