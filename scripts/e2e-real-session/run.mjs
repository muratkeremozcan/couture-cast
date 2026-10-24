#!/usr/bin/env node
/**
 * Runs the Story 6.5 real-session Playwright specs against a stack this run owns.
 *
 *   npm run test:pw-real-session [-- --skip-web-build] [-- <playwright args>]
 *
 * In order:
 * 1. Resolves the local Supabase URL and keys (from the environment, else from
 *    `supabase status`), refuses anything that is not on this machine, deletes
 *    the Auth users a killed earlier run left recorded, and picks the OTP mode.
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
 *    then prints it.
 * 7. Always: deletes the Auth users the run created, stops every process, redacts
 *    the artifacts and drops the database.
 *
 * Everything the run keeps lives in STORY65_REAL_SESSION_DIR (default
 * `.real-session-e2e/`). Only `artifacts/` inside it is meant for upload.
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseEnvFile } from 'dotenv'
import pg from 'pg'
import { LOCAL_E2E_DATABASE_URL, ROOT_ENV_FILES } from '../local-e2e-database.mjs'
import { startAuthProxy } from './auth-proxy.mjs'
import { deleteRecordedUsers, localAuthUserDeleter } from './cleanup-users.mjs'
import {
  API_BASE_URL,
  API_PORT,
  AUTH_PROXY_PORT,
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
  redactSecrets,
  resolveHarnessDir,
  resolveOtpMode,
} from './harness.mjs'

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

/** Every sign-in code Mailpit holds for the given addresses, for redaction only. */
async function mailpitCodes(emails) {
  if (emails.length === 0) return []
  try {
    const response = await fetch(`${MAILPIT_URL}/api/v1/messages`)
    if (!response.ok) return []
    const { messages } = await response.json()
    const wanted = new Set(emails.map((email) => email.toLowerCase()))
    const codes = []
    for (const message of messages ?? []) {
      if (!message.To?.some((to) => wanted.has(String(to.Address).toLowerCase())))
        continue
      const body = await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
      if (!body.ok) continue
      const content = await body.json()
      const code = extractMailCode(`${content.Text ?? ''}\n${content.HTML ?? ''}`)
      if (code) codes.push(code)
    }
    return codes
  } catch {
    return []
  }
}

async function createIsolatedDatabase(sourceUrl) {
  const name = isolatedDatabaseName()
  const url = isolatedDatabaseUrl(sourceUrl, name)
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

function startProcess(name, command, args, { cwd, env, logDir }) {
  const out = fs.openSync(path.join(logDir, `${name}.log`), 'w', 0o600)
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', out, out] })
  fs.closeSync(out)
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
    child.once('error', () => resolve({ code: 1, signal: null }))
  })
  return { name, child, exited }
}

async function stopProcess(handle) {
  if (!handle || handle.child.exitCode !== null || handle.child.signalCode !== null)
    return
  handle.child.kill('SIGTERM')
  const stopped = await Promise.race([
    handle.exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 20_000)),
  ])
  if (!stopped) {
    handle.child.kill('SIGKILL')
    await handle.exited
  }
}

async function waitForHealthy(url, handle, timeoutMs, readLog) {
  const deadline = Date.now() + timeoutMs
  let early
  void handle.exited.then((result) => (early = result))
  while (Date.now() < deadline) {
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

function runToCompletion(command, args, { cwd, env, logFile }) {
  return new Promise((resolve) => {
    const out = fs.openSync(logFile, 'w', 0o600)
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', out, out] })
    fs.closeSync(out)
    child.once('exit', (code) => resolve(code ?? 1))
    child.once('error', () => resolve(1))
  })
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    return entry.isDirectory() ? walkFiles(full) : [full]
  })
}

/** Rewrites every text file under `directory` with the secrets redacted. */
function redactTree(directory, secrets) {
  for (const file of walkFiles(directory)) {
    const bytes = fs.readFileSync(file)
    if (bytes.includes(0)) {
      // Binary output (a screenshot, a trace) cannot be redacted, so it is not kept.
      fs.rmSync(file)
      continue
    }
    fs.writeFileSync(file, redactSecrets(bytes.toString('utf8'), secrets))
  }
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

/** The real-email addresses the specs recorded, for reading their codes back. */
function recordedRealEmailAddresses(directory) {
  const file = path.join(directory, 'created-identities.json')
  if (!fs.existsSync(file)) return []
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
      .filter((row) => row.issueMode === 'real-email')
      .map((row) => row.email)
  } catch {
    return []
  }
}

