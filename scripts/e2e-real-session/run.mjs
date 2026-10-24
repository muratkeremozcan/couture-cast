#!/usr/bin/env node
/**
 * Runs the Story 6.5 real-session Playwright specs against a stack this run owns.
 *
 *   npm run test:pw-real-session [-- --skip-web-build] [-- <playwright args>]
 *
 * In order:
 * 1. Resolves the local Supabase URL and keys (from the environment, else from
 *    `supabase status`), refuses anything that is not on this machine, checks the
 *    Storage buckets the seed needs exist (`scripts/local-storage-buckets.mjs`),
 *    deletes the Auth users a killed earlier run left recorded, and picks the OTP
 *    mode.
 * 2. Creates `tea_community_<32 hex>` on the local Supabase Postgres with the same
 *    auth bootstrap as `apps/api/integration/helpers/isolated-community-database.ts`.
 * 3. Starts the OTP Auth proxy (`auth-proxy.mjs`) on 53051.
 * 4. Builds the web with NEXT_PUBLIC_E2E_AUTH=false and the proxy as its Supabase
 *    URL into `apps/web/.next-real-session`.
 * 5. Starts `scripts/start-api-e2e-with-workers.mjs` against that database with the
 *    caller's Redis on API port 4077: it runs `prisma migrate deploy`, the seed, the
 *    API build, the weather double, the API and both workers. Then serves the web
 *    build on 127.0.0.1:3077.
 * 6. Runs the two specs through `playwright/config/real-session.config.ts`, holds
 *    their output until the run's keys, OTP codes and JWTs are redacted from it,
 *    then prints it. The run passes only when Playwright exits 0 AND its JUnit
 *    report shows every expected test ran, none skipped (`junitOutcome`).
 * 7. Always (`lifecycle.mjs`): stops every process group it started and waits for
 *    them and their workers to exit, waits for the startup sequence to settle,
 *    then closes the proxy, collects the issued OTP codes, deletes the Auth users
 *    the run created, drops the database and publishes the redacted artifacts
 *    (`artifacts.mjs`). A failed code collection withholds the artifacts.
 *
 * Every process is started through `process-owner.mjs`, each as the leader of its
 * own process group, and every await in the startup sequence is followed by
 * `owner.assertRunning()`, so once teardown begins nothing new starts.
 *
 * Everything the run keeps lives in STORY65_REAL_SESSION_DIR (default
 * `.real-session-e2e/`). Only `artifacts/` inside it is meant for upload, and only
 * while `artifacts-complete.json` vouches for it (`artifacts.mjs verify`).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseEnvFile } from 'dotenv'
import pg from 'pg'
import { LOCAL_E2E_DATABASE_URL, ROOT_ENV_FILES } from '../local-e2e-database.mjs'
import {
  assertBucketsPresent,
  bucketDefinitionsFromMigrations,
  listWhenReady,
  localStorageApi,
} from '../local-storage-buckets.mjs'
import { RAW_DIR, finalizeArtifacts, resetArtifacts } from './artifacts.mjs'
import { startAuthProxy } from './auth-proxy.mjs'
import { deleteRecordedUsers, localAuthUsers } from './cleanup-users.mjs'
import {
  API_BASE_URL,
  API_PORT,
  AUTH_PROXY_PORT,
  EXPECTED_REAL_SESSION_TESTS,
  ISOLATED_DATABASE_NAME,
  MAILPIT_URL,
  RUN_STATE_FILES,
  WEATHER_DOUBLE_PORT,
  WEB_BASE_URL,
  WEB_DIST_DIR,
  WEB_PORT,
  envKeysToBlank,
  extractMailCode,
  isLoopbackHost,
  isolatedDatabaseName,
  isolatedDatabaseUrl,
  junitOutcome,
  redactSecrets,
  resolveHarnessDir,
  resolveOtpMode,
} from './harness.mjs'
import { IDENTITIES_FILE, readIdentities } from './identities.mjs'
import { startRunLifecycle } from './lifecycle.mjs'
import { createProcessOwner } from './process-owner.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const webRoot = path.join(repoRoot, 'apps/web')
const nextBin = path.join(repoRoot, 'node_modules/next/dist/bin/next')
const playwrightCli = path.join(repoRoot, 'node_modules/@playwright/test/cli.js')
const launcher = path.join(repoRoot, 'scripts/start-api-e2e-with-workers.mjs')
const ownedConfig = path.join(repoRoot, 'playwright/config/real-session.config.ts')

const cliArgs = process.argv.slice(2)
const skipWebBuild = cliArgs.includes('--skip-web-build')
const playwrightArgs = cliArgs.filter((arg) => arg !== '--skip-web-build')

const log = (message) => console.log(`[real-session] ${message}`)

// Same contract and client default grants as pr-checks.yml and
// apps/api/integration/helpers/isolated-community-database.ts. Eight RLS policies
// call auth.jwt(), which only the Supabase `postgres` database defines, so a new
// database needs it before `prisma migrate deploy` can apply them. Roles are
// cluster-scoped and already exist in the local Supabase Postgres.
const AUTH_BOOTSTRAP_SQL = `
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $fn$
    SELECT coalesce(
      nullif(current_setting('request.jwt.claim', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
  $fn$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
`

/** The URL and keys of the local Supabase; CI's start-local-supabase exports them. */
function resolveSupabase(env) {
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
  const resolved = Object.fromEntries(keys.map((key) => [key, env[key]?.trim() ?? '']))
  if (keys.some((key) => !resolved[key])) {
    let status
    try {
      status = JSON.parse(
        execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        })
      )
    } catch {
      throw new Error(
        'Local Supabase is not running. Start it with `npm run supabase:start` (Mailpit included) or export SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.'
      )
    }
    resolved.SUPABASE_URL ||= status.API_URL ?? ''
    resolved.SUPABASE_ANON_KEY ||= status.ANON_KEY ?? ''
    resolved.SUPABASE_SERVICE_ROLE_KEY ||= status.SERVICE_ROLE_KEY ?? ''
  }
  if (keys.some((key) => !resolved[key]))
    throw new Error('The local Supabase URL or keys could not be resolved.')
  if (!isLoopbackHost(new URL(resolved.SUPABASE_URL).hostname))
    throw new Error(
      'SUPABASE_URL must point at the local Supabase. Unset the remote value in this shell.'
    )
  return resolved
}

