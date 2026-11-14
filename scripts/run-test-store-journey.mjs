#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 D15 RevenueCat Test Store journey on a device (S4-12, S4-15, TEA-18, TEA-19). The
// steps and their checks live in scripts/lib/test-store-runner.mjs and test-store-journey.mjs;
// this file binds them to adb, simctl, Maestro, Metro and the journey proxy, writes private
// evidence under --out, and exits nonzero unless every step passed.
//
//   node scripts/run-test-store-journey.mjs --platform android|ios --device <serial|udid> \
//     --build debug|minifiedDebuggable --server local|preview --out <dir> \
//     [--scenario purchase|restore] [--api-url <origin>] --artifact <apk|app> \
//     [--over-install <apk|app>] [--over-install-build debug|minifiedDebuggable] \
//     [--over-install-sha <sha>] [--build-sha <sha>] \
//     [--secrets-env <file>] [--app-id com.couturecast.app] [--metro-port 8081] [--proxy-port 4011]
//
// Before it runs: the debuggable build (--artifact, or already installed) on a booted emulator or
// simulator; for --server local, the local API (default http://127.0.0.1:4000) started with
// TEST_ENV=local and the Test Store project's REVENUECAT_SECRET_API_KEY (the API reads
// .env.local); for --server preview, the steps of scripts/test-store-preview-webhook.mjs.
//
// What the run does: signs up a fresh member (a plain member: no grant, no entitlement), starts
// the proxy in front of the API and a Metro that bakes that member's mobile E2E bearer, the
// proxy origin and the Test Store public key into the development bundle, opens the app, and
// runs the scenario. Secrets are read by name from --secrets-env and passed to Metro's env or the
// proxy's header; they are never printed or written to the evidence.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { waitForExpoStatus } from './lib/expo-dev-server.mjs'
import {
  collectEvidence,
  findAapt2,
  variantOutputs,
} from './lib/minified-debuggable-evidence.mjs'
import {
  journeyApi,
  requireEnvValue,
  serverState,
  waitForServerState,
} from './lib/test-store-api.mjs'
import {
  assertSameSigner,
  assertServerPaid,
  FLOW_DIR,
  journeyOptions,
  journeySteps,
  JourneyError,
  premiumStatusPatterns,
  signerSha256,
} from './lib/test-store-journey.mjs'
import { startApiProxy } from './lib/test-store-proxy.mjs'
import {
  memberRef,
  runJourney,
  writeArtifactManifests,
} from './lib/test-store-runner.mjs'
import { READ_BYPASS_ENV } from './lib/test-store-webhook.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`)
  return at < 0 ? fallback : argv[at + 1]
}

const options = journeyOptions({
  platform: option('platform'),
  build: option('build', 'debug'),
  server: option('server', 'local'),
  scenario: option('scenario', 'purchase'),
  appId: option('app-id', 'com.couturecast.app'),
})
const { platform, build, server, scenario, appId } = options
const device = option('device')
if (!device || !option('out')) throw new Error('usage: --device <id> --out <dir>')
const out = path.resolve(option('out'))
fs.mkdirSync(out, { recursive: true, mode: 0o700 })
const artifact = option('artifact') && path.resolve(option('artifact'))
const overInstallArtifact = option('over-install') && path.resolve(option('over-install'))
// The over-install may be the other Android debuggable type (debug over minifiedDebuggable or the
// reverse); it decides how the app is opened afterwards.
const overInstallBuild = option('over-install-build', build)
if (!['debug', 'minifiedDebuggable'].includes(overInstallBuild))
  throw new JourneyError('test_store_build_invalid', overInstallBuild)
let installedBuild = build
// Both scenarios reinstall (the sign-in recovery and the lost-mirror restore).
if (!artifact)
  throw new JourneyError('test_store_artifact_required', 'reinstall needs --artifact')
