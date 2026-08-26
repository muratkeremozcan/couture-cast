import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * The tripwire under this directory's schema probes.
 *
 * Fourteen suites here open with the same shape: `SELECT 1 FROM "SomeTable"`,
 * and on failure they `console.warn` and `context.skip()`. That is deliberate
 * and worth keeping, because a developer with no database should still get the
 * unit tier rather than a wall of connection errors. What it cannot do is tell
 * the difference between "no database on this laptop" and "CI pointed the
 * suites at the wrong database", and the second one is silent: the run is
 * green, sixty-odd tests announce themselves skipped in a log nobody reads, and
 * the only surviving signal is the coverage ratchet failing for a reason that
 * names coverage rather than the database. `apps/api/vitest.config.ts` records
 * one instance of exactly that, on 2026-08-18, when `packages/db/.env` silently
 * repointed `DATABASE_URL` inside the worker.
 *
 * The suites that carry the highest-value evidence in this repository are
 * behind those probes -- that the palette selfie is purged on all three
 * terminal doors, that consent is audited both ways, that the garment and
 * advisor offer selections cannot cross against real SQL. Evidence that can
 * quietly stop running is not evidence.
 *
 * So: on a machine that says it is CI, a failed probe is a failed run. Locally
 * the behaviour is unchanged.
 *
 * THE TABLE LIST IS READ OUT OF THE SIBLING SUITES rather than pinned here. A
 * hand-maintained copy would have to be edited by whoever adds the next
 * integration suite, which is the same person who would forget, and a guard
 * that silently stops covering a suite is the failure it exists to prevent.
 */

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

/**
 * True when the run claims to be automated. GitHub Actions sets `CI=true` on
 * every runner, so no workflow has to opt in and no workflow can forget to.
 */
const isAutomatedRun = process.env.CI === 'true' || process.env.CI === '1'

/**
 * Every table a sibling suite probes for, scraped from their source.
 *
 * The pattern matched is the probe form those files actually use --
 * `SELECT 1 FROM "Table"` inside a tagged template -- and nothing else, so a
 * table named only in a query under test does not widen this guard beyond the
 * skip conditions it is mirroring.
 */
function probedTables(): string[] {
  const directory = __dirname
  const tables = new Set<string>()

  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith('.spec.ts') || entry === path.basename(__filename)) {
      continue
    }
    const source = readFileSync(path.join(directory, entry), 'utf8')
    for (const match of source.matchAll(/SELECT 1 FROM "([A-Za-z]+)"/g)) {
      tables.add(match[1]!)
    }
  }

  return [...tables].sort()
}

describe('integration schema availability', () => {
  const tables = probedTables()

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('5.4-INT-030 scrapes a non-empty probe set out of the sibling suites', () => {
    /*
     * Guards this file's own premise. If the probe form is reworded and the
     * regex stops matching, `tables` empties and the assertion below becomes
     * vacuous while still passing -- the exact silent-green shape this file
     * exists to close. The floor is well under the current count (16 on
     * 2026-08-26) so an ordinary suite deletion does not trip it.
     */
    expect(tables.length, 'no schema probes were found to guard').toBeGreaterThan(10)
    expect(tables).toContain('PaletteProfile')
  })

  it('5.4-INT-031 resolves every probed table when the run claims to be CI', async (context) => {
    if (!isAutomatedRun) {
      /*
       * A developer without a database gets the same treatment the probes give
       * them. The skip is explicit and reported rather than a green tick over
       * an assertion that never ran.
       */
      context.skip()
      return
    }

    const missing: string[] = []
    for (const table of tables) {
      try {
        await prisma.$queryRawUnsafe(`SELECT 1 FROM "${table}" LIMIT 1`)
      } catch {
        missing.push(table)
      }
    }

    expect(
      missing,
      `CI is set, so ${tables.length} integration suites are expected to run against a ` +
        `migrated database. These tables did not resolve at ${databaseUrl.replace(
          /\/\/[^@]*@/,
          '//***@'
        )}, which means those suites SKIPPED and their evidence did not run. ` +
        'Apply the migrations before the test step, or unset CI.'
    ).toEqual([])
  })
})
