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

  const LOCALES = ['de', 'en', 'es', 'fr', 'it', 'pt', 'tr'] as const
  const readLedger = (): unknown =>
    JSON.parse(fs.readFileSync(path.join(corpusDir, 'holdout-retirements.json'), 'utf8'))

  // Production follow-up 2026-11-19: the allow list was tuned against the row-level false
  // positives of holdout-v6 (de, en, es, fr, it, tr) and holdout-v8 (pt), so both were retired
  // for every locale they gated. Until a fresh holdout is sealed and released, the checked-in
  // selector must refuse, so no run can present a tuned-against figure as release evidence.
  it('refuses the checked-in selector while every active holdout is retired', () => {
    expect(() => loadActiveHoldouts(corpusDir)).toThrow(
      /active text holdout holdout-v\d+ is retired for [a-z]{2}/
    )
  })

  it('registers no eligible holdout', () => {
    expect((readLedger() as { eligible: Record<string, unknown> }).eligible).toEqual({})
  })

  it('retires the version each locale is still selected on, with the tuning disclosed', () => {
    const active = parseActiveHoldout(
      JSON.parse(fs.readFileSync(path.join(corpusDir, 'active-holdout.json'), 'utf8'))
    )
    const ledger = readLedger()
    for (const locale of LOCALES) {
      const version = active[locale] as string
      expect(version, locale).toBe(locale === 'pt' ? 'holdout-v8' : 'holdout-v6')
      expect(() => requireEligibleHoldout(version, ledger, locale)).toThrow(
        new RegExp(`${version} is retired for ${locale}: .*tuned the allow list`)
      )
    }
  })

  it('keeps the spent Portuguese holdouts retired', () => {
    const ledger: unknown = JSON.parse(
      fs.readFileSync(path.join(corpusDir, 'holdout-retirements.json'), 'utf8')
    )
    for (const version of ['holdout-v6', 'holdout-v7', 'holdout-v8']) {
      expect(() => requireEligibleHoldout(version, ledger, 'pt')).toThrow(
        new RegExp(`${version} is retired for pt`)
      )
    }
  })
})
