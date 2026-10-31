// Learning path Step 47: Sponsored community highlights.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-47-sponsored-community-highlights
// Story 6.7b R12: the web live sponsorship ledger orders answers by read start.
import { describe, expect, it } from 'vitest'
import type { CommunitySponsorship } from '@couture/api-client/contracts/http'
import { LiveSponsorshipLedger } from './live-sponsorships'

const BLOCK: CommunitySponsorship = {
  partnerId: 'atelier-north',
  partnerDisplayName: 'Atelier North',
  offerId: 'offer-community-coat',
  offerTitle: 'Charcoal wool coat',
}

describe('LiveSponsorshipLedger (Story 6.7b)', () => {
  it('6.7b-WEB-LIB-01 keeps the answer of the read that started last, in either landing order', () => {
    const ledger = new LiveSponsorshipLedger()
    const older = ledger.begin()
    const newer = ledger.begin()
    ledger.record([{ id: 'post-1' }], newer)
    ledger.record([{ id: 'post-1', sponsorship: BLOCK }], older)
    expect(ledger.has('post-1')).toBe(true)
    expect(ledger.get('post-1')).toBeUndefined()

    const reverse = new LiveSponsorshipLedger()
    const first = reverse.begin()
    const second = reverse.begin()
    reverse.record([{ id: 'post-1', sponsorship: BLOCK }], second)
    reverse.record([{ id: 'post-1' }], first)
    expect(reverse.get('post-1')).toEqual(BLOCK)
  })

  it('6.7b-WEB-LIB-02 answers per post, so a stale read still records posts nobody newer answered', () => {
    const ledger = new LiveSponsorshipLedger()
    const older = ledger.begin()
    const newer = ledger.begin()
    ledger.record([{ id: 'post-1' }], newer)
    ledger.record(
      [
        { id: 'post-1', sponsorship: BLOCK },
        { id: 'post-2', sponsorship: BLOCK },
      ],
      older
    )
    expect(ledger.get('post-1')).toBeUndefined()
    expect(ledger.get('post-2')).toEqual(BLOCK)
    expect(ledger.has('post-3')).toBe(false)
  })

  it('6.7b-WEB-LIB-03 clear forgets every answer and drops reads started for the previous viewer', () => {
    const ledger = new LiveSponsorshipLedger()
    const before = ledger.begin()
    ledger.record([{ id: 'post-1', sponsorship: BLOCK }], ledger.begin())
    ledger.clear()
    expect(ledger.has('post-1')).toBe(false)
    ledger.record([{ id: 'post-1', sponsorship: BLOCK }], before)
    expect(ledger.has('post-1')).toBe(false)
    const after = ledger.begin()
    ledger.record([{ id: 'post-1', sponsorship: BLOCK }], after)
    expect(ledger.get('post-1')).toEqual(BLOCK)
  })
})
