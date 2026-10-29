import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertActiveHoldoutEligible,
  type HoldoutEligibilityLedger,
  type HoldoutSealIdentity,
} from './community-text-holdout-eligibility.js'

const retirements: unknown = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../test/fixtures/community-text-corpus/holdout-retirements.json'
    ),
    'utf8'
  )
)

function sealed(version: string): HoldoutSealIdentity {
  return {
    corpusVersion: version,
    sealedAt: '2026-10-26T08:05:04.440Z',
    corpusSha256: 'a'.repeat(64),
  }
}
const version = 'holdout-v99'
const eligible: HoldoutEligibilityLedger = {
  schemaVersion: 2,
  eligible: { [version]: sealed(version) },
  retired: {},
}

describe('active text holdout eligibility API bridge', () => {
  it.each(['holdout-v1', 'holdout-v2', 'holdout-v3', 'holdout-v4', 'holdout-v5'])(
    'rejects retired %s even when its historical seal is valid',
    (retiredVersion) => {
      expect(() =>
        assertActiveHoldoutEligible(
          retiredVersion,
          sealed(retiredVersion),
          retirements,
          'de'
        )
      ).toThrow(/retired/)
    }
  )

  it('accepts a sealed, explicitly eligible version', () => {
    expect(() =>
      assertActiveHoldoutEligible(version, sealed(version), eligible, 'de')
    ).not.toThrow()
  })

  it('rejects an unclassified version despite a valid seal', () => {
    expect(() =>
      assertActiveHoldoutEligible('holdout-v100', sealed('holdout-v100'), eligible, 'de')
    ).toThrow(/eligible/)
  })

  it.each([
    { ...sealed(version), corpusVersion: 'holdout-v4' },
    { ...sealed(version), sealedAt: '' },
    { ...sealed(version), sealedAt: 'unsealed' },
    { ...sealed(version), sealedAt: '2026-10-27T00:00:00Z' },
    { ...sealed(version), corpusSha256: '' },
    { ...sealed(version), corpusSha256: 'g'.repeat(64) },
    { ...sealed(version), corpusSha256: 'b'.repeat(64) },
  ])('rejects an absent, mismatched or unregistered seal identity: %j', (seal) => {
    expect(() => assertActiveHoldoutEligible(version, seal, eligible, 'de')).toThrow(
      /seal/
    )
  })

  it.each(['../holdout-v5', 'holdout-v0', 'holdout-v05', '', 'development-v4'])(
    'rejects invalid selector %s',
    (invalidVersion) => {
      expect(() =>
        assertActiveHoldoutEligible(
          invalidVersion,
          sealed(invalidVersion),
          eligible,
          'de'
        )
      ).toThrow(/invalid/)
    }
  )
})