const apiOrigin = new URL(
  option('api-url', server === 'local' ? 'http://127.0.0.1:4000' : '')
).origin
const envFile = path.resolve(
  option(
    'secrets-env',
    path.join(root, server === 'local' ? '.env.local' : '.env.preview')
  )
)
const metroPort = Number(option('metro-port', '8081'))
// minifiedDebuggable has no dev launcher and loads its bundle from localhost:8081.
if ([build, overInstallBuild].includes('minifiedDebuggable') && metroPort !== 8081)
  throw new JourneyError('test_store_metro_port_fixed', String(metroPort))
const proxyPort = Number(option('proxy-port', '4011'))
const rev = (value) =>
  spawnSync('git', ['rev-parse', value], { cwd: root, encoding: 'utf8' }).stdout.trim()
const buildSha = rev(option('build-sha', 'HEAD'))

const adbBinary = process.env.ANDROID_HOME
  ? path.join(process.env.ANDROID_HOME, 'platform-tools/adb')
  : path.join(process.env.HOME, 'Library/Android/sdk/platform-tools/adb')

function run(binary, args, { timeout = 180_000 } = {}) {
  const result = spawnSync(binary, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout,
    killSignal: 'SIGKILL',
  })
  if (result.status !== 0 || result.error) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().slice(-900)
    throw new JourneyError(
      'test_store_command_failed',
      `${path.basename(binary)} ${args.slice(0, 4).join(' ')} ${path.basename(String(args.at(-1)))}:${result.status ?? result.error?.code}:${output}`
    )
  }
  return result.stdout
}
const adb = (...args) => run(adbBinary, ['-s', device, ...args])
const simctl = (...args) => run('xcrun', ['simctl', ...args])

// --- secrets, read by name only ----------------------------------------------------------
const testStoreKey = requireEnvValue(envFile, 'EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY')
if (!testStoreKey.startsWith('test_'))
  throw new JourneyError('test_store_key_not_test_store', envFile)
const bypassHeaders =
  server === 'preview'
    ? { 'x-vercel-protection-bypass': requireEnvValue(envFile, READ_BYPASS_ENV) }
    : {}
if (server === 'local') requireEnvValue(envFile, 'REVENUECAT_SECRET_API_KEY')

const api = journeyApi({ origin: apiOrigin, headers: bypassHeaders })
const locale = JSON.parse(
  fs.readFileSync(
    path.join(root, `apps/mobile/assets/locales/${option('locale', 'en-US')}.json`),
    'utf8'
  )
)
const status = premiumStatusPatterns(locale)
const startedAt = Date.now()
let member
let proxy
let metro

// Metro serves the app's development bundle. The isolated-build flags would turn the live-font
// marker on by config and make the `__DEV__` check prove nothing, so they never reach it.
const metroEnv = () => {
  const env = { ...process.env }
  for (const name of [
    'STORY65_NATIVE_TEST_BUILD',
    'STORY68_NATIVE_TEST_BUILD',
    'CC68_RELEASE_PROOF_LOOPBACK',
    'EXPO_PUBLIC_E2E_AUTH_MODE',
    'EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE',
  ])
    delete env[name]
  return {
    ...env,
    CI: '1',
    EXPO_NO_TELEMETRY: '1',
    EXPO_PUBLIC_API_BASE_URL: proxy.url,
    EXPO_PUBLIC_E2E_ACCESS_TOKEN: member.token,
    EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY: testStoreKey,
  }
}

async function startMetro() {
  const log = fs.openSync(path.join(out, 'metro.log'), 'w', 0o600)
  metro = spawn(
    'npx',
    ['expo', 'start', '--dev-client', '--clear', '--port', String(metroPort)],
    {
      cwd: path.join(root, 'apps/mobile'),
      env: metroEnv(),
      stdio: ['ignore', log, log],
      detached: true,
    }
  )
  await waitForExpoStatus(`http://127.0.0.1:${metroPort}`, 180_000)
}

const devClientUrl = `mobile://expo-development-client/?url=${encodeURIComponent(`http://127.0.0.1:${metroPort}`)}`

