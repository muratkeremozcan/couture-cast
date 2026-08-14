import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Guard: no E2E flow may assert a value that exists only in a unit-test mock.
 *
 * Three separate defects shared this root cause, and each produced a Maestro
 * flow that could not have passed against a real server on any run:
 *
 *  - `hero-experience.yaml` asserted the mobile MSW `comfortNotes` copy ("Warm
 *    and sunny midday. Light tee is perfect.") against the live API.
 *  - `accessibility-hardening.yaml` asserted `garment-tile-classic-trench-coat`
 *    and `swap-option-leather-jacket`. Those garment ids exist only in the mock;
 *    the seed below generates `<userId>-garment-<n>`, so the real ids differ on
 *    every run.
 *  - `deep-link-handling.yaml` opened `?alertId=alert-777`, an id nothing seeds.
 *
 * Each was found separately, on device, after a long hunt, because the symptom
 * is always "element not found" -- indistinguishable from a genuine UI
 * regression. This fails in milliseconds instead.
 *
 * It lives here, beside the seeds, because the claim it enforces is a claim
 * about seeded data: a flow may only assert values this package actually
 * produces. It reads the mobile fixtures as text rather than importing them, so
 * no workspace boundary is crossed.
 *
 * The check is deliberately identifier- and copy-level. It does not diff whole
 * payloads: mocks are *supposed* to hold different values from the seed, and a
 * payload diff would be noise that gets suppressed rather than signal anyone
 * acts on.
 */

const repoRoot = join(__dirname, '..', '..', '..')
const seedsDir = join(repoRoot, 'packages', 'db', 'prisma', 'seeds')
const maestroDir = join(repoRoot, 'maestro')
const contractsDir = join(repoRoot, 'packages', 'api-client', 'src', 'contracts')
const mobileMockFile = join(
  repoRoot,
  'apps',
  'mobile',
  'src',
  'test-utils',
  'msw',
  'handlers.ts'
)

function readAll(dir: string, extension: string): string {
  return readdirSync(dir)
    .flatMap((entry) => {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) return [readAll(full, extension)]
      return full.endsWith(extension) ? [readFileSync(full, 'utf8')] : []
    })
    .join('\n')
}

const seedSource = readAll(seedsDir, '.ts')
const contractSource = readAll(contractsDir, '.ts')
const mockSource = readFileSync(mobileMockFile, 'utf8')

/**
 * Comments are stripped before scanning. The flows document the defects they
 * were repaired for, by name -- `accessibility-hardening.yaml` explains at
 * length that it used to assert `classic-trench-coat` -- and a guard that
 * flagged its own postmortem would push people to delete the explanation.
 */
const maestroSource = readAll(maestroDir, '.yaml')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')

/**
 * Every single-quoted literal in the mock module that is long enough to be an
 * identifier or a sentence rather than an enum member or a key. Read out of the
 * source so a new outfit, locale or offer is covered the moment it is written,
 * rather than when someone remembers to extend a hand-maintained list.
 */
const mockLiterals = [
  ...new Set(
    [...mockSource.matchAll(/'([^'\\\n]{7,})'/g)].map((match) => match[1] as string)
  ),
]

/**
 * A literal that appears in the seeds or in the canonical Zod contracts is
 * shared vocabulary, not drift, and a flow is entitled to assert it.
 *
 *  - Seeds: `commerce.ts` seeds `sample-partner`, so `commerce-affiliate.yaml`
 *    may assert it.
 *  - Contracts: `evening` is a member of the ritual scenario enum, so
 *    `hero-experience.yaml` may build `scenario-toggle-evening` from it.
 *
 * URLs and paths are dropped because the mock module and the flows legitimately
 * share endpoint strings; those are contract, not test data.
 */
const mockOnlyLiterals = mockLiterals.filter(
  (literal) =>
    !seedSource.includes(literal) &&
    !contractSource.includes(literal) &&
    !literal.startsWith('http') &&
    !literal.startsWith('/') &&
    !literal.startsWith('*/')
)

describe('E2E flows never assert unit-test mock data', () => {
  it('read all three sources', () => {
    // A path that silently walked the wrong directory would make the assertion
    // below vacuously true.
    expect(seedSource).toContain('-garment-${i + 1}')
    expect(maestroSource).toContain('appId:')
    expect(mockSource).toContain('classic-trench-coat')
  })

  it('collected a meaningful set of mock-only literals', () => {
    expect(mockOnlyLiterals.length).toBeGreaterThan(5)
    expect(mockOnlyLiterals).toContain('classic-trench-coat')
    expect(mockOnlyLiterals).toContain('Warm and sunny midday. Light tee is perfect.')
  })

  it('no Maestro flow references a value that exists only in the mobile mocks', () => {
    const leaked = mockOnlyLiterals.filter((literal) => maestroSource.includes(literal))

    expect(
      leaked,
      'These values exist only in apps/mobile/src/test-utils/msw/handlers.ts, so a ' +
        'Maestro flow asserting them can never pass against the real API and the ' +
        `seeded database:\n  ${leaked.join('\n  ')}`
    ).toEqual([])
  })
})
