import { defineConfig } from 'vitest/config'

/**
 * The one database every suite in this workspace talks to, resolved HERE rather
 * than left to each spec's own `process.env` lookup.
 *
 * `packages/db/.env` exists so the Prisma CLI has a `DATABASE_URL`, and importing
 * `@prisma/client` loads that file as a side effect, overwriting
 * `process.env.DATABASE_URL` inside the worker with whatever database it names.
 * `fileParallelism` is false, so all thirteen suites share one process: the first
 * spec to import the Prisma client redirected every later spec's
 * `RLS_TEST_DATABASE_URL ?? DATABASE_URL ?? <local Supabase>` chain at the
 * developer's own database. That made the workspace gate order-dependent (it fails
 * with "table public.PremiumEntitlement does not exist" on a machine whose
 * `packages/db/.env` predates story 5.2) and, worse, pointed `commerce-seed.spec.ts`'s
 * catalog `deleteMany`/`delete` at a database these tests were never meant to write
 * to. The Maestro runner hit the identical trap; see
 * `_bmad-output/test-artifacts/maestro-suite-repair-handoff.md` and its standing rule:
 * never resolve a test database URL through that variable.
 *
 * This config is evaluated before any test module, and therefore before that dotenv
 * load can run, so the value below is the one the shell or CI actually chose. Pinning
 * it into `test.env` also makes it win afterwards, because dotenv never overwrites a
 * variable that is already set. CI keeps working unchanged: its workflow-level
 * `DATABASE_URL` is what this reads.
 */
const testDatabaseUrl =
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['test/**/*.spec.ts'],
    // Both names are pinned so the lookup chain the specs share cannot resolve to
    // two different databases depending on which of them a given spec reads first.
    env: {
      DATABASE_URL: testDatabaseUrl,
      RLS_TEST_DATABASE_URL: testDatabaseUrl,
    },
    coverage: {
      reporter: ['text', 'json-summary', 'lcov'],
      // Story 5.1 Task 1 added this block so
      // `scripts/run-workspace-test-coverage.mjs` picks this workspace up at
      // all: before it, `packages/db/test/**` had no `test:coverage` script and
      // therefore never ran on a pull request, despite holding the RLS actor
      // matrix and every schema constraint assertion.
      //
      // Scope is deliberately just the seeds. The rest of this workspace is
      // Prisma schema and hand-authored SQL, which the suites exercise through a
      // live PostgreSQL connection rather than by importing TypeScript, so there
      // is no source file for a coverage tool to instrument.
      //
      // Ratchet: set just under the measured value so a real regression fails
      // the run. Never lower these to make a red build green.
      //
      // The absolute numbers look alarming and are explained by which files are
      // in scope, not by missing tests. `commerce.ts` is at 100%. Every other
      // seed module is at 0% because nothing imports it: they run only through
      // `prisma db seed`, as a subprocess, during `db:reset` and end-to-end
      // setup, which no coverage instrument observes. Raising the global number
      // means unit-testing those older seeds, which is real work this story does
      // not own.
      thresholds: { statements: 13, branches: 10, functions: 9, lines: 14 },
      include: ['prisma/seeds/**/*.ts'],
      // index.ts runs `main()` on import, so instrumenting it would execute the
      // whole seed against whatever database the coverage run happens to see.
      exclude: ['prisma/seeds/index.ts'],
    },
  },
})