async function launch() {
  if (platform === 'android') {
    adb('reverse', `tcp:${metroPort}`, `tcp:${metroPort}`)
    adb('reverse', `tcp:${proxy.port}`, `tcp:${proxy.port}`)
    spawnSync(adbBinary, ['-s', device, 'shell', 'am', 'force-stop', appId])
    // minifiedDebuggable has no dev launcher: React Native loads from Metro at localhost:8081.
    if (installedBuild === 'minifiedDebuggable')
      adb('shell', 'am', 'start', '-n', `${appId}/.MainActivity`)
    else
      adb(
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        devClientUrl,
        appId
      )
  } else {
    spawnSync('xcrun', ['simctl', 'terminate', device, appId])
    simctl('openurl', device, devClientUrl)
  }
}

function flow(name) {
  run(
    'maestro',
    [
      '--device',
      device,
      'test',
      '--debug-output',
      path.join(out, 'maestro', `${Date.now()}-${name}`),
      '-e',
      `MAESTRO_APP_ID=${appId}`,
      '-e',
      'MAESTRO_BACK=Back',
      '-e',
      `PREMIUM_STATUS_NONE=${status.none}`,
      '-e',
      `PREMIUM_STATUS_ACTIVE=${status.active}`,
      path.join(root, FLOW_DIR, `${name}.yaml`),
    ],
    { timeout: 300_000 }
  )
}

function install(file) {
  if (platform === 'android') adb('install', '-r', file)
  else simctl('install', device, file)
}

function uninstall() {
  if (platform === 'android') spawnSync(adbBinary, ['-s', device, 'uninstall', appId])
  else spawnSync('xcrun', ['simctl', 'uninstall', device, appId])
}

/** The installed APK's signer certificate SHA-256 (TEA-19). */
function installedSigner() {
  const remote = adb('shell', 'pm', 'path', appId)
    .split('\n')
    .map((line) => line.replace(/^package:/, '').trim())
    .find((line) => line.endsWith('base.apk'))
  if (!remote) throw new JourneyError('test_store_installed_apk_missing', appId)
  const local = path.join(out, `installed-${Date.now()}.apk`)
  adb('pull', remote, local)
  return apkSigner(local)
}

function apkSigner(file) {
  const tools = path.dirname(findAapt2())
  return signerSha256(
    run(path.join(tools, 'apksigner'), ['verify', '--print-certs', file])
  )
}

// RevenueCat iOS writes its debug lines to os_log under the app's bundle id; debug lines are not
// kept in the simulator's store, so a stream started before the journey collects them.
let logStream
function startDeviceLog() {
  if (platform === 'android') {
    adb('logcat', '-c')
    return
  }
  const file = fs.openSync(path.join(out, 'device.log'), 'w', 0o600)
  logStream = spawn(
    'xcrun',
    [
      'simctl',
      'spawn',
      device,
      'log',
      'stream',
      '--level',
      'debug',
      '--style',
      'compact',
      '--predicate',
      `subsystem == "${appId}" AND eventMessage CONTAINS[c] "Restoring purchases"`,
    ],
    { stdio: ['ignore', file, file] }
  )
}

function deviceLog() {
  if (platform === 'android') return adb('logcat', '-d', '-v', 'time')
  return fs.readFileSync(path.join(out, 'device.log'), 'utf8')
}

