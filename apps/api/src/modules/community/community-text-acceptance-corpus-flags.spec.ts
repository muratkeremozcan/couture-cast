import { beforeAll, describe, expect, it } from 'vitest'
import { CommunityTextScreener } from './community-text-screener'
import { flagCorpus } from './community-text-acceptance-flags'

/**
 * FROZEN CLEAN CORPUS (round 7m), part "flags". Regional indicator letters are mapped to
 * Latin letters because they also spell words; the flag emoji people post must not newly
 * withhold. See community-text-acceptance-flags.ts for the generator (every valid flag, every
 * two-flag run, seeded longer runs, flags beside words in all seven languages). Nothing in
 * this part may be withheld.
 *
 * Budget: measured with coverage instrumentation on a quiet machine the part takes
 * 13 s; CI runs about 2.6 times slower (35 s), and the timeout keeps more than 8 times that.
 */
const PINNED_TOTAL = 140430
const FLAGS_TIMEOUT_MS = 300_000

describe('frozen clean corpus, flags', () => {
  let total = 0
  const withheld: string[] = []
  beforeAll(() => {
    const screener = new CommunityTextScreener()
    for (const { text, locale } of flagCorpus()) {
      total += 1
      const { disposition } = screener.screen({ text, field: 'caption', locale })
      if (disposition !== 'pass') withheld.push(`${disposition[0]} ${text}`)
    }
  }, FLAGS_TIMEOUT_MS)

  it('has the pinned number of strings', () => {
    expect(total).toBe(PINNED_TOTAL)
  })

  it('withholds none of them', () => {
    expect(withheld).toEqual([])
  })
})
