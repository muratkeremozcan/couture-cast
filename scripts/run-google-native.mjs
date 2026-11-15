#!/usr/bin/env node
// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
/**
 * Story 6.17 M lane: the Google sign-in device flows (maestro/google-sign-in/) on the isolated
 * Story 6.5 Android debug client, against a stack this run owns.
 *
 *   REDIS_URL=redis://127.0.0.1:<port> node scripts/run-google-native.mjs \
 *     --apk apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk \
 *     --device emulator-5554 [--flows google-new-account,google-under13] [--evidence <dir>]
 *
 * The client is built beforehand, with STORY65_NATIVE_TEST_BUILD=1 so it is
 * com.couturecast.story65 with the couturecast-story65 scheme (apps/mobile/app.config.ts), the
 * only kind of build where a development bundle may use the OAuth stand-in (D10). In order:
 *
 * 1. Resolves the local Supabase (`stack.mjs`), refuses anything off this machine, deletes the
 *    Auth users a killed earlier run left recorded.
 * 2. Creates a `tea_community_<32 hex>` database, starts the mock OIDC provider where GoTrue and
 *    the device browser share one URL (`mock-oidc-container.mjs`), then the API stack on 4079
 *    (`scripts/start-api-e2e-with-workers.mjs`: migrate, seed, build, workers) and Metro on 8091
 *    with EXPO_PUBLIC_E2E_OAUTH_PROVIDER=keycloak and no repo env file.
 * 3. Installs the client, reverses the API, Metro, Supabase and mock ports, turns off Chrome's
 *    first run, then per flow: records the flow's addresses write-ahead, queues the stand-in
 *    identity on the mock (a device browser cannot add a login_hint), clears the app, opens it
 *    on this Metro, runs the flow and checks the databases (`google-native-flows.mjs`).
 * 4. Always (`lifecycle.mjs`): stops every process group, removes the mock, deletes the
 *    recorded Auth users, drops the database and writes `summary.json`.
 *
 * Maestro reads the addresses and the en-US copy as `-e` values; no key, token or code reaches
 * it, Metro or the app. The local Auth Admin credential stays in this process. The mock's port
 * is fixed by supabase/config.toml, so this lane and the web real-session lane take turns on
 * one machine.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { localE2eDatabaseUrl } from './local-e2e-database.mjs'
import { MAESTRO_BIN } from './maestro-version.mjs'
import { deleteRecordedUsers, localAuthUsers } from './e2e-real-session/cleanup-users.mjs'
import { redactSecrets } from './e2e-real-session/harness.mjs'
import { IDENTITIES_FILE, recordPendingIdentity } from './e2e-real-session/identities.mjs'
import { startRunLifecycle } from './e2e-real-session/lifecycle.mjs'
import {
  MOCK_OIDC_PORT,
  MOCK_OIDC_URL,
  startMockOidcContainer,
} from './e2e-real-session/mock-oidc-container.mjs'
import { createProcessOwner } from './e2e-real-session/process-owner.mjs'
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  resolveRedisUrl,
  resolveSupabase,
  tail,
  waitForHealthy,
} from './e2e-real-session/stack.mjs'
import {
  GOOGLE_NATIVE_APP_ID,
  GOOGLE_NATIVE_FLOW_DIR,
  GOOGLE_NATIVE_PORTS,
  devClientUrl,
  expectationProblems,
  failingStep,
  flowEnv,
  googleNativeReversePorts,
  harnessEmail,
  selectGoogleNativeFlows,
  standInIdentity,
} from './lib/google-native-flows.mjs'
import { manifestBundleUrl } from './lib/expo-manifest-bundle-url.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mobileRoot = path.join(repoRoot, 'apps/mobile')
const launcher = path.join(repoRoot, 'scripts/start-api-e2e-with-workers.mjs')
const API_BASE_URL = `http://127.0.0.1:${GOOGLE_NATIVE_PORTS.api}`
const METRO_URL = `http://127.0.0.1:${GOOGLE_NATIVE_PORTS.metro}`
const FLOW_TIMEOUT_MS = 10 * 60_000

const log = (message) => console.log(`[google-native] ${message}`)

/** The message and, for a failed fetch, the socket error under it. */
function describeError(error) {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause instanceof Error ? error.cause : undefined
  const code = cause && 'code' in cause ? ` ${String(cause.code)}` : ''
  return cause ? `${error.message} (${cause.message}${code})` : error.message
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (!value.startsWith('--')) throw new Error(`Unexpected argument ${value}`)
    parsed[value.slice(2)] = argv[++index]
  }
  return parsed
}

