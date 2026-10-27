import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  assertActiveHoldoutEligible,
  requireEligibleHoldout,
} from '../../apps/api/src/modules/community/community-text-holdout-eligibility-core.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const generator = path.join(
  projectRoot,
  'scripts/generate-community-screening-readiness.mjs'
)
const approvedVersion = 'holdout-v99'
const approvedSeal = {
  corpusVersion: approvedVersion,
  sealedAt: '2026-10-26T08:05:04.440Z',
  corpusSha256: 'a'.repeat(64),
}
const ledger = {
  schemaVersion: 2,
  eligible: { [approvedVersion]: approvedSeal },
  retired: Object.fromEntries(
    [1, 2, 3, 4, 5].map((number) => [`holdout-v${number}`, 'Retired fixture cohort.'])
  ),
}

// Execute the real CLI startup with metadata fixtures. The first external command
// ends the probe before any screening input, product, container or database access.
const startupProbe = `
import fs from 'node:fs'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
const fixtures = JSON.parse(process.env.CC68_TEA_GATE_FIXTURES)
const read = fs.readFileSync.bind(fs)
const exists = fs.existsSync.bind(fs)
function fixture(file) {
  const name = String(file).replaceAll('\\\\', '/')
  if (name.endsWith('/community-text-corpus/active-holdout.json')) {
    return { corpusVersion: fixtures.version }
  }
  if (name.endsWith('/community-text-corpus/holdout-retirements.json')) {
    return fixtures.ledger
  }
  if (name.endsWith('/community-text-corpus/' + fixtures.version + '/freeze-manifest.json')) {
    return fixtures.seal
  }
}
fs.readFileSync = (file, options) => {
  const value = fixture(file)
  if (value === undefined) return read(file, options)
  const bytes = JSON.stringify(value)
  return options ? bytes : Buffer.from(bytes)
}
fs.existsSync = file => fixture(file) !== undefined || exists(file)
childProcess.execFileSync = () => {
  process.stderr.write('TEA_STARTUP_EXTERNAL_COMMAND_BOUNDARY\\n')
  process.exit(93)
}
syncBuiltinESMExports()
`
const probeImport = `data:text/javascript;base64,${Buffer.from(startupProbe).toString('base64')}`

function startup(version, fixtureLedger = ledger, seal = approvedSeal) {
  return spawnSync(process.execPath, ['--import', probeImport, generator], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CC68_TEA_GATE_FIXTURES: JSON.stringify({ version, ledger: fixtureLedger, seal }),
    },
    timeout: 10_000,
  })
}

describe('community text holdout eligibility', () => {
  for (const number of [1, 2, 3, 4, 5]) {
    test(`readiness CLI refuses retired holdout-v${number} before external work`, () => {
      const result = startup(`holdout-v${number}`)
      assert.equal(result.status, 1, result.stderr)
      assert.match(result.stderr, /retired|not eligible/i)
      assert.doesNotMatch(result.stderr, /TEA_STARTUP_EXTERNAL_COMMAND_BOUNDARY/)
    })
  }

  test('readiness CLI admits a sealed, explicitly eligible synthetic version', () => {
    const result = startup(approvedVersion)
    assert.equal(result.status, 93, result.stderr)
    assert.match(result.stderr, /TEA_STARTUP_EXTERNAL_COMMAND_BOUNDARY/)
  })

  test('readiness CLI refuses an unclassified version despite a valid seal', () => {
    const result = startup('holdout-v100', ledger, {
      ...approvedSeal,
      corpusVersion: 'holdout-v100',
    })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /not eligible/i)
    assert.doesNotMatch(result.stderr, /TEA_STARTUP_EXTERNAL_COMMAND_BOUNDARY/)
  })

  for (const [name, change] of [
    ['changed SHA', { corpusSha256: 'b'.repeat(64) }],
    ['changed time', { sealedAt: '2026-10-27T00:00:00Z' }],
    ['wrong version', { corpusVersion: 'holdout-v100' }],
    ['missing seal', null],
  ]) {
    test(`readiness CLI refuses ${name} before external work`, () => {
      const result = startup(
        approvedVersion,
        ledger,
        change === null ? null : { ...approvedSeal, ...change }
      )
      assert.equal(result.status, 1, result.stderr)
      assert.match(result.stderr, /seal/i)
      assert.doesNotMatch(result.stderr, /TEA_STARTUP_EXTERNAL_COMMAND_BOUNDARY/)
    })
  }

  for (const invalidLedger of [
    null,
    { schemaVersion: 1, retired: {} },
    { ...ledger, eligible: [] },
    { ...ledger, retired: [] },
    { ...ledger, retired: { 'holdout-v1': '' } },
    { ...ledger, eligible: { '../holdout-v99': approvedSeal } },
    { ...ledger, eligible: { [approvedVersion]: { ...approvedSeal, corpusSha256: '' } } },
    { ...ledger, retired: { [approvedVersion]: 'Retired after disclosure.' } },
  ]) {
    test(`rejects malformed or contradictory ledger ${JSON.stringify(invalidLedger)}`, () => {
      assert.throws(
        () => requireEligibleHoldout(approvedVersion, invalidLedger),
        /ledger is invalid/
      )
    })
  }

  test('registered seal must be an own allowlist entry', () => {
    const inherited = {
      ...ledger,
      eligible: Object.create({ [approvedVersion]: approvedSeal }),
    }
    assert.throws(
      () => assertActiveHoldoutEligible(approvedVersion, approvedSeal, inherited),
      /not eligible/
    )
  })

  test('the checked-in ledger retires every historical version and approves none before sealing', () => {
    const current = JSON.parse(
      fs.readFileSync(
        path.join(
          projectRoot,
          'apps/api/test/fixtures/community-text-corpus/holdout-retirements.json'
        ),
        'utf8'
      )
    )
    for (const number of [1, 2, 3, 4, 5]) {
      assert.throws(
        () => requireEligibleHoldout(`holdout-v${number}`, current),
        /retired/
      )
    }
    assert.equal(current.schemaVersion, 2)
    assert.throws(() => requireEligibleHoldout('holdout-v100', current), /not eligible/)
  })
})