function resolveRedisUrl(env) {
  const value = env.REDIS_URL?.trim()
  if (!value)
    throw new Error(
      'Set REDIS_URL to a Redis this run owns, for example `docker run -d --rm --name real-session-redis -p 127.0.0.1:6390:6379 redis:7-alpine` and REDIS_URL=redis://127.0.0.1:6390. Sharing the development Redis would let another stack consume the queues of this run.'
    )
  if (!isLoopbackHost(new URL(value).hostname))
    throw new Error('REDIS_URL must point at a Redis on this machine.')
  return value
}

async function mailpitReachable() {
  try {
    const response = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=1`, {
      signal: AbortSignal.timeout(3_000),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Every sign-in code Mailpit holds for the given addresses, for redaction and the
 * artifact scan. Throws on any Mailpit error when there are addresses to read:
 * a code that could not be collected could not be redacted, so the caller must
 * withhold the artifacts rather than publish them unchecked.
 *
 * @param {readonly string[]} emails
 */
async function mailpitCodes(emails) {
  if (emails.length === 0) return []
  const wanted = new Set(emails.map((email) => email.toLowerCase()))
  const read = async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`Mailpit answered ${response.status}`)
    return response.json()
  }
  const codes = []
  const pageSize = 500
  for (let start = 0; ; start += pageSize) {
    const page = await read(
      `${MAILPIT_URL}/api/v1/messages?start=${start}&limit=${pageSize}`
    )
    const messages = page.messages ?? []
    for (const message of messages) {
      if (!message.To?.some((to) => wanted.has(String(to.Address).toLowerCase())))
        continue
      const content = await read(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
      const code = extractMailCode(`${content.Text ?? ''}\n${content.HTML ?? ''}`)
      if (code) codes.push(code)
    }
    if (messages.length < pageSize) return codes
  }
}

/**
 * Reserves the database's name before creating it, so a teardown that starts
 * while CREATE DATABASE is in flight still knows what to drop.
 *
 * @param {string} sourceUrl
 * @param {(database: { name: string; url: string }) => void} reserve
 */
async function createIsolatedDatabase(sourceUrl, reserve) {
  const name = isolatedDatabaseName()
  const url = isolatedDatabaseUrl(sourceUrl, name)
  reserve({ name, url })
  const admin = new pg.Client({ connectionString: sourceUrl })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`)
  } finally {
    await admin.end()
  }
  const isolated = new pg.Client({ connectionString: url })
  await isolated.connect()
  try {
    await isolated.query(AUTH_BOOTSTRAP_SQL)
  } finally {
    await isolated.end()
  }
  return { name, url }
}

