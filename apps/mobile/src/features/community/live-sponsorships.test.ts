// Story 6.7b: the latest live sponsorship answer per post, which every rendered
// copy takes, and which resolve-path copies inherit.
import { describe, expect, it, vi } from 'vitest'
import type {
  CommunitySponsoredFeedItem,
  CommunitySponsorship,
} from '@couture/api-client/contracts/http'
import { LiveCommunitySponsorships } from './live-sponsorships'

const BLOCK: CommunitySponsorship = {
  partnerId: 'atelier-north',
  partnerDisplayName: 'Atelier North',
  offerId: 'offer-coat',
  offerTitle: 'Wool overcoat',
}

function post(
  overrides: Partial<CommunitySponsoredFeedItem> = {}
): CommunitySponsoredFeedItem {
  return {
    id: 'post-a',
    caption: null,
    altText: 'A coat.',
    climateBand: null,
    imageAccess: { url: 'https://img.test/a.jpg', expiresAt: '2099-01-01T00:00:00.000Z' },
    publishedAt: '2026-10-22T09:00:00.000Z',
    createdAt: '2026-10-22T08:59:00.000Z',
    status: 'published',
    challengeId: null,
    author: { displayName: 'Ana', isSelf: false },
    ...overrides,
  }
}

describe('LiveCommunitySponsorships (Story 6.7b)', () => {
  it('6.7b-MOB-043 gives a resolve copy the block of the latest live read', () => {
    const ledger = new LiveCommunitySponsorships()
    ledger.record([post({ sponsorship: BLOCK })])

    expect(ledger.apply(post({ caption: 'Resolved' }))).toEqual(
      post({ caption: 'Resolved', sponsorship: BLOCK })
    )
  })

  it('6.7b-MOB-044 a later live read without the block removes it from every copy', () => {
    const ledger = new LiveCommunitySponsorships()
    const listener = vi.fn()
    ledger.subscribe(listener)
    const shown = post({ sponsorship: BLOCK })
    ledger.record([shown])
    expect(listener).toHaveBeenCalledTimes(1)

    ledger.record([post()])

    expect(listener).toHaveBeenCalledTimes(2)
    expect(ledger.apply(shown)).not.toHaveProperty('sponsorship')
    expect(ledger.apply(post({ caption: 'Resolved' }))).not.toHaveProperty('sponsorship')
  })

  it('6.7b-MOB-045 carries nothing to an unanswered post or a hidden one', () => {
    const ledger = new LiveCommunitySponsorships()
    const unanswered = post({ id: 'post-b' })
    expect(ledger.apply(unanswered)).toBe(unanswered)

    ledger.record([post({ sponsorship: BLOCK })])
    expect(ledger.apply(post({ status: 'withdrawn' }))).not.toHaveProperty('sponsorship')
    ledger.record([post({ status: 'withdrawn', sponsorship: BLOCK })])
    expect(ledger.apply(post())).not.toHaveProperty('sponsorship')
  })

  it('6.7b-MOB-046 keeps list identity when nothing changes and forgets answers on clear', () => {
    const ledger = new LiveCommunitySponsorships()
    const listener = vi.fn()
    ledger.subscribe(listener)
    const list = [post({ sponsorship: BLOCK })]
    ledger.record(list)
    ledger.record([post({ sponsorship: { ...BLOCK } })])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(ledger.applyAll(list)).toBe(list)

    ledger.clear()
    const resolved = post()
    expect(ledger.apply(resolved)).toBe(resolved)
  })
})
