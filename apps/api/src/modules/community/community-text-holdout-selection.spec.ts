import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { passesCleanHoldoutGate, wilsonInterval } from './community-text-corpus-gate.js'
import {
  describeCleanGates,
  loadActiveHoldouts,
} from './community-text-holdout-selection.mjs'

// Synthetic figures for two locales gated on two different holdout versions.
const seal = (version: string, hex: string) => ({
  corpusVersion: version,
  sealedAt: '2026-10-26T08:05:04.440Z',
  corpusSha256: hex.repeat(64),
})
const holdouts = {
  de: { version: 'holdout-v50', seal: seal('holdout-v50', 'a') },
  pt: { version: 'holdout-v52', seal: seal('holdout-v52', 'b') },
}

describe('per-locale clean gate', () => {
  it('gates each locale on its own figures and records both versions and seals', () => {
    const results = {
      de: { withheld: 0, total: 1000 },
      pt: { withheld: 14, total: 2000 },
    }
    expect(passesCleanHoldoutGate(results.de.withheld, results.de.total)).toBe(true)
    expect(passesCleanHoldoutGate(results.pt.withheld, results.pt.total)).toBe(false)
    expect(wilsonInterval(results.pt.withheld, results.pt.total)[1]).toBeGreaterThan(0.01)
    expect(describeCleanGates(holdouts)).toEqual({
      cleanGatedOn: { de: 'holdout-v50', pt: 'holdout-v52' },
      cleanSeals: { de: 'a'.repeat(64), pt: 'b'.repeat(64) },
    })
  })
})

describe('checked-in selector', () => {
  it('fails closed until every locale names an eligible, sealed holdout', () => {
    const corpusDir = path.resolve(
      __dirname,
      '../../../test/fixtures/community-text-corpus'
    )
    expect(() => loadActiveHoldouts(corpusDir)).toThrow(/holdout-v5 is retired for de/)
  })
})