function adbBinary() {
  for (const home of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (!home) continue
    const candidate = path.join(home, 'platform-tools', 'adb')
    if (fs.existsSync(candidate)) return candidate
  }
  const mac = path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb')
  return fs.existsSync(mac) ? mac : 'adb'
}

const maestroBinary = () =>
  process.env.MAESTRO_CLI ?? (fs.existsSync(MAESTRO_BIN) ? MAESTRO_BIN : 'maestro')

/** The en-US copy the flows assert on, from the app's own catalogs (built by the API stack). */
async function flowStrings() {
  const { getFederatedSignInStrings } = await import('@couture/utils')
  const federated = getFederatedSignInStrings('en-US')
  const catalog = JSON.parse(
    fs.readFileSync(path.join(mobileRoot, 'assets/locales/en-US.json'), 'utf8')
  )
  return {
    back: catalog.common.back,
    cancelled: federated.cancelled,
    underage: federated.underage,
    email: catalog.community.notifications.email,
    sendCode: catalog.community.notifications.sendCode,
    codeSent: catalog.community.notifications.codeSent,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  for (const name of ['apk', 'device'])
    if (!args[name]) throw new Error(`--${name} is required`)
  const apk = path.resolve(args.apk)
  if (!fs.existsSync(apk)) throw new Error(`No client at ${apk}`)
  const device = args.device
  const flows = selectGoogleNativeFlows(args.flows)
  const directory = path.resolve(
    args.evidence ??
      process.env.GOOGLE_NATIVE_DIR ??
      path.join(repoRoot, '.google-native-e2e')
  )
  const logDir = path.join(directory, 'logs')
  const maestroDir = path.join(directory, 'maestro')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })

  const supabase = resolveSupabase(process.env, repoRoot)
  const redisUrl = resolveRedisUrl(process.env)
  const sourceDatabaseUrl =
    process.env.LOCAL_DATABASE_URL?.trim() || localE2eDatabaseUrl()
  const auth = localAuthUsers({ ...process.env, ...supabase })
  const adb = adbBinary()
  const secrets = [supabase.SUPABASE_ANON_KEY, supabase.SUPABASE_SERVICE_ROLE_KEY]

  const leftover = await deleteRecordedUsers({ directory, ...auth })
  if (leftover.recorded > 0)
    log(`Deleted ${leftover.deleted} Auth user(s) an earlier run left recorded.`)
  if (leftover.failed.length > 0)
    throw new Error('Auth users from an earlier run could not be deleted.')
  fs.rmSync(path.join(directory, IDENTITIES_FILE), { force: true })
  for (const dir of [logDir, maestroDir]) {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }

  const owner = createProcessOwner({ graceMs: 5_000, killWaitMs: 5_000 })
  const state = {
    /** @type {{ close: () => Promise<void> } | undefined} */
    mockOidc: undefined,
    /** @type {{ name: string; url: string } | undefined} */
    database: undefined,
    /** @type {Record<string, unknown>[]} */
    results: [],
  }
  const readLog = (name) => () =>
    redactSecrets(tail(path.join(logDir, `${name}.log`)), secrets)

  const run = (command, commandArgs, options = {}) => {
    const result = spawnSync(command, commandArgs, {
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 120_000,
      maxBuffer: 64 * 1024 * 1024,
      env: options.env ?? process.env,
    })
    if (!options.allowFail && (result.status !== 0 || result.error))
      throw new Error(
        `${path.basename(command)} ${commandArgs.slice(0, 4).join(' ')} failed: ${result.error?.message ?? String(result.stderr).slice(-800)}`
      )
    return result
  }
  const adbRun = (...rest) => run(adb, ['-s', device, ...rest])
  const reversePorts = googleNativeReversePorts(supabase.SUPABASE_URL, MOCK_OIDC_PORT)
  const ensureReverses = () => {
    adbRun('wait-for-device')
    for (const port of reversePorts) adbRun('reverse', `tcp:${port}`, `tcp:${port}`)
  }

  const mockControl = async (pathname, body) => {
    const response = await fetch(`${MOCK_OIDC_URL}/__control/${pathname}`, {
      signal: AbortSignal.timeout(10_000),
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    if (!response.ok) throw new Error(`Mock OIDC ${pathname} answered ${response.status}`)
  }

  /**
   * Replaces whatever the mock holds with this flow's identity. A connection the host's Docker
   * port proxy drops before any answer (seen once per failed flow locally, never in isolation)
   * is retried from the reset, so a lost answer cannot leave a stale or doubled queue; an
   * answer the mock gives is never retried. Each retry is logged.
   */
  const queueIdentity = async (identity) => {
    for (let attempt = 1; ; attempt++) {
      try {
        await mockControl('reset')
        await mockControl('next-identity', identity)
        return
      } catch (error) {
        if (!(error instanceof TypeError) || attempt === 3) throw error
        log(`Mock OIDC control connection dropped (${describeError(error)}); retrying.`)
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
    }
  }

  /** @param {string} url */
  const appUserIds = async (url, email) => {
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    try {
      const { rows } = await client.query(
        'SELECT id FROM "User" WHERE lower(email) = lower($1)',
        [email]
      )
      return rows.map((row) => String(row.id))
    } finally {
      await client.end()
    }
  }
  const comfortRow = async (url, userId) => {
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    try {
      const { rows } = await client.query(
        'SELECT runs_cold_warm, wind_tolerance, precip_preparedness FROM "ComfortPreferences" WHERE user_id = $1',
        [userId]
      )
      return rows[0] ?? null
    } finally {
      await client.end()
    }
  }
  const authUserState = async (email) => {
    const found = await auth.findUserByEmail(email)
    if (found.status === 'failed') throw new Error('The local Auth lookup failed.')
    if (found.status === 'absent') return { exists: false, providers: [] }
    const response = await fetch(
      `${supabase.SUPABASE_URL}/auth/v1/admin/users/${found.authUserId}`,
      {
        headers: {
          apikey: supabase.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${supabase.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    )
    if (!response.ok) throw new Error(`Auth Admin user read answered ${response.status}`)
    const user = await response.json()
    return {
      exists: true,
      providers: (user.identities ?? []).map((identity) => String(identity.provider)),
    }
  }

  /** Every address a flow can create, recorded before anything can create it. */
  const recordFlowAddresses = (flow, addresses) => {
    for (const [role, address] of Object.entries(addresses))
      if (address)
        recordPendingIdentity(directory, {
          appUserId: null,
          email: address,
          mapping: 'no-app-account',
          issueMode: 'generated',
          label: `google-native:${flow.name}:${role}`,
        })
  }

  /** An eligible adult app account through the product signup endpoint, as E-LINK does. */
  const createMember = async (email) => {
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, birthdate: '1990-06-15' }),
    })
    if (response.status !== 201)
      throw new Error(`The member signup answered ${response.status}`)
    return String((await response.json()).userId)
  }

  /**
   * The flow's expectation problems, polled briefly: the app's Cancel and the server's under-13
   * refusal delete the Auth user before the screen changes, and GoTrue commits on its own time.
   */
  const checkFlow = async (flow, database, email, memberId) => {
    let problems = []
    for (let attempt = 0; attempt < 10; attempt++) {
      const ids = await appUserIds(database.url, email)
      problems = expectationProblems(flow, {
        appUserIds: ids,
        memberId,
        authUser: await authUserState(email),
        comfort:
          flow.expect.comfort && ids[0] ? await comfortRow(database.url, ids[0]) : null,
      })
      if (problems.length === 0) return problems
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    return problems
  }

  /** One flow: records, queues, clears and opens the app, runs Maestro, checks the state. */
  const runFlow = async (flow, strings, database) => {
    const started = Date.now()
    const email = harnessEmail()
    const otpEmail = flow.otpEmail ? harnessEmail() : undefined
    recordFlowAddresses(flow, { google: email, 'email-code': otpEmail })
    const memberId = flow.member ? await createMember(email) : undefined
    await queueIdentity(standInIdentity(flow, email))

    ensureReverses()
    adbRun('shell', 'pm', 'clear', GOOGLE_NATIVE_APP_ID)
    adbRun(
      'shell',
      `am start -a android.intent.action.VIEW -d '${devClientUrl()}' ${GOOGLE_NATIVE_APP_ID}`
    )
    const output = path.join(maestroDir, flow.name)
    fs.mkdirSync(output, { recursive: true })
    const env = flowEnv(flow, { email, otpEmail, strings })
    const maestro = run(
      maestroBinary(),
      [
        '--device',
        device,
        'test',
        '--test-output-dir',
        output,
        '--debug-output',
        output,
        '--flatten-debug-output',
        ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
        path.join(repoRoot, GOOGLE_NATIVE_FLOW_DIR, `${flow.name}.yaml`),
      ],
      {
        allowFail: true,
        timeoutMs: FLOW_TIMEOUT_MS,
        env: {
          ...process.env,
          MAESTRO_CLI_NO_ANALYTICS: '1',
          MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
        },
      }
    )
    const text = redactSecrets(`${maestro.stdout}\n${maestro.stderr}`, secrets)
    fs.writeFileSync(path.join(logDir, `maestro-${flow.name}.log`), text)
    const problems =
      maestro.status === 0 ? await checkFlow(flow, database, email, memberId) : []
    const result = {
      flow: flow.name,
      passed: maestro.status === 0 && problems.length === 0,
      maestroStatus: maestro.status,
      failingStep: maestro.status === 0 ? undefined : failingStep(text),
      problems,
      seconds: Math.round((Date.now() - started) / 1000),
    }
    log(
      `${flow.name}: ${result.passed ? 'passed' : 'FAILED'} in ${result.seconds}s${
        result.failingStep ? ` (${result.failingStep})` : ''
      }${problems.length ? ` (${problems.join('; ')})` : ''}`
    )
    return result
  }

  const runAll = async () => {
    await createIsolatedDatabase(sourceDatabaseUrl, (database) => {
      state.database = database
    })
    owner.assertRunning()
    const database = /** @type {{ name: string; url: string }} */ (state.database)
    log(`Created isolated database ${database.name}.`)

    state.mockOidc = await startMockOidcContainer()
    owner.assertRunning()
    log(`Mock OIDC provider (Google stand-in) is running at ${MOCK_OIDC_URL}.`)

    const stackOverrides = {
      TEST_ENV: 'local',
      DATABASE_URL: database.url,
      REDIS_URL: redisUrl,
      REDIS_TLS: 'false',
      ...supabase,
      PORT: String(GOOGLE_NATIVE_PORTS.api),
      API_LISTEN_HOST: '127.0.0.1',
      API_BASE_URL,
      PUBLIC_API_URL: API_BASE_URL,
      WEB_E2E_BASE_URL: `http://127.0.0.1:${GOOGLE_NATIVE_PORTS.web}`,
      HTTP_CORS_ORIGIN: `http://127.0.0.1:${GOOGLE_NATIVE_PORTS.web}`,
      E2E_WEATHER_DOUBLE_PORT: String(GOOGLE_NATIVE_PORTS.weatherDouble),
      MODERATION_OPS_CAPTURE_PORT: String(GOOGLE_NATIVE_PORTS.opsCapture),
      COMMUNITY_SCREENING_EVIDENCE_MODE: 'fixture',
      PLAYWRIGHT_SKIP_DB_RESET: 'true',
    }
    const stackEnv = {
      ...process.env,
      ...stackOverrides,
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

    // The bundle's whole view of the world: no repo env file (COUTURE_CONFIG_NO_ENV_FILES,
    // EXPO_NO_DOTENV), the local origins, the anon key and the stand-in seam.
    const metroEnv = {
      ...Object.fromEntries(
        [
          'PATH',
          'HOME',
          'USER',
          'SHELL',
          'TMPDIR',
          'LANG',
          'LC_ALL',
          'TERM',
          'ANDROID_HOME',
          'ANDROID_SDK_ROOT',
          'JAVA_HOME',
        ]
          .filter((key) => process.env[key])
          .map((key) => [key, process.env[key]])
      ),
      CI: '1',
      COUTURE_CONFIG_NO_ENV_FILES: '1',
      EXPO_NO_DOTENV: '1',
      EXPO_NO_TELEMETRY: '1',
      STORY65_NATIVE_TEST_BUILD: '1',
      EXPO_PUBLIC_API_BASE_URL: API_BASE_URL,
      EXPO_PUBLIC_SUPABASE_URL: supabase.SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: supabase.SUPABASE_ANON_KEY,
      EXPO_PUBLIC_E2E_AUTH_MODE: 'real',
      EXPO_PUBLIC_E2E_OAUTH_PROVIDER: 'keycloak',
    }
    const metro = owner.spawn(
      'metro',
      'npx',
      ['expo', 'start', '--dev-client', '--port', String(GOOGLE_NATIVE_PORTS.metro)],
      { cwd: mobileRoot, env: metroEnv, logFile: path.join(logDir, 'metro.log') }
    )
    await waitForHealthy(
      `${METRO_URL}/status`,
      metro,
      3 * 60_000,
      readLog('metro'),
      owner.assertRunning
    )
    // One Android bundle request builds the bundle the app's manifest names, so the first
    // flow does not wait for a cold build.
    const manifest = await fetch(`${METRO_URL}/`, {
      headers: {
        'expo-platform': 'android',
        accept: 'application/expo+json,application/json',
      },
    })
    const bundle = await fetch(manifestBundleUrl(await manifest.text(), METRO_URL), {
      signal: AbortSignal.timeout(10 * 60_000),
    })
    if (!bundle.ok) throw new Error(`Metro's Android bundle answered ${bundle.status}`)
    await bundle.arrayBuffer()
    owner.assertRunning()
    log(`Metro ready at ${METRO_URL} with the bundle built.`)

    adbRun('wait-for-device')
    run(adb, ['-s', device, 'install', '-r', apk], { timeoutMs: 5 * 60_000 })
    // Chrome's first run would cover the first Custom Tab; a debug-app command line skips it
    // where the image allows it, and steps/continue-with-google.yaml handles it where not.
    run(
      adb,
      [
        '-s',
        device,
        'shell',
        "echo '_ --disable-fre --no-default-browser-check --no-first-run' > /data/local/tmp/chrome-command-line",
      ],
      { allowFail: true }
    )
    run(
      adb,
      [
        '-s',
        device,
        'shell',
        'am',
        'set-debug-app',
        '--persistent',
        'com.android.chrome',
      ],
      {
        allowFail: true,
      }
    )
    ensureReverses()

    const strings = await flowStrings()
    for (const flow of flows) {
      owner.assertRunning()
      state.results.push(await runFlow(flow, strings, database))
    }
    return state.results.every((result) => result.passed) ? 0 : 1
  }

  const release = async () => {
    let code = 0
    try {
      if (state.mockOidc)
        fs.writeFileSync(path.join(logDir, 'mock-oidc.log'), await state.mockOidc.logs())
      await state.mockOidc?.close()
    } catch (error) {
      log(`Removing the mock OIDC containers failed: ${error.message}`)
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
    for (const port of reversePorts)
      run(adb, ['-s', device, 'reverse', '--remove', `tcp:${port}`], { allowFail: true })
    fs.writeFileSync(
      path.join(directory, 'summary.json'),
      `${JSON.stringify({ device, flows: state.results }, null, 2)}\n`
    )
    return code
  }

  const lifecycle = startRunLifecycle({
    owner,
    run: runAll,
    release,
    log,
    reportError: (error) =>
      console.error(`[google-native] ${redactSecrets(describeError(error), secrets)}`),
  })
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      log(`${signal} received; stopping every process, then cleaning up.`)
      void lifecycle.teardown('signal')
    })
  const exitCode = await lifecycle.done
  const passed = state.results.filter((result) => result.passed).length
  log(`${passed}/${flows.length} flow(s) passed; exit code ${exitCode}.`)
  return exitCode
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`[google-native] ${error.message}`)
    process.exit(1)
  }
)