async function main() {
  const directory = resolveHarnessDir(process.env, repoRoot)
  const artifacts = path.join(directory, 'artifacts')
  const logDir = path.join(directory, 'logs')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })

  const supabase = resolveSupabase(process.env)
  const redisUrl = resolveRedisUrl(process.env)
  const sourceDatabaseUrl =
    process.env.LOCAL_DATABASE_URL?.trim() || LOCAL_E2E_DATABASE_URL
  const deleteUser = localAuthUserDeleter({ ...process.env, ...supabase })

  // A killed run never reached its own cleanup; its recorded users go first.
  const leftover = await deleteRecordedUsers({ directory, deleteUser })
  if (leftover.recorded > 0)
    log(`Deleted ${leftover.deleted} Auth user(s) an earlier run left recorded.`)
  if (leftover.failed.length > 0)
    throw new Error('Auth users from an earlier run could not be deleted.')
  for (const file of [...RUN_STATE_FILES, 'created-identities.json'])
    fs.rmSync(path.join(directory, file), { force: true })
  for (const folder of [artifacts, logDir])
    fs.rmSync(folder, { recursive: true, force: true })
  fs.mkdirSync(artifacts, { recursive: true })
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

  const state = {
    proxy: undefined,
    stack: undefined,
    web: undefined,
    database: undefined,
    /** Every value the run's output must not carry, settled before cleanup. */
    secrets: [
      supabase.SUPABASE_ANON_KEY,
      supabase.SUPABASE_SERVICE_ROLE_KEY,
      process.env.GUARDIAN_INVITE_JWT_SECRET,
    ],
  }
  let exitCode = 1
  /** @type {Promise<void> | undefined} */
  let tearingDown
  // One teardown per run, whether the specs finish, a step throws or a signal arrives.
  const teardown = () => (tearingDown ??= tearDown())
  const tearDown = async () => {
    // Codes first: cleanup empties the identities file the Mailpit lookup reads.
    state.secrets.push(
      ...(state.proxy?.issuedCodes() ?? []),
      ...(await mailpitCodes(recordedRealEmailAddresses(directory)))
    )
    try {
      const cleanup = await deleteRecordedUsers({ directory, deleteUser })
      log(`Auth user cleanup: ${JSON.stringify(cleanup)}`)
      if (cleanup.failed.length > 0) exitCode = 1
    } catch (error) {
      log(`Auth user cleanup failed: ${error.message}`)
      exitCode = 1
    }
    await stopProcess(state.web)
    await stopProcess(state.stack)
    await state.proxy?.close()
    if (state.database) {
      try {
        await dropIsolatedDatabase(sourceDatabaseUrl, state.database.name)
        log(`Dropped ${state.database.name}.`)
      } catch (error) {
        log(`Dropping ${state.database.name} failed: ${error.message}`)
        exitCode = 1
      }
    }
    fs.mkdirSync(path.join(artifacts, 'logs'), { recursive: true })
    for (const file of walkFiles(logDir))
      fs.copyFileSync(file, path.join(artifacts, 'logs', path.basename(file)))
    // The proofs and observations; owned-env.json and auth-harness.json are
    // local plumbing.
    for (const file of RUN_STATE_FILES) {
      if (['auth-harness.json', 'owned-env.json'].includes(file)) continue
      const source = path.join(directory, file)
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(artifacts, file))
    }
    redactTree(artifacts, state.secrets)
  }
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      log(`${signal} received; cleaning up.`)
      void teardown().finally(() => process.exit(1))
    })

  try {
    state.database = await createIsolatedDatabase(sourceDatabaseUrl)
    log(`Created isolated database ${state.database.name}.`)

    state.proxy = await startAuthProxy({
      directory,
      supabaseUrl: supabase.SUPABASE_URL,
      serviceRoleKey: supabase.SUPABASE_SERVICE_ROLE_KEY,
      webOrigin: WEB_BASE_URL,
      port: AUTH_PROXY_PORT,
    })
    log(`Auth proxy listening at ${state.proxy.proxyUrl}.`)

    // Read by playwright/config/real-session.config.ts after the local config has
    // loaded .env.local. Locations only: the keys stay in the process environment.
    const owned = {
      TEST_ENV: 'local',
      DATABASE_URL: state.database.url,
      REDIS_URL: redisUrl,
      SUPABASE_URL: supabase.SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_URL: state.proxy.proxyUrl,
      API_BASE_URL,
      WEB_E2E_BASE_URL: WEB_BASE_URL,
      STORY65_REAL_SESSION_DIR: directory,
      STORY65_REAL_SESSION_OTP_MODE: otpMode,
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
          database: state.database.name,
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
      const status = await runToCompletion('node', [nextBin, 'build'], {
        cwd: webRoot,
        env: webEnv,
        logFile: buildLog,
      })
      if (status !== 0)
        throw new Error(`The web build failed (${status}).\n${tail(buildLog)}`)
    }

    const stackOverrides = {
      TEST_ENV: 'local',
      DATABASE_URL: state.database.url,
      REDIS_URL: redisUrl,
      REDIS_TLS: 'false',
      ...supabase,
      PORT: String(API_PORT),
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
    state.stack = startProcess('api-stack', 'node', [launcher], {
      cwd: repoRoot,
      env: stackEnv,
      logDir,
    })
    await waitForHealthy(`${API_BASE_URL}/api/health`, state.stack, 15 * 60_000, () =>
      redactSecrets(tail(path.join(logDir, 'api-stack.log')), state.secrets)
    )
    log(`API ready at ${API_BASE_URL}.`)

    state.web = startProcess(
      'web',
      'node',
      [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(WEB_PORT)],
      { cwd: webRoot, env: webEnv, logDir }
    )
    await waitForHealthy(`${WEB_BASE_URL}/api/health`, state.web, 2 * 60_000, () =>
      redactSecrets(tail(path.join(logDir, 'web.log')), state.secrets)
    )
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
    const output = []
    exitCode = await new Promise((resolve) => {
      const child = spawn(
        'node',
        [playwrightCli, 'test', '--config', ownedConfig, ...playwrightArgs],
        { cwd: repoRoot, env: playwrightEnv, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      child.stdout.on('data', (chunk) => output.push(chunk))
      child.stderr.on('data', (chunk) => output.push(chunk))
      child.once('exit', (code) => resolve(code ?? 1))
      child.once('error', () => resolve(1))
    })
    await teardown()
    const redacted = redactSecrets(Buffer.concat(output).toString('utf8'), state.secrets)
    process.stdout.write(redacted)
    fs.writeFileSync(path.join(artifacts, 'playwright-output.log'), redacted)
  } catch (error) {
    console.error(`[real-session] ${redactSecrets(String(error.message), state.secrets)}`)
    exitCode = 1
  } finally {
    await teardown()
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
