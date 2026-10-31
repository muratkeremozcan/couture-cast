// Story 6.7b web ledger owner: read-start ordering in `apps/web/src/lib/live-sponsorships.ts`, applied in `apps/web/src/app/components/community-lookbook-grid.tsx`
// Story 6.7b owner: what the latest live, opted-in read said about each post's
// sponsorship block, for one community surface and one viewer. The web twin of
// `apps/mobile/src/features/community/live-sponsorships.ts`.
//
// A live read (feed, single post, spotlight) sends `x-couture-sponsorship: 1`,
// so its answer is authoritative either way: a block, or no block. A realtime
// `targets/resolve` copy takes no opt-in, so its missing field says nothing.
//
// - The newest read wins. Each read takes a stamp from `begin()` when it
//   STARTS, and an answer from a read that started before the one already
//   recorded for that post is dropped, whichever call site made either read and
//   whatever order the responses land in.
// - `clear()` on a viewer change forgets every answer and drops answers from
//   reads that started for the previous viewer.
// - A post no live read has answered for is left as it is.
import type { CommunitySponsorship } from '@couture/api-client/contracts/http'

/** When a live read started, from `LiveSponsorshipLedger.begin()`. */
export type LiveReadStamp = number

/** The latest answer per post: `get` is undefined for an explicit "no block". */
export interface LiveSponsorshipAnswers {
  has(postId: string): boolean
  get(postId: string): CommunitySponsorship | undefined
}

export class LiveSponsorshipLedger implements LiveSponsorshipAnswers {
  private readonly answers = new Map<
    string,
    { block: CommunitySponsorship | undefined; stamp: LiveReadStamp }
  >()
  private lastStamp = 0
  /** Reads that started at or before this stamp belong to a previous viewer. */
  private clearedAt = 0

  /** Call as a live read starts; pass the stamp to `record` with its answer. */
  begin(): LiveReadStamp {
    this.lastStamp += 1
    return this.lastStamp
  }

  /** Records what one live read, started at `stamp`, said for each post it carried. */
  record(
    posts: readonly { id: string; sponsorship?: CommunitySponsorship }[],
    stamp: LiveReadStamp
  ): void {
    if (stamp <= this.clearedAt) return
    for (const post of posts) {
      const previous = this.answers.get(post.id)
      // A read that started before the recorded one is stale, however late it lands.
      if (previous && previous.stamp > stamp) continue
      this.answers.set(post.id, { block: post.sponsorship, stamp })
    }
  }

  has(postId: string): boolean {
    return this.answers.has(postId)
  }

  get(postId: string): CommunitySponsorship | undefined {
    return this.answers.get(postId)?.block
  }

  /** A new viewer starts with no answers, and earlier reads record nothing. */
  clear(): void {
    this.answers.clear()
    this.clearedAt = this.lastStamp
  }
}