async function dropIsolatedDatabase(sourceUrl, name) {
  // Only the UUID-named database this run created can be dropped.
  if (!ISOLATED_DATABASE_NAME.test(name)) throw new Error('Refusing to drop ' + name)
  const admin = new pg.Client({ connectionString: sourceUrl })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  } finally {
    await admin.end()
  }
}

/** Keys the repo-level env files define, so the web build can be denied them. */
function rootEnvFileKeys() {
  return ROOT_ENV_FILES.flatMap((file) => {
    const full = path.join(repoRoot, file)
    return fs.existsSync(full) ? Object.keys(parseEnvFile(fs.readFileSync(full))) : []
  })
}

/**
 * Polls `url` until it answers 200, the process behind it exits, the deadline
 * passes, or teardown begins (`assertRunning` throws).
 */
async function waitForHealthy(url, handle, timeoutMs, readLog, assertRunning) {
  const deadline = Date.now() + timeoutMs
  let early
  void handle.exited.then((result) => (early = result))
  while (Date.now() < deadline) {
    assertRunning()
    if (early)
      throw new Error(
        `${handle.name} exited (${early.code ?? early.signal}) before ${url} answered.\n${readLog()}`
      )
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(5_000) })).ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(
    `Timed out after ${timeoutMs / 1000}s waiting for ${url}.\n${readLog()}`
  )
}

function tail(file, lines = 60) {
  if (!fs.existsSync(file)) return ''
  return fs.readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n')
}

function summarize(lines) {
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (!summary) return
  try {
    fs.appendFileSync(summary, `${lines.join('\n')}\n`)
  } catch {
    // The summary is a convenience; the log line above already carries it.
  }
}

/**
 * The real-email addresses the specs recorded, for reading their codes back. An
 * unreadable file throws: the codes behind it could not be collected.
 */
function recordedRealEmailAddresses(directory) {
  return readIdentities(directory)
    .filter((row) => row.issueMode === 'real-email' && typeof row.email === 'string')
    .map((row) => /** @type {string} */ (row.email))
}

