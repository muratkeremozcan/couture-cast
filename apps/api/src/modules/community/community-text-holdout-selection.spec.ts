import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { passesCleanHoldoutGate, wilsonInterval } from './community-text-corpus-gate.js'
import {
  parseActiveHoldout,
  requireEligibleHoldout,
} from './community-text-holdout-eligibility-core.mjs'
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
  const corpusDir = path.resolve(
    __dirname,
    '../../../test/fixtures/community-text-corpus'
  )

  it('fails closed on Portuguese until a fresh holdout is registered for it', () => {
    expect(() => loadActiveHoldouts(corpusDir)).toThrow(/holdout-v6 is retired for pt/)
  })

  it('names holdout-v6 for the six locales it is eligible for', () => {
    const active = parseActiveHoldout(
      JSON.parse(fs.readFileSync(path.join(corpusDir, 'active-holdout.json'), 'utf8'))
    )
    const ledger: unknown = JSON.parse(
      fs.readFileSync(path.join(corpusDir, 'holdout-retirements.json'), 'utf8')
    )
    for (const locale of ['de', 'en', 'es', 'fr', 'it', 'tr']) {
      expect(active[locale]).toBe('holdout-v6')
      expect(requireEligibleHoldout('holdout-v6', ledger, locale).corpusVersion).toBe(
        'holdout-v6'
      )
    }
  })
})
