import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertActiveHoldoutEligible,
  type HoldoutSealIdentity,
} from './community-text-holdout-eligibility.js'

const retirements = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../test/fixtures/community-text-corpus/holdout-retirements.json'
    ),
    'utf8'
  )
) as { schemaVersion: number; retired: Record<string, string> }

function sealed(version: string): HoldoutSealIdentity {
  return {
    corpusVersion: version,
    sealedAt: '2026-10-26T08:05:04.440826+00:00',
    corpusSha256: 'a'.repeat(64),
  }
}

describe('active text holdout eligibility', () => {
  it.each(['holdout-v3', 'holdout-v4', 'holdout-v5'])(
    'rejects retired %s even when its historical seal is valid',
    (version) => {
      expect(retirements.schemaVersion).toBe(1)
      expect(() =>
        assertActiveHoldoutEligible(version, sealed(version), retirements.retired)
      ).toThrow(/retired/)
    }
  )

  it('accepts a sealed unretired version without reading its text or screening inputs', () => {
    expect(() =>
      assertActiveHoldoutEligible('holdout-v6', sealed('holdout-v6'), retirements.retired)
    ).not.toThrow()
  })

  it('rejects another retired version supplied through the same ledger', () => {
    expect(() =>
      assertActiveHoldoutEligible('holdout-v9', sealed('holdout-v9'), {
        ...retirements.retired,
        'holdout-v9': 'Retired after disclosure to development.',
      })
    ).toThrow(/retired/)
  })

  it.each([
    { ...sealed('holdout-v6'), corpusVersion: 'holdout-v4' },
    { ...sealed('holdout-v6'), sealedAt: '' },
    { ...sealed('holdout-v6'), sealedAt: 'unsealed' },
    { ...sealed('holdout-v6'), corpusSha256: '' },
    { ...sealed('holdout-v6'), corpusSha256: 'g'.repeat(64) },
  ])('rejects an absent or mismatched seal identity: %j', (seal) => {
    expect(() =>
      assertActiveHoldoutEligible('holdout-v6', seal, retirements.retired)
    ).toThrow(/seal/)
  })

  it.each(['../holdout-v5', 'holdout-v0', 'holdout-v05', '', 'development-v4'])(
    'rejects invalid selector %s',
    (version) => {
      expect(() =>
        assertActiveHoldoutEligible(version, sealed(version), retirements.retired)
      ).toThrow(/invalid/)
    }
  )
})