async function main() {
  const directory = resolveHarnessDir(process.env, repoRoot)
  const raw = path.join(directory, RAW_DIR)
  const logDir = path.join(directory, 'logs')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })

  const supabase = resolveSupabase(process.env)
  const redisUrl = resolveRedisUrl(process.env)
  const sourceDatabaseUrl =
    process.env.LOCAL_DATABASE_URL?.trim() || LOCAL_E2E_DATABASE_URL
  const auth = localAuthUsers({ ...process.env, ...supabase })

  // The seed uploads into these; without them it fails minutes in, after the
  // migrations, with a Storage 404. Checked before anything is created.
  assertBucketsPresent(
    bucketDefinitionsFromMigrations(),
    await listWhenReady(
      localStorageApi({
        supabaseUrl: supabase.SUPABASE_URL,
        serviceRoleKey: supabase.SUPABASE_SERVICE_ROLE_KEY,
      }),
      { timeoutMs: 10_000, intervalMs: 1_000 }
    )
  )

  // A killed run never reached its own cleanup; its recorded users go first.
  const leftover = await deleteRecordedUsers({ directory, ...auth })
  if (leftover.recorded > 0)
    log(`Deleted ${leftover.deleted} Auth user(s) an earlier run left recorded.`)
  if (leftover.failed.length > 0)
    throw new Error('Auth users from an earlier run could not be deleted.')
  for (const file of [...RUN_STATE_FILES, IDENTITIES_FILE])
    fs.rmSync(path.join(directory, file), { force: true })
  // The record goes first, so nothing from an earlier run can verify for this one.
  resetArtifacts(directory)
  fs.rmSync(logDir, { recursive: true, force: true })
  fs.mkdirSync(logDir, { recursive: true, mode: 0o700 })

  const otpMode = resolveOtpMode(
    process.env.STORY65_REAL_SESSION_OTP_MODE,
    await mailpitReachable()
  )
  log(
    otpMode === 'real-email'
      ? `OTP issuance mode: real-email (the first sign-in code is read from Mailpit at ${MAILPIT_URL})`
      : 'OTP issuance mode: generated (the Auth Admin API mints every code; Mailpit is not used)'
  )

  // Five seconds each: GitHub kills a cancelled step about ten seconds after its
  // first signal, and the API stack's own shutdown allows its children five.
  const owner = createProcessOwner({ graceMs: 5_000, killWaitMs: 5_000 })
  const state = {
    /** @type {Awaited<ReturnType<typeof startAuthProxy>> | undefined} */
    proxy: undefined,
    /** @type {{ name: string; url: string } | undefined} */
    database: undefined,
    /** Playwright's stdout and stderr, printed only once it is redacted. */
    output: /** @type {Buffer[]} */ ([]),
    /** The codes to redact the output with; undefined when collection failed. */
    otpCodes: /** @type {string[] | undefined} */ (undefined),
    /** Every value the run's output must not carry, settled before cleanup. */
    secrets: [
      supabase.SUPABASE_ANON_KEY,
      supabase.SUPABASE_SERVICE_ROLE_KEY,
      process.env.GUARDIAN_INVITE_JWT_SECRET,
    ],
  }
  const readLog = (name) => () =>
    redactSecrets(tail(path.join(logDir, `${name}.log`)), state.secrets)

  /** The startup sequence and the specs; returns the run's exit code. */
  const run = async () => {
    await createIsolatedDatabase(sourceDatabaseUrl, (database) => {
      state.database = database
    })
    owner.assertRunning()
    log(`Created isolated database ${state.database?.name}.`)

    state.proxy = await startAuthProxy({
      directory,
      supabaseUrl: supabase.SUPABASE_URL,
      serviceRoleKey: supabase.SUPABASE_SERVICE_ROLE_KEY,
      webOrigin: WEB_BASE_URL,
      port: AUTH_PROXY_PORT,
    })
    owner.assertRunning()
    log(`Auth proxy listening at ${state.proxy.proxyUrl}.`)
    const database = /** @type {{ name: string; url: string }} */ (state.database)

    // Read by playwright/config/real-session.config.ts after the local config has
    // loaded .env.local. Locations only: the keys stay in the process environment.
    const owned = {
      TEST_ENV: 'local',
      DATABASE_URL: database.url,
      REDIS_URL: redisUrl,
      SUPABASE_URL: supabase.SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_URL: state.proxy.proxyUrl,
      API_BASE_URL,
      WEB_E2E_BASE_URL: WEB_BASE_URL,
      STORY65_REAL_SESSION_DIR: directory,
      STORY65_REAL_SESSION_OTP_MODE: otpMode,
      // A skip reason now throws: six skipped specs would exit 0.
      STORY65_REAL_SESSION_REQUIRED: 'true',
      PLAYWRIGHT_SKIP_DB_RESET: 'true',
    }
    fs.writeFileSync(
      path.join(directory, 'owned-env.json'),
      `${JSON.stringify(owned, null, 2)}\n`,
      { mode: 0o600 }
    )
    fs.writeFileSync(
      path.join(directory, 'resources.json'),
      `${JSON.stringify(
        {
          database: database.name,
          otpMode,
          apiBaseUrl: API_BASE_URL,
          webBaseUrl: WEB_BASE_URL,
          authProxyUrl: state.proxy.proxyUrl,
          startedAt: new Date().toISOString(),
        },
        null,
        2
      )}\n`
    )

    // NEXT_PUBLIC_* values are inlined at build time, so this env is the web
    // bundle's whole view of the world. It starts from nothing, and every key a
    // repo-level env file defines that is not listed here is set to '' so
    // apps/web/next.config.ts cannot load it.
    const webProvided = {
      NODE_ENV: 'production',
      TEST_ENV: 'local',
      WEB_NEXT_DIST_DIR: WEB_DIST_DIR,
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_E2E_AUTH: 'false',
      NEXT_PUBLIC_SUPABASE_URL: state.proxy.proxyUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.SUPABASE_ANON_KEY,
      NEXT_PUBLIC_REALTIME_URL: API_BASE_URL,
      NEXT_PUBLIC_API_BASE_URL: '',
      API_BASE_URL,
      PROD_API_BASE_URL: '',
      VERCEL_API_BASE_URL: '',
      VERCEL_API_BRANCH_URL: '',
      PREVIEW_API_BASE_URL: '',
      POSTHOG_API_KEY: '',
      COMMUNITY_FLAG_FIXTURE_MODE: 'true',
    }
    const webEnv = {
      ...Object.fromEntries(
        ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'CI']
          .filter((key) => process.env[key])
          .map((key) => [key, process.env[key]])
      ),
      ...Object.fromEntries(
        envKeysToBlank(rootEnvFileKeys(), webProvided).map((key) => [key, ''])
      ),
      ...webProvided,
    }
    // Before the API stack starts: its seed and API build rebuild the shared
    // package outputs the web build reads.
    if (skipWebBuild) {
      log(`--skip-web-build: serving the existing apps/web/${WEB_DIST_DIR} build.`)
    } else {
      log(
        `Building the web with NEXT_PUBLIC_E2E_AUTH=false into apps/web/${WEB_DIST_DIR}...`
      )
      const buildLog = path.join(logDir, 'web-build.log')
      const build = owner.spawn('web-build', 'node', [nextBin, 'build'], {
        cwd: webRoot,
        env: webEnv,
        logFile: buildLog,
      })
      const status = await build.exited
      owner.assertRunning()
      if (status.code !== 0)
        throw new Error(
          `The web build failed (${status.code ?? status.signal}).\n${tail(buildLog)}`
        )
    }

    const stackOverrides = {
      TEST_ENV: 'local',
      DATABASE_URL: database.url,
      REDIS_URL: redisUrl,
      REDIS_TLS: 'false',
      ...supabase,
      PORT: String(API_PORT),
      // apps/api/src/main.ts binds this host; without it the API listens on
      // every interface.
      API_LISTEN_HOST: '127.0.0.1',
      API_BASE_URL,
      PUBLIC_API_URL: API_BASE_URL,
      WEB_E2E_BASE_URL: WEB_BASE_URL,
      HTTP_CORS_ORIGIN: WEB_BASE_URL,
      E2E_WEATHER_DOUBLE_PORT: String(WEATHER_DOUBLE_PORT),
      COMMUNITY_SCREENING_EVIDENCE_MODE: 'fixture',
      PLAYWRIGHT_SKIP_DB_RESET: 'true',
    }
    const stackEnv = {
      ...process.env,
      ...stackOverrides,
      // The launcher keeps these through its .env.local override and hands the
      // list on to the API and workers (scripts/lib/caller-owned-env.mjs).
      E2E_CALLER_OWNED_ENV_KEYS: Object.keys(stackOverrides).join(','),
      POSTHOG_API_KEY: '',
      SENTRY_DSN: '',
      OTEL_EXPORTER_OTLP_ENDPOINT: '',
    }
    delete stackEnv.COMMUNITY_NSFW_SCREENER
    delete stackEnv.SKIP_E2E_SEED
    log('Starting the API stack (migrate deploy, seed, API build, workers)...')
    const stack = owner.spawn('api-stack', 'node', [launcher], {
      cwd: repoRoot,
      env: stackEnv,
      logFile: path.join(logDir, 'api-stack.log'),
    })
    await waitForHealthy(
      `${API_BASE_URL}/api/health`,
      stack,
      15 * 60_000,
      readLog('api-stack'),
      owner.assertRunning
    )
    owner.assertRunning()
    log(`API ready at ${API_BASE_URL}.`)

    const web = owner.spawn(
      'web',
      'node',
      [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(WEB_PORT)],
      { cwd: webRoot, env: webEnv, logFile: path.join(logDir, 'web.log') }
    )
    await waitForHealthy(
      `${WEB_BASE_URL}/api/health`,
      web,
      2 * 60_000,
      readLog('web'),
      owner.assertRunning
    )
    owner.assertRunning()
    log(`Web ready at ${WEB_BASE_URL}.`)

    const playwrightEnv = {
      ...process.env,
      ...supabase,
      ...owned,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.SUPABASE_ANON_KEY,
      // playwright-utils logs request and response bodies, bearers included.
      DISABLE_FILE_LOGS: 'true',
      DISABLE_CONSOLE_LOGS: 'true',
    }
    log('Running the real-session specs; output is printed once it is redacted...')
    const playwright = owner.spawn(
      'playwright',
      'node',
      [playwrightCli, 'test', '--config', ownedConfig, ...playwrightArgs],
      { cwd: repoRoot, env: playwrightEnv }
    )
    playwright.child.stdout?.on('data', (chunk) => state.output.push(chunk))
    playwright.child.stderr?.on('data', (chunk) => state.output.push(chunk))
    const result = await playwright.exited
    owner.assertRunning()
    if (result.code !== 0) return 1

    // Playwright exits 0 when every test skipped; the report says whether they ran.
    const junit = path.join(raw, 'junit.xml')
    const outcome = junitOutcome(
      fs.existsSync(junit) ? fs.readFileSync(junit, 'utf8') : '',
      // Playwright arguments may filter the specs; the full run must hold all six.
      playwrightArgs.length === 0 ? EXPECTED_REAL_SESSION_TESTS : undefined
    )
    if (!outcome.ok) {
      log(`Playwright exited 0, but ${outcome.reason}; failing the run.`)
      return 1
    }
    log(`JUnit: ${outcome.tests} test(s) passed, none skipped.`)
    return 0
  }

  /** Everything the run holds besides processes, freed once they have all exited. */
  const release = async () => {
    let code = 0
    try {
      await state.proxy?.close()
    } catch (error) {
      log(`Closing the Auth proxy failed: ${error.message}`)
      code = 1
    }
    // Codes before cleanup: cleanup empties the identities file the Mailpit
    // lookup reads.
    try {
      state.otpCodes = [
        ...(state.proxy?.issuedCodes() ?? []),
        ...(await mailpitCodes(recordedRealEmailAddresses(directory))),
      ]
    } catch (error) {
      log(
        `Collecting the issued OTP codes failed (${error.message}); the artifacts and the Playwright output are withheld.`
      )
      code = 1
    }
    try {
      const cleanup = await deleteRecordedUsers({ directory, ...auth })
      log(`Auth user cleanup: ${JSON.stringify(cleanup)}`)
      if (cleanup.failed.length > 0) code = 1
    } catch (error) {
      log(`Auth user cleanup failed: ${error.message}`)
      code = 1
    }
    if (state.database) {
      try {
        await dropIsolatedDatabase(sourceDatabaseUrl, state.database.name)
        log(`Dropped ${state.database.name}.`)
      } catch (error) {
        log(`Dropping ${state.database.name} failed: ${error.message}`)
        code = 1
      }
    }
    if (state.otpCodes) {
      try {
        const published = finalizeArtifacts({
          directory,
          sources: [
            { to: 'junit.xml', from: path.join(raw, 'junit.xml') },
            { to: 'test-results', from: path.join(raw, 'test-results') },
            { to: 'logs', from: logDir },
            // The proofs and observations; owned-env.json and auth-harness.json
            // are local plumbing.
            ...RUN_STATE_FILES.filter(
              (file) => !['auth-harness.json', 'owned-env.json'].includes(file)
            ).map((file) => ({ to: file, from: path.join(directory, file) })),
          ],
          texts: [
            {
              to: 'playwright-output.log',
              content: Buffer.concat(state.output).toString('utf8'),
            },
          ],
          secrets: state.secrets,
          otpCodes: state.otpCodes,
        })
        log(`Published ${published.files} redacted artifact file(s).`)
      } catch (error) {
        log(`Publishing the artifacts failed: ${error.message}`)
        code = 1
      }
    }
    return code
  }

  const lifecycle = startRunLifecycle({
    owner,
    run,
    release,
    log,
    reportError: (error) =>
      console.error(
        `[real-session] ${redactSecrets(String(error instanceof Error ? error.message : error), state.secrets)}`
      ),
  })
  // `on`, so a second signal (GitHub sends SIGINT, then SIGTERM) cannot kill this
  // process mid-teardown and orphan the process groups it owns.
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      log(`${signal} received; stopping every process, then cleaning up.`)
      void lifecycle.teardown('signal')
    })

  const exitCode = await lifecycle.done
  if (state.otpCodes) {
    process.stdout.write(
      redactSecrets(Buffer.concat(state.output).toString('utf8'), [
        ...state.secrets,
        ...state.otpCodes,
      ])
    )
  }
  log(`Finished with exit code ${exitCode} (OTP mode ${otpMode}).`)
  summarize([
    '### Real-session community E2E',
    '',
    `- OTP issuance mode: \`${otpMode}\``,
    `- Result: ${exitCode === 0 ? 'passed' : `failed (exit ${exitCode})`}`,
  ])
  return exitCode
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`[real-session] ${error.message}`)
    process.exit(1)
  }
)
