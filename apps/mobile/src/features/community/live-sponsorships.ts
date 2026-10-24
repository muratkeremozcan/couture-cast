// Story 6.7b owner: what the latest live, opted-in read said about each post's
// sponsorship block, for one Community screen and one member.
//
// Two kinds of copy reach the screen. A live read (feed, single post, spotlight)
// sends `x-couture-sponsorship: 1`, so its answer is authoritative either way:
// a block, or no block. The sync coordinator's `targets/resolve` copies take no
// opt-in, so their missing field says nothing. The rule is therefore:
//
// - every live read records its answer here, and every rendered copy of that
//   post (feed, New looks, deep-link card, spotlight) takes it at once, so a
//   live read without the block removes a block shown earlier;
// - the newest read wins: each read takes a stamp from `begin()` when it starts,
//   and an answer from a read that started before the one already recorded for
//   that post is dropped, whichever call site made either read and whatever
//   order the responses land in;
// - a resolve copy takes the latest live answer for its post, and a post no live
//   read has answered for renders no block.
import type {
  CommunitySponsoredFeedItem,
  CommunitySponsorship,
} from '@couture/api-client/contracts/http'

type SponsoredCopy = Pick<CommunitySponsoredFeedItem, 'id' | 'status' | 'sponsorship'>

function sameBlock(
  left: CommunitySponsorship | undefined,
  right: CommunitySponsorship | undefined
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return (
    left.partnerId === right.partnerId &&
    left.partnerDisplayName === right.partnerDisplayName &&
    left.offerId === right.offerId &&
    left.offerTitle === right.offerTitle
  )
}

/** When a live read started, from `LiveCommunitySponsorships.begin()`. */
export type LiveReadStamp = number

export class LiveCommunitySponsorships {
  private readonly answers = new Map<
    string,
    { answer: CommunitySponsorship | null; stamp: LiveReadStamp }
  >()
  private readonly listeners = new Set<() => void>()
  private lastStamp = 0
  /** Reads that started before the last `clear()` belong to another member. */
  private clearedAt = 0

  /** Call as a live read starts; pass the stamp to `record` with its answer. */
  begin(): LiveReadStamp {
    this.lastStamp += 1
    return this.lastStamp
  }

  /** Records what one live opted-in read, started at `stamp`, said for each post. */
  record(items: readonly SponsoredCopy[], stamp: LiveReadStamp): void {
    if (stamp <= this.clearedAt) return
    let changed = false
    for (const item of items) {
      const answer =
        item.status === 'published' && item.sponsorship ? item.sponsorship : null
      const previous = this.answers.get(item.id)
      // A read that started before the recorded one is stale, however late it lands.
      if (previous && previous.stamp > stamp) continue
      this.answers.set(item.id, { answer, stamp })
      if (previous && sameBlock(previous.answer ?? undefined, answer ?? undefined))
        continue
      changed = true
    }
    if (changed) for (const listener of [...this.listeners]) listener()
  }

  /**
   * The copy as the latest live read describes it. Returns the same object when
   * nothing changes, so applying it to a list re-renders nothing.
   */
  apply<T extends SponsoredCopy>(item: T): T {
    const answer = this.answers.get(item.id)?.answer
    if (answer === undefined) {
      // No live read answered for this post: a block on the copy is not ours to
      // vouch for, and a resolve copy carries none.
      return item
    }
    if (answer === null || item.status !== 'published') {
      if (!('sponsorship' in item)) return item
      const copy = { ...item }
      delete copy.sponsorship
      return copy
    }
    return sameBlock(item.sponsorship, answer) ? item : { ...item, sponsorship: answer }
  }

  /** Applies the latest answers to a list, keeping its identity when nothing changes. */
  applyAll<T extends SponsoredCopy>(items: T[]): T[] {
    let changed = false
    const next = items.map((item) => {
      const applied = this.apply(item)
      if (applied !== item) changed = true
      return applied
    })
    return changed ? next : items
  }

  /** Runs `listener` after every live read that changed an answer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** A new member starts with no answers, and earlier reads record nothing. */
  clear(): void {
    this.answers.clear()
    this.clearedAt = this.lastStamp
  }
}