const io = {
  async preflight() {
    await api.health()
    member = await api.signup()
    // Local: the ledger answers. A 503 means the API has no RevenueCat secret and a purchase
    // could never reach the server by reconciliation. Preview: no refresh before or during the
    // purchase, so the webhook stays the only path.
    let ledger = 'not called (preview leg)'
    if (server === 'local') {
      const refresh = await api.refresh(member.token)
      if (refresh.status !== 200)
        throw new JourneyError('test_store_ledger_unconfigured', String(refresh.status))
      ledger = 'pull answered 200'
    }
    proxy = await startApiProxy({
      target: apiOrigin,
      port: proxyPort,
      headers: bypassHeaders,
    })
    await startMetro()
    startDeviceLog()
    return { userId: member.userId, ledger }
  },
  launch,
  flow: async (name) => flow(name),
  hierarchy: async () => run('maestro', ['--device', device, 'hierarchy']),
  serverState: () => serverState(api, member.token),
  waitForPaid: () =>
    waitForServerState({
      api,
      token: member.token,
      accept: (state) => {
        assertServerPaid(state)
        return true
      },
      timeoutMs: server === 'preview' ? 180_000 : 30_000,
    }),
  setPolicy: (name) => proxy?.setPolicy(name),
  proxyLog: () => proxy?.log ?? [],
  async minifiedEvidence() {
    const defaults = variantOutputs(
      option('android-root', path.join(root, 'apps/mobile/android'))
    )
    return collectEvidence({
      apk: artifact ?? defaults.apk,
      mapping: defaults.mapping,
      usage: defaults.usage,
      serial: device,
      packageName: appId,
    })
  },
  async overInstall() {
    if (!overInstallArtifact) throw new JourneyError('test_store_over_install_missing')
    const before = platform === 'android' ? installedSigner() : null
    install(overInstallArtifact)
    installedBuild = overInstallBuild
    if (platform !== 'android') return { artifact: path.basename(overInstallArtifact) }
    return {
      artifact: path.basename(overInstallArtifact),
      build: overInstallBuild,
      ...assertSameSigner(before, installedSigner()),
    }
  },
  async reinstall() {
    uninstall()
    install(artifact)
    installedBuild = build
    return { artifact: path.basename(artifact), uninstalled: true }
  },
  deviceLog: async () => deviceLog(),
  now: () => Date.now(),
}

const steps = journeySteps({
  scenario,
  server,
  build,
  overInstall: Boolean(overInstallArtifact),
})
let result
try {
  // A fresh install per run (TD-03): no RevenueCat cache or session from an earlier member.
  if (artifact) {
    uninstall()
    install(artifact)
  }
  result = await runJourney({ steps, io, server, platform, appId, metroEnv })
} finally {
  logStream?.kill('SIGTERM')
  await proxy?.close()
  if (metro?.pid) {
    try {
      process.kill(-metro.pid, 'SIGTERM')
    } catch {
      // Metro already exited.
    }
  }
  if (platform === 'android') {
    spawnSync(adbBinary, ['-s', device, 'reverse', '--remove', `tcp:${metroPort}`])
    spawnSync(adbBinary, ['-s', device, 'reverse', '--remove', `tcp:${proxyPort}`])
  }
}

const label = `test-store-${platform}-${build}-${server}-${scenario}`
// Loaded by URL: the manifest writer is a recorded input of the leg (evidence-manifest.mjs
// lists it as a path), and its own literals name every other leg's harness, which the
// test-store leg does not read.
const { writeManifest } = await import(
  new URL('./lib/evidence-manifest.mjs', import.meta.url).href
)
const manifests = writeArtifactManifests({
  out,
  cwd: root,
  manifest: writeManifest,
  artifacts: [
    { name: `${label}-installed`, file: artifact, rev: buildSha },
    ...(overInstallArtifact
      ? [
          {
            name: `${label}-over-install`,
            file: overInstallArtifact,
            rev: rev(option('over-install-sha', 'HEAD')),
          },
        ]
      : []),
  ],
})
const report = {
  platform,
  device,
  build,
  server,
  scenario,
  appId,
  apiHost: new URL(apiOrigin).host,
  buildSha,
  // No user id in the evidence: a hash reference here, the id itself in a private side file
  // that only `test-store-preview-webhook.mjs verify --member-file` reads.
  memberRef: member ? memberRef(member.userId) : null,
  wallSeconds: Math.round((Date.now() - startedAt) / 1000),
  steps,
  verdict: result.verdict,
  records: result.records,
  proxyLog: proxy?.log ?? [],
  manifests: manifests.map((file) => path.basename(file)),
}
if (member)
  fs.writeFileSync(
    path.join(out, `${label}.member.private.json`),
    JSON.stringify({ userId: member.userId }),
    { mode: 0o600 }
  )
fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify(report, null, 2), {
  mode: 0o600,
})
console.log(
  JSON.stringify({ label, verdict: result.verdict, wallSeconds: report.wallSeconds })
)
process.exitCode = result.verdict.pass ? 0 : 1
