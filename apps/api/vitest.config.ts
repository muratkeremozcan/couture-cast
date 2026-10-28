import { availableParallelism } from 'node:os'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * The database `integration/**` probes for, resolved HERE rather than left to each
 * suite's own `process.env` lookup.
 *
 * Those suites skip themselves when their schema probe fails, which is deliberate: a
 * developer with no database still gets the unit tier. What is not deliberate is
 * probing the WRONG database. `packages/db/.env` exists so the Prisma CLI has a
 * `DATABASE_URL`, and importing `@prisma/client` loads it as a side effect, silently
 * overwriting `process.env.DATABASE_URL` inside the worker with whatever database that
 * file names. The suites' `INTEGRATION_TEST_DATABASE_URL ?? DATABASE_URL ?? <local
 * Supabase>` chain then resolves to it, the probe finds no `PremiumEntitlement` table,
 * and sixty-one tests announce themselves skipped for a reason that reads like "no
 * database" when a fully migrated one is running on the machine.
 *
 * The cost is a silent coverage hole, not a red run: measured on 2026-08-18 that
 * skipping put the ratchet at 93.28/87.12/93.62/93.27 against 94/88/95/94, and the
 * failure names coverage rather than the database. `packages/db/vitest.config.ts`
 * carries the same guard for the same reason, and the Maestro runner hit the identical
 * trap; see `_bmad-output/test-artifacts/maestro-suite-repair-handoff.md` and its
 * standing rule: never resolve a test database URL through that variable.
 *
 * CI's integration database is stock postgres:17-alpine. Local Supabase preloads
 * extensions CI does not, among them plpgsql_check, whose pldbgapi2 hooks have aborted
 * an ordinary nested PL/pgSQL call with XX000 "cannot find parent statement on
 * pldbgapi2 call stack". `node scripts/integration-postgres.mjs start` starts the CI
 * database locally and prints its URL for INTEGRATION_TEST_DATABASE_URL.
 *
 * This config is evaluated before any test module, and therefore before that dotenv
 * load can run, so the value below is the one the shell or CI actually chose. Pinning
 * it into `test.env` also makes it win afterwards, because dotenv never overwrites a
 * variable that is already set. A machine with no database still skips, exactly as
 * before, because the probe against the local Supabase default simply fails.
 */
const integrationDatabaseUrl = withPinnedPoolSize(
  process.env.INTEGRATION_TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
)

/**
 * Prisma sizes each client's pool from the machine: `num_cpus * 2 + 1`. CI's 4 vCPU
 * runner gets 9 connections per client across 3 workers. A 14-core laptop gets 29
 * per client across 13 workers, and the full tier then exhausts a 100-connection
 * local Supabase: `remaining connection slots are reserved for roles with the
 * SUPERUSER attribute`, failing whichever DB-backed suites lose the race (measured
 * 2026-10-22: 4 to 7 files red uncapped, all green capped). Pinning CI's pool size
 * makes the tier's connection demand independent of the core count. The isolated
 * database helpers derive their URLs from this one, so they inherit the limit; `pg`
 * ignores the parameter. An explicit `connection_limit` in the caller's URL wins.
 */
function withPinnedPoolSize(url: string): string {
  const parsed = new URL(url)
  if (!parsed.searchParams.has('connection_limit')) {
    parsed.searchParams.set('connection_limit', '9')
  }
  return parsed.toString()
}

export default defineConfig({
  resolve: {
    alias: {
      '@couture/api-client/contracts/http': resolve(
        __dirname,
        '../../packages/api-client/src/contracts/http/index.ts'
      ),
      '@couture/utils': resolve(__dirname, '../../packages/utils/src/index.ts'),
      '@couture/config': resolve(__dirname, '../../packages/config/src/index.ts'),
      '@couture/api-client': resolve(__dirname, '../../packages/api-client/src/index.ts'),
    },
  },
  test: {
    // At most four test files at once, whatever the core count. The DB-backed
    // integration suites assert real wall-clock budgets (a 1 s interactive
    // transaction in community fan-out, the 1950 ms community authorization
    // budget, provider barrier deadlines), and each file also runs child
    // processes, servers and BullMQ workers against the ONE shared Postgres and
    // Redis. Vitest's default of one worker per core put 13 files on a 14-core
    // machine onto that database at once; the measured result on 2026-10-22 was
    // 1 to 15 timing failures per full run (expired transactions, budget
    // overruns, hook timeouts), each green alone. Capped at four: three
    // consecutive full runs green, including one started at load average 23.
    // CI's 4 vCPU runner keeps its three. VITEST_MAX_WORKERS still overrides.
    maxWorkers: Math.max(1, Math.min(4, availableParallelism() - 1)),
    globals: true,
    environment: 'node',
    include: ['src/**/*.{spec,test}.ts', 'integration/**/*.spec.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // This wall-clock proof has its own mandatory CI job and configuration.
      // The measured cold-simulator/native-build replay drove SELECT 1 from
      // sub-3 ms to p95 72.8 ms and exhausted the unchanged authorization budget.
      // Run it on an idle service pair, with one worker and no package builds.
      '**/community-realtime-revalidation.integration.spec.ts',
      ...(process.env.RUN_GARMENT_TAGGING_SMOKE === 'true'
        ? []
        : ['**/garment-tagging.smoke.spec.ts']),
      // Story 6.2, Decision 6: these two load the real ADR-013 NSFW model. A
      // normal unit, coverage or CI run must reach the fixture and unavailable
      // adapters only, so the real model is reachable through its own commands
      // and nothing else. Without these guards a plain `npm run test` would
      // pull a 5.6 MB graph model and a WASM backend into every worker.
      ...(process.env.RUN_COMMUNITY_SCREENING_SMOKE === 'true'
        ? []
        : ['**/community-content-screening.smoke.spec.ts']),
      ...(process.env.RUN_COMMUNITY_SCREENING_READINESS === 'true'
        ? []
        : ['**/community-content-screening.readiness.spec.ts']),
      // The seven-locale text corpus evaluation and the two heaviest corpus
      // development specs run only in pr-checks' community corpus job, which sets
      // RUN_COMMUNITY_TEXT_CORPUS and gates exact test counts. Their per-locale
      // loops screen 400 to 1000 rows each and are pure data checks, so coverage
      // instrumentation measures nothing there while adding a quarter to a half of
      // their CPU time (measured 2026-10-27: round3 60.8 s plain, 75.6 s covered;
      // round5 17.2 s plain, 25.4 s covered). Inside the shared coverage run that
      // pushed single cases to 5.9-23.8 s on the 4 vCPU runner and past their
      // budgets, and the evaluation spec's retired-holdout refusal masked every
      // other failure in the quality gate.
      ...(process.env.RUN_COMMUNITY_TEXT_CORPUS === 'true'
        ? []
        : [
            '**/community-text-corpus.evaluation.spec.ts',
            '**/community-text-round3-development.spec.ts',
            '**/community-text-round5-development.spec.ts',
          ]),
      // Story 6.2b, AC 4: loads the real model and reads licensed photographs
      // that live outside Git, so it runs only through its own release command.
      ...(process.env.RUN_COMMUNITY_SAFE_CORPUS_EVALUATION === 'true'
        ? []
        : ['**/community-safe-corpus.evaluation.spec.ts']),
      // Story 6.5 acceptance harness #3: real wall-clock cache, herd, retention and
      // load timelines that each run for minutes, so they run only through their
      // own recorded command.
      ...(process.env.RUN_STORY65_ACCEPTANCE === 'true'
        ? []
        : ['**/*.acceptance.spec.ts']),
    ],
    setupFiles: [resolve(__dirname, 'src/test-setup.ts')],
    // Both names are pinned so the lookup chain the integration suites share cannot
    // resolve to two different databases depending on which of them a suite reads.
    env: {
      DATABASE_URL: integrationDatabaseUrl,
      INTEGRATION_TEST_DATABASE_URL: integrationDatabaseUrl,
    },
    coverage: {
      reporter: ['text', 'json-summary', 'lcov'],
      // Ratchet: set just under the measured value so a real regression
      // fails the run. Raise these as coverage improves; never lower them
      // to make a red build green.
      thresholds: { statements: 94, branches: 88, functions: 95, lines: 94 },
      include: ['src/**/*.ts'],
      exclude: [
        // Process entrypoints. These construct and boot the Nest application
        // and the BullMQ worker processes; the Playwright and k6 suites start
        // them for real, which is the only level that proves they work.
        'src/main.ts',
        'src/workers/bootstrap.ts',
        'src/workers/wardrobe.bootstrap.ts',
        'src/workers/community.bootstrap.ts',
        // NestJS DI metadata only — decorator arrays with no branches. Every
        // Test.createTestingModule spec resolves these providers already.
        'src/**/*.module.ts',
        // In-repo test scaffolding, not product code.
        'src/testing/**',
        'src/test-setup.ts',
      ],
    },
  },
})
