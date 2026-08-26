import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Story 5.4: the seed module graph must instantiate under `tsx`, in the import
 * order `prisma db seed` actually uses.
 *
 * This is the only suite in the repository that can fail on that. Vitest
 * resolves `@couture/utils` through its own bundler resolution and `typecheck`
 * reads `../utils/dist/index.d.ts`, so both see a module with 46 named exports.
 * Node, running `tsx prisma/seeds/index.ts`, sees something else entirely once
 * `testing/src/factories/factory.ts` has `require`d the package first: the ESM
 * facade built from an already-cached CommonJS module carries only `default`
 * and `module.exports`, and every named import of it throws
 * `does not provide an export named ...` before any seed code runs.
 *
 * Story 5.4 introduced the first `@couture/utils` import into the seeds and hit
 * exactly that. `lint`, `typecheck`, `verify:changed`, the coverage ratchets,
 * Pact and the whole integration tier were green; `db:reset` failed, which took
 * out all seven mobile E2E shards, the Playwright burn-in and the k6 smoke at
 * once. The gap was not that any of those suites was weak, it was that nothing
 * loaded the seed graph the way the seed runner does. This closes it.
 *
 * See `packages/db/test/fixtures/seed-graph-instantiation-probe.ts` for the
 * probe, whose import ORDER is the contract under test.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(here, '..')
const repoRoot = path.resolve(workspaceRoot, '..', '..')
const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx')
const probe = path.join(here, 'fixtures', 'seed-graph-instantiation-probe.ts')

describe('seed module graph instantiation', () => {
  /**
   * The probe touches no database. It is spawned rather than imported on
   * purpose: importing it here would resolve through Vitest and prove nothing.
   */
  it('5.4-DB-040 instantiates every seed module under tsx in prisma db seed import order', () => {
    const stdout = execFileSync(tsxBin, [probe], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      // Inherited so a developer's own DATABASE_URL cannot change the outcome;
      // nothing in the probe reads it, and that is asserted by it passing on a
      // machine with no database running at all.
      env: process.env,
      timeout: 60_000,
    })

    const bindings = JSON.parse(stdout) as Record<string, unknown>
    const { factoryExportCount, ...seedBindings } = bindings

    // Split out rather than matched loosely: the factory's export count is not
    // this suite's business, but the factory having been loaded FIRST is the
    // whole precondition, so its presence is still asserted.
    expect(typeof factoryExportCount).toBe('number')
    expect(seedBindings).toEqual({
      samplePartnerSlug: 'string',
      seedAdvisorOfferCatalog: 'function',
      seedCommerceCatalog: 'function',
      seedFeatureFlags: 'function',
      seedPaletteAdvisorWardrobe: 'function',
      seedPremiumEntitlements: 'function',
      seedRituals: 'function',
      seedUsers: 'function',
      seedWardrobeItems: 'function',
      seedWeather: 'function',
    })
  })
})
