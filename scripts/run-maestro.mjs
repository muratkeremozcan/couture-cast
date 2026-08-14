#!/usr/bin/env node
// Step 12 step 4 owner: searchable owner anchor

/**
 * Mobile E2E bootstrap for Maestro.
 *
 * Purpose:
 * - Use the explicitly requested mobile platform.
 * - Start or reuse a healthy Expo/Metro session.
 * - Wait until Expo Go is actually available before running Maestro.
 * - Execute Maestro flows with the resolved app id and app URL.
 *
 * Why this script exists:
 * - `maestro test ...` alone is not enough in this repo because the app under test
 *   depends on Expo Go, Metro, and sometimes simulator boot/install work.
 * - We keep that orchestration here so the npm scripts stay small and the flow is
 *   readable in one place.
 */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import net from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import os from 'node:os'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const require = createRequire(import.meta.url)
const { PrismaClient } = require('@prisma/client')
const mobilePackageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'apps/mobile/package.json'), 'utf8')
)
const expoSdkMajor = String(mobilePackageJson.dependencies?.expo ?? '').match(/\d+/)?.[0]
const EXPO_SDK_VERSION =
  process.env.MOBILE_E2E_EXPO_SDK_VERSION ||
  (expoSdkMajor ? `${expoSdkMajor}.0.0` : '54.0.0')
const cliArgs = process.argv.slice(2)
let cliPlatform
const FLOW_PATHS = []
for (let index = 0; index < cliArgs.length; index += 1) {
  const arg = cliArgs[index]
  if (arg === '--platform') {
    cliPlatform = cliArgs[index + 1]
    index += 1
  } else if (arg.startsWith('--platform=')) {
    cliPlatform = arg.slice('--platform='.length)
  } else if (!arg.startsWith('--')) {
    FLOW_PATHS.push(arg)
  }
}
/**
 * Every flow in `maestro/`, discovered rather than listed, so a new flow is
 * covered the moment it is written instead of when someone remembers to add it
 * here. `subflows/` is excluded because those are fragments, not runnable flows.
 *
 * The default used to be just `sanity` and `analytics`, which meant
 * `npm run test:mobile:e2e:ios` reported success having exercised two of
 * eighteen flows. That is how a suite goes quietly stale.
 *
 * Order is alphabetical and therefore stable. The suite shares one fixture user
 * across all flows, so any flow that changes durable state (locale is the one
 * that bites) is responsible for restoring it before it ends; nothing here may
 * depend on running before or after a particular sibling.
 */
const discoverFlows = () => {
  const flowDir = path.join(projectRoot, 'maestro')
  return fs
    .readdirSync(flowDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => `maestro/${entry.name}`)
    .sort()
}

const flowsToRun = FLOW_PATHS.length > 0 ? FLOW_PATHS : discoverFlows()
const WRITE_ARTIFACTS =
  process.argv.includes('--ci') ||
  process.argv.includes('--artifacts') ||
  process.env.MOBILE_E2E_ARTIFACTS === '1'
const MAESTRO_ARTIFACT_DIR = process.env.MAESTRO_ARTIFACT_DIR || 'maestro/artifacts'

const START_SERVER = process.env.MOBILE_E2E_SKIP_SERVER !== '1'
const AUTO_BOOT_ANDROID = process.env.MOBILE_E2E_AUTO_BOOT_ANDROID !== '0'
// How Android addresses Metro and the API on the host. `127.0.0.1` is the
// starting guess because `adb reverse` maps it and that works on a developer
// machine; the run replaces it with `10.0.2.2` when the device turns out to be
// unable to open the reversed port, which is what happens on a GitHub runner.
// MOBILE_E2E_ANDROID_HOST pins it and skips the probe entirely.
let androidHost = process.env.MOBILE_E2E_ANDROID_HOST || '127.0.0.1'
const REQUESTED_PLATFORM = process.env.MOBILE_E2E_PLATFORM || cliPlatform
const EXPECTED_EXPO_GO_VERSION = process.env.MOBILE_E2E_EXPO_GO_VERSION || '54.0.8'

/**
 * The simulators this run drives.
 *
 * One entry is a normal serial run. Several entries put the run in parallel
 * mode: Maestro splits the flow list across the devices inside a single
 * process, and each device signs in as its own fixture user.
 *
 * It has to be one Maestro process. Maestro pins its iOS driver to a fixed host
 * port and assigns per-device ports itself from the device list it was given,
 * so two `maestro` processes on one machine drive the same XCUITest runner and
 * fail with `only one gesture can be performed at a time` or
 * `Failed to connect to /127.0.0.1:7001`.
 */
const IOS_UDIDS = (
  process.env.MOBILE_E2E_IOS_UDIDS ||
  process.env.MOBILE_E2E_IOS_UDID ||
  ''
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const PARALLEL_DEVICES = IOS_UDIDS.length > 1

/**
 * Which simulator single-device operations act on.
 *
 * `booted` is `simctl`'s own alias for "the one booted device", which is
 * ambiguous the moment a second simulator boots. In parallel mode this is
 * pointed at each device in turn while Expo Go is installed and device state is
 * cleared.
 */
let iosSimulatorUdid = IOS_UDIDS[0] || 'booted'

/**
 * Prefix every line of this runner's output with its label, so a parallel run
 * stays readable.
 */
const SHARD_LABEL = process.env.MOBILE_E2E_SHARD_LABEL || ''

/**
 * Skip starting a wardrobe worker when reusing an already-running API.
 *
 * Sharded runs share one API that already owns its workers. Without this, each
 * shard would start another worker against the same BullMQ queues.
 */
const SKIP_WORKER = process.env.MOBILE_E2E_SKIP_WORKER === '1'

/**
 * The one database this runner talks to directly.
 *
 * It must be the same database the API child process is given further down, or
 * the runner and the app under test are looking at different data. Deliberately
 * NOT falling back to `process.env.DATABASE_URL`: importing `@prisma/client`
 * loads `packages/db/.env`, which on a developer machine points at their own
 * working database (`postgresql://<user>@localhost:5432/couture_cast`) rather
 * than the Supabase test instance on 54322.
 *
 * That fallback was live in `cleanupMobileE2EIdentity`, so the post-run cleanup
 * was issuing its deletes against the developer's own database while the suite
 * ran against 54322. The deletes matched nothing, the transaction committed,
 * and the runner logged success — so every run silently leaked its signed-up
 * fixture user, its location, and its ritual into the test database, and every
 * run pointed a `deleteMany` at a database it was never meant to write to.
 */
const MOBILE_E2E_DATABASE_URL =
  process.env.MOBILE_E2E_DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const log = (msg) =>
  console.log(`[maestro:runner]${SHARD_LABEL ? ` [${SHARD_LABEL}]` : ''} ${msg}`)
const isMac = os.platform() === 'darwin'

const toPosixPath = (filePath) => filePath.split(path.sep).join('/')

const getFlowName = (flowPath) =>
  path.basename(flowPath, path.extname(flowPath)) || 'maestro'

const getFlowReportPath = (flowPath) => {
  const flowName = getFlowName(flowPath)
  return toPosixPath(path.join(MAESTRO_ARTIFACT_DIR, `${flowName}-report.xml`))
}

const getFlowLogPath = (flowPath) => {
  const flowName = getFlowName(flowPath)
  return path.resolve(projectRoot, MAESTRO_ARTIFACT_DIR, `${flowName}-maestro.log`)
}

if (flowsToRun.some((flowPath) => getFlowName(flowPath) === 'analytics')) {
  process.env.MOBILE_ANALYTICS_DIAGNOSTICS = '1'
  process.env.EXPO_PUBLIC_MOBILE_ANALYTICS_DIAGNOSTICS = '1'
}

/**
 * Maestro 2.0.10 still queries local iOS simulators while preparing an Android
 * run. On developer machines with a broken CoreSimulator install, that can hang
 * before the Android flow starts. This PATH shim only answers the simulator
 * inventory query with an empty list and delegates every other xcrun invocation.
 *
 * @returns {string}
 */
const createAndroidXcrunShim = () => {
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-xcrun-'))
  const shimPath = path.join(shimDir, 'xcrun')
  fs.writeFileSync(
    shimPath,
    `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "simctl" && "\${2:-}" == "list" ]]; then
  for arg in "$@"; do
    if [[ "$arg" == "-j" ]]; then
      printf '%s\\n' '{"devicetypes":[],"runtimes":[],"devices":{},"pairs":{}}'
      exit 0
    fi
  done
fi

exec /usr/bin/xcrun "$@"
`
  )
  fs.chmodSync(shimPath, 0o755)
  return shimDir
}

/**
 * Check whether a local TCP port is currently free.
 *
 * We do this before picking a Metro port so the smoke runner avoids colliding
 * with an already running Expo session.
 *
 * @param {number} port
 * @returns {Promise<boolean>}
 */
const isPortFree = (port) =>
  new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => {
      resolve(false)
    })
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })

/**
 * Pick the first usable Metro port from the explicit env override or the repo's
 * fallback list.
 *
 * Order matters here:
 * 1) respect a caller-provided port,
 * 2) otherwise try the common local Expo ports,
 * 3) if all are busy, return the last candidate and let downstream health checks
 *    explain what is already running there.
 *
 * @returns {Promise<number>}
 */
const chooseMetroPort = async () => {
  const preferred = process.env.MOBILE_E2E_METRO_PORT
    ? [Number(process.env.MOBILE_E2E_METRO_PORT)]
    : [8081, 8082, 8083]
  for (const port of preferred) {
    if (await isPortFree(port)) return port
  }
  return preferred[preferred.length - 1]
}

/**
 * Resolve the adb binary the same way everywhere in this script.
 *
 * @returns {string}
 */
const resolveAdbBinary = () => {
  const sdkRoot =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(process.env.HOME ?? '', 'Library', 'Android', 'sdk')
  if (
    process.env.ADB_PATH ||
    (sdkRoot && fs.existsSync(path.join(sdkRoot, 'platform-tools', 'adb')))
  ) {
    return process.env.ADB_PATH || path.join(sdkRoot, 'platform-tools', 'adb')
  }
  return 'adb'
}

/**
 * Map host ports into the Android device's own loopback with `adb reverse`.
 *
 * The device has to reach two servers on the machine running this script: Metro
 * and the local API. Addressing them as `10.0.2.2` works only because that is
 * QEMU's alias for the host loopback, which makes it emulator-only and, more
 * to the point, dependent on the guest being able to route there at all. On a
 * GitHub runner it could not: Expo Go failed the manifest fetch outright and
 * showed its own error screen, with `expo-updates` logging
 *
 *   Remote update request not successful   code=UpdateFailedToLoad
 *   Failed to launch embedded or launchable update
 *
 * which surfaced to the suite as every flow failing on `tab-home` never
 * appearing. `adb reverse` is the mechanism React Native and Expo CLI use for
 * exactly this, it works for physical devices as well as emulators, and it lets
 * the device address both servers as plain `127.0.0.1`.
 *
 * Failures here are logged rather than thrown: the `10.0.2.2` route still works
 * on a developer machine, so a device that refuses the reverse mapping should
 * degrade to the old behaviour instead of failing the run outright.
 *
 * @param {number[]} ports
 * @returns {Promise<void>}
 */
const reverseAndroidPorts = async (ports) => {
  const adbBinary = resolveAdbBinary()
  for (const port of ports) {
    try {
      await captureProcess(adbBinary, ['reverse', `tcp:${port}`, `tcp:${port}`])
      log(`Reversed Android port ${port} to the host`)
    } catch (error) {
      log(`Could not reverse Android port ${port}: ${error.message}`)
    }
  }
}

/**
 * Ask the device itself whether it can reach Metro, and say so plainly.
 *
 * The runner's own health check proves only that Metro answers on the *host*.
 * The device is a separate network namespace, and when it cannot get through,
 * Expo Go fails the manifest fetch and shows its own "Something went wrong."
 * screen. Maestro then reports every flow as `tab-home` never appearing, which
 * reads as the app being broken and sends the investigation to the wrong place
 * entirely. A GitHub runner did exactly this, failing 0.7 seconds after the
 * deep link, far too fast to be a timeout.
 *
 * `toybox wget` is used because the Android system image has no curl or wget of
 * its own, and Metro's `/status` answers `packager-status:running`.
 *
 * Diagnostic only: a failed probe is logged loudly and the run continues, since
 * the probe is newer than the setup it inspects and should not be the thing
 * that fails a suite.
 *
 * @param {number} port
 * @returns {Promise<boolean>}
 */
const probeAndroidMetroReachability = async (host, port) => {
  const adbBinary = resolveAdbBinary()
  const url = `http://${host}:${port}/status`

  // The verdict is taken on this side of the connection, not the device's.
  //
  // Asking the device to open Metro's own port and calling a successful connect
  // "reachable" does not work: with `adb reverse` in place the device always has
  // something listening on that port locally, so the connect succeeds whether or
  // not anything on the host is behind it. That reports a healthy route over a
  // dead one, which is the failure mode this probe exists to catch.
  //
  // So a throwaway listener is opened here, on a port nobody else is using, and
  // the device is asked to connect to it by the route under test. If the
  // connection lands, the route works, and there is nothing to misread: this
  // process saw the socket. `nc` is the only client available, since Android
  // system images ship no curl and no wget (`toybox wget` is absent on API 30
  // and API 36 alike).
  const routeWorks = await new Promise((resolve) => {
    const server = net.createServer()
    let sawConnection = false
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      server.close(() => resolve(value))
    }

    server.on('connection', (socket) => {
      sawConnection = true
      socket.destroy()
    })
    server.on('error', () => finish(null))

    // Loopback is right for both routes: `10.0.2.2` is QEMU's alias for exactly
    // this interface, and the reverse mapping forwards here too.
    server.listen(0, '127.0.0.1', async () => {
      const probePort = server.address().port
      let removeReverse = false
      try {
        if (host === '127.0.0.1') {
          await captureProcess(adbBinary, [
            'reverse',
            `tcp:${probePort}`,
            `tcp:${probePort}`,
          ])
          removeReverse = true
        }
        await captureProcess(adbBinary, ['shell', `nc -z -w 3 ${host} ${probePort}`])
      } catch {
        // A refused connect or a missing nc both land here; `sawConnection`
        // stays false and the route is reported dead, which is the honest read
        // for the first and a conservative one for the second.
      }
      if (removeReverse) {
        await captureProcess(adbBinary, [
          'reverse',
          '--remove',
          `tcp:${probePort}`,
        ]).catch(() => {})
      }
      finish(sawConnection)
    })
  })

  if (routeWorks === true) {
    log(`Device reached this machine at ${host} (checked for ${url})`)
    return true
  }
  if (routeWorks === false) {
    log(
      `Device could NOT reach this machine at ${host}. Expo Go cannot load the ` +
        `project over that route; flows would report tab-home missing.`
    )
    return false
  }
  log(`Device reachability probe could not run for ${host}`)
  return null
}

const getLocalAppUrl = (platform, port) => {
  const host =
    platform === 'android'
      ? androidHost
      : process.env.MOBILE_E2E_IOS_HOST || '127.0.0.1'
  return `exp://${host}:${port}/--/`
}

const getLocalApiUrl = (platform) => {
  const host =
    platform === 'android'
      ? androidHost
      : '127.0.0.1'
  return `http://${host}:4000`
}

const managedProcesses = new Map()

/**
 * Signal a managed process and every descendant it spawned.
 *
 * npm scripts add multiple wrapper processes around the actual Expo and API
 * servers. Starting each managed process in its own process group lets teardown
 * stop the entire tree instead of leaving a nested Node server alive.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {NodeJS.Signals} signal
 */
const signalManagedProcess = (child, signal) => {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return

  try {
    if (process.platform === 'win32') {
      child.kill(signal)
    } else {
      process.kill(-child.pid, signal)
    }
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

/**
 * Wait briefly for a managed process to exit.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
const waitForManagedProcessExit = (child, timeoutMs) =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true)
      return
    }

    const timeout = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timeout)
      resolve(true)
    }
    child.once('exit', onExit)
  })

/**
 * Stop a managed process tree with bounded, escalating signals.
 *
 * @param {import('node:child_process').ChildProcess | undefined} child
 * @param {string} label
 * @returns {Promise<void>}
 */
const stopManagedProcess = async (child, label) => {
  if (!child) return
  if (child.exitCode !== null || child.signalCode !== null) {
    managedProcesses.delete(child)
    return
  }

  try {
    for (const [signal, timeoutMs] of [
      ['SIGINT', 5_000],
      ['SIGTERM', 3_000],
      ['SIGKILL', 2_000],
    ]) {
      signalManagedProcess(child, signal)
      if (await waitForManagedProcessExit(child, timeoutMs)) return
    }

    throw new Error(`${label} process tree did not exit after SIGKILL`)
  } finally {
    managedProcesses.delete(child)
  }
}

let interruptCleanup
const handleTerminationSignal = (signal) => {
  if (interruptCleanup) return

  interruptCleanup = (async () => {
    log(`Received ${signal}; stopping managed process trees`)
    const results = await Promise.allSettled(
      [...managedProcesses].map(([child, label]) => stopManagedProcess(child, label))
    )
    const failures = results.filter((result) => result.status === 'rejected')
    for (const failure of failures) {
      console.error('[maestro:runner] Failed during interrupted cleanup', failure.reason)
    }
    process.exit(signal === 'SIGINT' ? 130 : 143)
  })()
}

process.once('SIGINT', () => handleTerminationSignal('SIGINT'))
process.once('SIGTERM', () => handleTerminationSignal('SIGTERM'))

/**
 * Poll an HTTP(S) endpoint until it stops returning a server error.
 *
 * In this script, "healthy enough" means the HTTP server is listening and able
 * to answer requests, not that a downstream client has loaded yet.
 *
 * @param {string} url
 * @param {number} [timeoutMs=120000]
 * @param {number} [intervalMs=2000]
 * @returns {Promise<void>}
 */
const waitForHealth = (url, timeoutMs = 120000, intervalMs = 2000) =>
  new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const deadline = Date.now() + timeoutMs

    const attempt = () => {
      const requester = urlObj.protocol === 'https:' ? httpsRequest : httpRequest
      const req = requester(urlObj, (res) => {
        res.resume()
        if ((res.statusCode ?? 500) < 500) {
          log(`Detected HTTP server at ${urlObj.href}`)
          resolve()
        } else if (Date.now() > deadline) {
          reject(new Error(`HTTP server not ready before timeout (${timeoutMs}ms)`))
        } else {
          setTimeout(attempt, intervalMs)
        }
      })

      req.on('error', (err) => {
        if (Date.now() > deadline) {
          reject(new Error(`Failed to reach HTTP server: ${err.message}`))
        } else {
          setTimeout(attempt, intervalMs)
        }
      })

      req.end()
    }

    attempt()
  })

const waitForProcessOutput = (child, expectedText, timeoutMs = 180000) =>
  new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(
      () => reject(new Error(`Process did not report readiness: ${expectedText}`)),
      timeoutMs
    )
    const inspect = (chunk, destination) => {
      destination.write(chunk)
      output = `${output}${chunk.toString()}`.slice(-4096)
      if (output.includes(expectedText)) {
        clearTimeout(timer)
        resolve()
      }
    }
    child.stdout?.on('data', (chunk) => inspect(chunk, process.stdout))
    child.stderr?.on('data', (chunk) => inspect(chunk, process.stderr))
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      if (!output.includes(expectedText)) {
        clearTimeout(timer)
        reject(new Error(`Process exited before readiness with code ${code}`))
      }
    })
  })

const requestJson = async (url, init) => {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => undefined)

  if (!response.ok) {
    throw new Error(
      `Mobile E2E setup request failed (${response.status} ${url}): ${JSON.stringify(body)}`
    )
  }

  return body
}

/**
 * Seed the one event `deep-link-handling.yaml` needs.
 *
 * That flow opens `?source=notification&type=severe_weather&alertId=alert-777`
 * and expects the Home screen to focus the matching alert. The app resolves the
 * target from `GET /api/v1/events/poll`, matching on the event id, so an
 * `alert:weather` envelope with exactly that id has to exist for the fixture
 * user. Nothing produced one: real envelopes come from the weather-alert fanout
 * worker, which needs a live alert to process, and `alert-777` was only ever a
 * fixture id in the mobile unit tests. The flow was asserting against data that
 * has never existed on a real server.
 *
 * Seeding it here rather than in `packages/db/prisma/seeds` keeps it attached to
 * the fixture user the runner creates and tears down, so it cannot leak into
 * another flow or outlive the run. The payload matches `alertWeatherEventSchema`
 * in `packages/api-client`; if that contract changes, `safeParse` in
 * `resolveWeatherAlertDeepLinkTarget` drops the event and this flow fails loudly.
 */
/**
 * The envelope id is per user, not a fixed literal.
 *
 * `alert-777` was a single hardcoded primary key, so two runners seeding at the
 * same time would `upsert` the same row and the second would re-own the first
 * shard's alert. `deep-link-handling.yaml` reads the id from `WEATHER_ALERT_ID`
 * rather than hardcoding it, for the same reason the capsule id became
 * per-user.
 *
 * @param {string} userId
 * @returns {string}
 */
const mobileE2EWeatherAlertId = (userId) => `alert-777-${userId}`

const seedMobileE2EWeatherAlert = async (identity) => {
  const prisma = new PrismaClient({ datasourceUrl: MOBILE_E2E_DATABASE_URL })
  try {
    const payload = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      userId: identity.userId,
      data: {
        alertType: 'severe',
        location: 'Chicago',
        message: 'Severe winter storm warning for the Chicago area.',
        severity: 'critical',
      },
    }

    await prisma.eventEnvelope.upsert({
      where: { id: mobileE2EWeatherAlertId(identity.userId) },
      update: { channel: 'alert:weather', payload, user_id: identity.userId },
      create: {
        id: mobileE2EWeatherAlertId(identity.userId),
        channel: 'alert:weather',
        payload,
        user_id: identity.userId,
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Give the fixture user a small wardrobe, through the real upload path.
 *
 * The capsule flows need garments to select and the fixture user owns none.
 * Garments only ever appeared because `garment-capture-flow` and
 * `garment-smart-tagging-flow` create them, and both sort AFTER
 * `garment-capsule-*` alphabetically, so in the suite's own stable order the
 * capsule builder always opened on "Garments (0 of 10 selected)" and reported
 * `garment-checkbox-.*` "not found" on a screen that was working perfectly.
 * That is exactly the sibling-ordering dependency this runner's flow-discovery
 * comment forbids.
 *
 * This deliberately drives the same three public endpoints the app itself uses
 * -- declare, upload bytes, commit -- rather than inserting `GarmentItem` rows
 * with Prisma. Inserting rows directly produced garments whose `object_path`
 * pointed at storage objects that did not exist, and `toResponse` in
 * `wardrobe.service.ts` signs a read URL for every garment with no fallback, so
 * `GET /api/v1/wardrobe/garments` answered 503 STORAGE_PERMISSION_DENIED for
 * the whole list. A fixture that cannot survive the app's own read path is not
 * a fixture, and weakening that signing behaviour to accommodate one would have
 * hidden a genuine failure mode.
 *
 * The bundled silhouette fixture is reused as the image: it is a real PNG and
 * clears the contract's 256px minimum.
 */
const MOBILE_E2E_GARMENT_COUNT = 4
// Members of the `GarmentCategory` enum in packages/db/prisma/schema.prisma.
const MOBILE_E2E_GARMENT_CATEGORIES = ['top', 'bottom', 'outerwear', 'shoes']
const MOBILE_E2E_GARMENT_FIXTURE =
  'apps/mobile/assets/images/silhouette-my-form-fixture.png'

const readPngDimensions = (bytes) => {
  if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Mobile E2E garment fixture is not a PNG')
  }
  return { widthPx: bytes.readUInt32BE(16), heightPx: bytes.readUInt32BE(20) }
}

/**
 * Poll the wardrobe list until a garment has left analysis.
 *
 * `awaiting_tags` means the worker has produced suggestions and the tags PATCH
 * will be accepted; `ready` means someone already confirmed them. Anything else
 * is still in flight.
 */
const waitForGarmentAnalysis = async (apiBaseUrl, authorization, garmentId) => {
  const deadline = Date.now() + 60_000
  let lastStatus = 'unknown'
  while (Date.now() < deadline) {
    const listed = await requestJson(`${apiBaseUrl}/api/v1/wardrobe/garments`, {
      headers: { authorization },
    })
    const garment = (listed?.data ?? []).find((item) => item?.id === garmentId)
    lastStatus = garment?.status ?? 'missing'
    if (lastStatus === 'awaiting_tags' || lastStatus === 'ready') {
      return lastStatus
    }
    if (lastStatus === 'failed') {
      throw new Error(`Mobile E2E garment ${garmentId} failed analysis`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(
    `Mobile E2E garment ${garmentId} never left analysis (last status: ${lastStatus})`
  )
}

const seedMobileE2EGarments = async (apiBaseUrl, identity) => {
  const createdGarmentIds = []
  const bytes = fs.readFileSync(path.join(projectRoot, MOBILE_E2E_GARMENT_FIXTURE))
  const { widthPx, heightPx } = readPngDimensions(bytes)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const authorization = `Bearer ${identity.accessToken}`

  for (let index = 0; index < MOBILE_E2E_GARMENT_COUNT; index += 1) {
    const session = await requestJson(`${apiBaseUrl}/api/v1/wardrobe/upload-url`, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({
        fileSizeBytes: bytes.length,
        mimeType: 'image/png',
        sha256,
        widthPx,
        heightPx,
      }),
    })

    const { garmentId, uploadSessionId, uploadToken } = session?.data ?? {}
    if (!garmentId || !uploadSessionId || !uploadToken) {
      throw new Error('Mobile E2E upload session response was missing fields')
    }

    const uploadResponse = await fetch(
      `${apiBaseUrl}/api/v1/wardrobe/uploads/${uploadSessionId}`,
      {
        method: 'PUT',
        headers: {
          authorization,
          'content-type': 'image/png',
          'x-upload-token': uploadToken,
        },
        body: bytes,
      }
    )
    if (!uploadResponse.ok) {
      throw new Error(
        `Mobile E2E garment upload failed (${uploadResponse.status} ${await uploadResponse.text()})`
      )
    }

    await requestJson(`${apiBaseUrl}/api/v1/wardrobe/garments`, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({
        garmentId,
        uploadSessionId,
        hasCropping: false,
        hasBgCleanup: false,
      }),
    })

    // Wait for analysis to finish before confirming tags.
    //
    // The commit kicks off the tagging worker, and `PATCH .../tags` answers 409
    // GARMENT_ANALYSIS_PENDING until it has produced suggestions. The mobile app
    // polls for exactly this (`pollGarmentUntilSettled`), so the seed does too
    // rather than sleeping a hopeful fixed interval.
    await waitForGarmentAnalysis(apiBaseUrl, authorization, garmentId)

    // Confirm tags, which is what moves a garment to `ready`.
    //
    // A committed-but-untagged garment is not "available": the capsule builder
    // treats it as removed and blocks the save with "N garments are no longer
    // available and have been removed. Choose replacements before saving."
    // Committing alone therefore produced a seeded capsule that could never be
    // saved. This is the same PATCH the tagging modal issues when a user
    // confirms the suggestions.
    await requestJson(`${apiBaseUrl}/api/v1/wardrobe/garments/${garmentId}/tags`, {
      method: 'PATCH',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        category:
          MOBILE_E2E_GARMENT_CATEGORIES[index % MOBILE_E2E_GARMENT_CATEGORIES.length],
        material: 'cotton',
        comfortRange: 'mild',
      }),
    })

    createdGarmentIds.push(garmentId)
  }

  return createdGarmentIds
}

/**
 * Give the fixture user one saved capsule.
 *
 * `garment-capsule-repair-flow` opens the capsule library and edits the first
 * capsule it finds. The fixture user has none: `garment-capsule-create-flow` is
 * the only flow that makes one, and it deletes it again through the UI as its
 * own cleanup, so the repair flow found an empty library and reported
 * `edit-capsule-button-.*` "not found" no matter which order the two ran in.
 *
 * Two garments, matching the flow's premise that a capsule holds a set it can
 * repair. Deleted with the user: `OutfitCapsule` and `OutfitCapsuleGarment`
 * both cascade from `User`, and the runner's teardown removes the user.
 */
/**
 * Namespaced per user, never a fixed constant.
 *
 * A shared id meant each run's upsert re-pointed the SAME capsule row at the new
 * fixture user while its existing `OutfitCapsuleGarment` rows still referenced
 * the previous user's garments. That join's foreign key is composite on
 * (garment_id, user_id), so re-owning the capsule orphaned them and the upsert
 * died on `OutfitCapsuleGarment_garment_id_user_id_fkey`. Per-user ids cannot
 * collide, and they are removed with the user by the existing cascade.
 */
const mobileE2ECapsuleId = (userId) => `mobile-e2e-capsule-${userId}`

const seedMobileE2ECapsule = async (identity, garmentIds) => {
  const capsuleId = mobileE2ECapsuleId(identity.userId)
  const prisma = new PrismaClient({ datasourceUrl: MOBILE_E2E_DATABASE_URL })
  try {
    await prisma.outfitCapsule.upsert({
      where: { id: capsuleId },
      update: {
        name: 'Maestro seeded capsule',
        user_id: identity.userId,
        occasions: ['casual'],
      },
      create: {
        id: capsuleId,
        user_id: identity.userId,
        name: 'Maestro seeded capsule',
        description: 'Seeded so the repair flow has a capsule to open.',
        // Required: `occasions` is a non-nullable `CapsuleOccasion[]`, so
        // omitting it is a null-constraint violation rather than an empty list.
        occasions: ['casual'],
      },
    })

    // Garments are read back from the database rather than taken from the API
    // responses. The join's foreign key is on (garment_id, user_id), so it can
    // only be satisfied by rows this connection can actually see -- reading them
    // back proves that, and fails loudly here rather than as an opaque FK
    // violation if the API ever wrote somewhere else.
    const ownedGarments = await prisma.garmentItem.findMany({
      where: { user_id: identity.userId, retention_status: 'active' },
      select: { id: true },
      orderBy: { created_at: 'asc' },
      take: 2,
    })
    if (ownedGarments.length < 2) {
      throw new Error(
        `Mobile E2E capsule seed expected 2 garments for ${identity.userId}, found ${ownedGarments.length}` +
          ` (seeded ids: ${garmentIds.join(', ') || 'none'})`
      )
    }

    for (const [index, garment] of ownedGarments.entries()) {
      const garmentId = garment.id
      await prisma.outfitCapsuleGarment.upsert({
        where: {
          capsule_id_garment_id: {
            capsule_id: capsuleId,
            garment_id: garmentId,
          },
        },
        update: { garment_order: index },
        create: {
          capsule_id: capsuleId,
          user_id: identity.userId,
          garment_id: garmentId,
          garment_order: index,
        },
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Return the fixture user to a known state before each flow.
 *
 * The suite runs eighteen flows sequentially against ONE signed-up user,
 * because `EXPO_PUBLIC_E2E_ACCESS_TOKEN` is baked into the Metro bundle at
 * startup. `clearState: true` in a flow clears the *device*, so anything the
 * app persisted server-side survives into the next flow, and the suite grows
 * hidden ordering dependencies that only bite when someone adds or reorders a
 * flow.
 *
 * The leak this closes: `WardrobeOnboardingState` advances as garments are
 * captured, and the onboarding screen reads `current_step` from the server to
 * decide which step to resume at. A flow that captured a garment therefore left
 * the next run of `wardrobe-onboarding-flow.yaml` opening past its own first
 * step, where it reported `onboarding-permission-step` "not found" — a stale
 * server row presenting as a missing element, which is why it read as a
 * selector bug for so long.
 *
 * Deliberately narrow. Garments are NOT reset here: `DELETE
 * /api/v1/wardrobe/garments/:id` is a retention request rather than a hard
 * delete, and `GarmentItem` has relations without `onDelete: Cascade`, so
 * clearing them between flows means either an asynchronous retention worker or
 * a hand-ordered cascade — neither of which belongs in a reset that runs
 * eighteen times per suite on an unproven hunch. Add to this only with a
 * failure that demonstrates the need.
 */
/**
 * Delete the app's persisted settings file from the iOS simulator.
 *
 * The chosen locale is written to `couture-cast-settings.json` in the
 * experience's document directory (`src/lib/settings-storage.ts`), and Maestro's
 * `clearState: true` does not remove it. So a flow that switches the app to
 * Turkish and then fails before its restore step leaves that file behind -- not
 * just for the next flow, but for every LATER RUN on the machine. It is why a
 * fresh run with a brand-new fixture user could open on a fully Turkish
 * settings screen and fail `sanity` on the word "Language".
 *
 * The user profile is not the culprit here: each run signs up a new user whose
 * profile locale is already the default. This file is device state, and it has
 * to be cleared device-side.
 *
 * iOS only, and deliberately best-effort: if the container cannot be resolved
 * there is nothing to clear and the run should continue rather than abort.
 */
const clearMobileE2EDeviceSettings = async () => {
  if (!isMac) return
  try {
    const dataContainer = await captureProcess(
      'xcrun',
      ['simctl', 'get_app_container', iosSimulatorUdid, 'host.exp.Exponent', 'data'],
      { timeoutMs: 5000 }
    )
    const root = dataContainer.stdout.trim()
    if (!root || !fs.existsSync(root)) return

    let removed = 0
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
        } else if (entry.name === 'couture-cast-settings.json') {
          fs.rmSync(full, { force: true })
          removed += 1
        }
      }
    }
    walk(root)
    if (removed > 0) {
      log(`Cleared ${removed} persisted device settings file(s) before the suite`)
    }
  } catch {
    // Best effort: a missing container just means there is nothing to clear.
  }
}

const resetMobileE2EPerFlowState = async (identity) => {
  const prisma = new PrismaClient({ datasourceUrl: MOBILE_E2E_DATABASE_URL })
  try {
    await prisma.wardrobeOnboardingState.deleteMany({
      where: { user_id: identity.userId },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Marker claim shared with `matchMobileE2EBypass` in
 * `apps/api/src/modules/auth/access-token-identity.service.ts`. Kept in sync by
 * hand: the API must not import a helper that manufactures bearer tokens.
 */
const MOBILE_E2E_TOKEN_MARKER = 'couturecast-mobile-e2e'

/**
 * Mint the bearer token the app under test runs as.
 *
 * This has to be JWT-*shaped*, not merely something the API accepts. The mobile
 * client derives the signed-in user id by decoding the token's `sub` claim
 * (`resolveOwnerUserId` in `apps/mobile/src/lib/wardrobe.ts`), because in
 * production the token is always a Supabase JWT. The harness used to inject
 * `test-token:guardian:<userId>`, which contains no `.` at all, so `split('.')`
 * yielded no payload segment and the decode threw. Every screen that needs the
 * signed-in user id -- the capsule library, the silhouette editor and the
 * wardrobe onboarding screen -- caught that and rendered "Your session token is
 * malformed. Sign in again." in place of its content. Because those screens
 * reuse one testID across their loading, error and ready states, the error
 * surfaced to Maestro as an element simply "not found" on a screen it had
 * already asserted it was on, which is why it read as six separate selector
 * bugs across six flows.
 *
 * The token is unsigned and is never verified as a JWT. The API matches it
 * through its existing `TEST_ENV`-gated bypass list, keyed on the `e2e` marker
 * claim.
 */
const buildMobileE2EAccessToken = (userId, role = 'guardian') => {
  const encodeSegment = (value) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  const header = encodeSegment({ alg: 'none', typ: 'JWT' })
  const payload = encodeSegment({ sub: userId, role, e2e: MOBILE_E2E_TOKEN_MARKER })
  return `${header}.${payload}.${MOBILE_E2E_TOKEN_MARKER}`
}

const setupMobileE2EIdentity = async (apiBaseUrl) => {
  const email = `mobile-e2e-${randomUUID()}@example.com`
  const signup = await requestJson(`${apiBaseUrl}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      birthdate: '2000-01-15',
    }),
  })
  const userId = signup?.userId
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('Mobile E2E signup did not return a userId')
  }

  const accessToken = buildMobileE2EAccessToken(userId)
  const authorization = `Bearer ${accessToken}`
  const identity = { accessToken, userId }

  try {
    await requestJson(`${apiBaseUrl}/api/v1/locations`, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        label: 'Chicago',
        locationKey: 'chicago-il',
        latitude: 41.878,
        longitude: -87.63,
        timezone: 'America/Chicago',
        city: 'Chicago',
        region: 'Illinois',
        country: 'United States',
      }),
    })

    await requestJson(`${apiBaseUrl}/api/v1/ritual?locale=en-US`, {
      headers: { authorization },
    })

    await seedMobileE2EWeatherAlert(identity)
    const garmentIds = await seedMobileE2EGarments(apiBaseUrl, identity)
    await seedMobileE2ECapsule(identity, garmentIds)

    return identity
  } catch (error) {
    try {
      await cleanupMobileE2EIdentity(apiBaseUrl, identity)
    } catch (cleanupError) {
      console.error('[maestro:runner] Failed to clean partial mobile E2E identity')
      console.error(cleanupError)
    }
    throw error
  }
}

const cleanupMobileE2EIdentity = async (apiBaseUrl, identity) => {
  if (!identity) return

  const authorization = `Bearer ${identity.accessToken}`
  const wardrobeResponse = await fetch(`${apiBaseUrl}/api/v1/wardrobe/garments`, {
    headers: { authorization },
  })
  if (wardrobeResponse.ok) {
    const wardrobe = await wardrobeResponse.json()
    const garments = Array.isArray(wardrobe?.data) ? wardrobe.data : []
    for (const garment of garments) {
      if (typeof garment?.id !== 'string') continue
      const deletionResponse = await fetch(
        `${apiBaseUrl}/api/v1/wardrobe/garments/${garment.id}`,
        { method: 'DELETE', headers: { authorization } }
      )
      if (deletionResponse.status !== 204) {
        throw new Error(
          `Mobile E2E garment cleanup failed (${deletionResponse.status} ${garment.id})`
        )
      }
    }
  }

  const prisma = new PrismaClient({ datasourceUrl: MOBILE_E2E_DATABASE_URL })

  try {
    await prisma.$transaction(async (tx) => {
      const garments = await tx.garmentItem.findMany({
        where: { user_id: identity.userId },
        select: { id: true },
      })
      const garmentIds = garments.map((garment) => garment.id)
      const posts = await tx.lookbookPost.findMany({
        where: { user_id: identity.userId },
        select: { id: true },
      })
      const postIds = posts.map((post) => post.id)

      await tx.moderationEvent.deleteMany({
        where: {
          OR: [
            { flagged_by_id: identity.userId },
            { reviewed_by_id: identity.userId },
            { garment_item_id: { in: garmentIds } },
            { post_id: { in: postIds } },
          ],
        },
      })
      await tx.eventEnvelope.deleteMany({ where: { user_id: identity.userId } })
      await tx.telemetryEvent.deleteMany({
        where: {
          OR: [
            { user_id: identity.userId },
            ...garmentIds.map((garmentId) => ({
              properties: { path: ['garment_id'], equals: garmentId },
            })),
          ],
        },
      })
      await tx.engagementEvent.deleteMany({ where: { user_id: identity.userId } })
      await tx.lookbookPost.deleteMany({ where: { user_id: identity.userId } })
      await tx.pushToken.deleteMany({ where: { user_id: identity.userId } })
      await tx.alertRule.deleteMany({ where: { user_id: identity.userId } })
      await tx.notificationPreference.deleteMany({
        where: { user_id: identity.userId },
      })
      await tx.savedLocation.deleteMany({ where: { user_id: identity.userId } })
      await tx.outfitRecommendation.deleteMany({ where: { user_id: identity.userId } })
      await tx.paletteInsights.deleteMany({ where: { user_id: identity.userId } })
      await tx.garmentItem.deleteMany({ where: { user_id: identity.userId } })
      await tx.comfortPreferences.deleteMany({ where: { user_id: identity.userId } })
      await tx.userProfile.deleteMany({ where: { user_id: identity.userId } })

      await tx.$executeRawUnsafe('SAVEPOINT maestro_audit_cleanup')
      let canDeleteImmutableAuditRows = false
      try {
        await tx.$executeRaw`SET LOCAL session_replication_role = 'replica'`
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT maestro_audit_cleanup')
        canDeleteImmutableAuditRows = true
      } catch {
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT maestro_audit_cleanup')
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT maestro_audit_cleanup')
        console.warn(
          '[maestro:runner] Database role cannot disable audit triggers; immutable audit rows and the linked user were retained'
        )
      }
      if (canDeleteImmutableAuditRows) {
        await tx.auditLog.deleteMany({ where: { user_id: identity.userId } })
        await tx.user.deleteMany({ where: { id: identity.userId } })
      }
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Poll an async condition until it returns true or the timeout expires.
 *
 * We use this after Metro is up because Expo Go installation/launch can lag
 * behind server readiness, especially on iOS simulator fallback.
 *
 * @param {() => Promise<boolean>} condition
 * @param {number} [timeoutMs=60000]
 * @param {number} [intervalMs=2000]
 * @returns {Promise<boolean>}
 */
const waitForCondition = async (condition, timeoutMs = 60000, intervalMs = 2000) => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    if (await condition()) {
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  return false
}

/**
 * @typedef {object} SpawnProcessOptions
 * @property {number} [timeoutMs]
 * @property {AbortSignal} [signal]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string} [cwd]
 * @property {string} [logFile]
 */

/**
 * Spawn a child process and stream its stdio to the current terminal.
 *
 * This is used for commands where the live output is part of the debugging
 * story, such as Expo startup and Maestro execution.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {SpawnProcessOptions} [options]
 * @returns {Promise<void>}
 */
const spawnProcess = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const { timeoutMs, signal, logFile, ...spawnOptions } = options
    let logStream
    if (logFile) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true })
      logStream = fs.createWriteStream(logFile, { flags: 'w' })
      logStream.write(`\n$ ${command} ${args.join(' ')}\n`)
    }
    const child = spawn(command, args, {
      stdio: logFile ? ['inherit', 'pipe', 'pipe'] : 'inherit',
      ...spawnOptions,
    })
    let timedOut = false
    const timeout =
      typeof timeoutMs === 'number'
        ? setTimeout(() => {
            timedOut = true
            child.kill('SIGINT')
          }, timeoutMs)
        : null

    if (logFile && child.stdout && child.stderr && logStream) {
      child.stdout.on('data', (data) => {
        process.stdout.write(data)
        logStream.write(data)
      })
      child.stderr.on('data', (data) => {
        process.stderr.write(data)
        logStream.write(data)
      })
    }

    const finish = (callback) => {
      if (logStream) {
        logStream.end(callback)
        return
      }
      callback()
    }

    child.on('exit', (code) => {
      if (timeout) clearTimeout(timeout)
      if (timedOut) {
        finish(() => reject(new Error(`${command} timed out after ${timeoutMs}ms`)))
        return
      }
      if (code === 0) {
        finish(resolve)
      } else {
        const error = new Error(`${command} exited with code ${code}`)
        error.code = code
        finish(() => reject(error))
      }
    })
    child.on('error', (err) => {
      if (timeout) clearTimeout(timeout)
      finish(() => reject(err))
    })
    if (signal) {
      signal.addEventListener('abort', () => child.kill('SIGINT'))
    }
  })

/**
 * Spawn a child process and capture stdout/stderr instead of inheriting it.
 *
 * This is useful for small system checks where we need to inspect the answer in
 * code, such as `adb devices` or `xcrun simctl list`.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {SpawnProcessOptions} [options]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
const captureProcess = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const { timeoutMs, ...spawnOptions } = options
    const child = spawn(command, args, {
      ...spawnOptions,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timeout =
      typeof timeoutMs === 'number'
        ? setTimeout(() => {
            timedOut = true
            child.kill('SIGINT')
          }, timeoutMs)
        : null
    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    child.on('exit', (code) => {
      if (timeout) clearTimeout(timeout)
      if (timedOut) {
        reject(new Error(`${command} timed out after ${timeoutMs}ms`))
        return
      }
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        const err = new Error(`${command} exited with code ${code}`)
        err.stdout = stdout
        err.stderr = stderr
        reject(err)
      }
    })
    child.on('error', (err) => {
      if (timeout) clearTimeout(timeout)
      reject(err)
    })
  })

/**
 * Check whether an attached Android device/emulator is ready for Expo Go.
 *
 * Return value meaning:
 * - `installed`: Android target exists and Expo Go is already present.
 * - `missing`: Android target exists but Expo Go must be installed first.
 * - `no-device`: no usable Android target was detected, so iOS fallback may run.
 *
 * @returns {Promise<'installed' | 'missing' | 'no-device'>}
 */
const ensureExpoGoOnAndroid = async () => {
  const sdkRoot =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(process.env.HOME ?? '', 'Library', 'Android', 'sdk')
  const adbBinary =
    process.env.ADB_PATH ||
    (sdkRoot && fs.existsSync(path.join(sdkRoot, 'platform-tools', 'adb'))
      ? path.join(sdkRoot, 'platform-tools', 'adb')
      : 'adb')

  if (sdkRoot && fs.existsSync(sdkRoot)) {
    process.env.PATH = `${path.join(sdkRoot, 'platform-tools')}:${path.join(sdkRoot, 'emulator')}:${process.env.PATH}`
  }

  try {
    const devices = await captureProcess(adbBinary, ['devices'])
    if (!/device\s*$/m.test(devices.stdout.trim())) {
      log('No Android device detected for Expo Go install')
      return 'no-device'
    }
  } catch {
    log('adb not available; skipping Expo Go install check')
    return 'no-device'
  }

  try {
    const packages = await captureProcess(adbBinary, [
      'shell',
      'pm',
      'list',
      'packages',
      'host.exp.exponent',
    ])
    if (packages.stdout.includes('host.exp.exponent')) {
      const packageInfo = await captureProcess(adbBinary, [
        'shell',
        'dumpsys',
        'package',
        'host.exp.exponent',
      ])
      const installedVersion = packageInfo.stdout.match(/versionName=([^\s]+)/)?.[1]
      if (installedVersion === EXPECTED_EXPO_GO_VERSION) {
        log(`Expo Go ${installedVersion} already installed on Android emulator/device`)
        return 'installed'
      }

      log(
        `Expo Go ${installedVersion ?? 'unknown'} found; expected ${EXPECTED_EXPO_GO_VERSION}`
      )
    } else {
      log('Expo Go not found on Android emulator/device')
    }
  } catch {
    log('Unable to verify Expo Go version on Android emulator/device')
  }

  if (process.env.MOBILE_E2E_AUTO_INSTALL_EXPO_GO !== '0') {
    log('Attempting to install Expo Go on the connected Android target')
    await spawnProcess('node', ['./scripts/install-expo-go.mjs'], {
      cwd: projectRoot,
      timeoutMs: 180_000,
    })

    try {
      const packages = await captureProcess(adbBinary, [
        'shell',
        'pm',
        'list',
        'packages',
        'host.exp.exponent',
      ])
      if (packages.stdout.includes('host.exp.exponent')) {
        const packageInfo = await captureProcess(adbBinary, [
          'shell',
          'dumpsys',
          'package',
          'host.exp.exponent',
        ])
        const installedVersion = packageInfo.stdout.match(/versionName=([^\s]+)/)?.[1]
        if (installedVersion === EXPECTED_EXPO_GO_VERSION) {
          log(`Expo Go ${installedVersion} installed on Android emulator/device`)
          return 'installed'
        }
        log(
          `Expo Go install finished, but version is ${installedVersion ?? 'unknown'}; expected ${EXPECTED_EXPO_GO_VERSION}`
        )
      }
    } catch {
      // fall through to the explicit missing state
    }
  }

  return 'missing'
}

const bootAndroidTarget = async () => {
  if (!AUTO_BOOT_ANDROID) {
    return
  }

  log('No Android target detected. Attempting to boot an Android emulator.')
  await spawnProcess('bash', ['./scripts/start-android-emulator.sh'], {
    cwd: projectRoot,
    timeoutMs: 180_000,
  })
}

/**
 * Detect whether any iOS simulator is already booted.
 *
 * @returns {Promise<boolean>}
 */
const hasBootedIosSimulator = async () => {
  if (!isMac) return false

  try {
    const result = await captureProcess(
      'xcrun',
      ['simctl', 'list', 'devices', 'booted'],
      {
        timeoutMs: 5000,
      }
    )
    // A shard is pinned to one simulator, and "some device is booted" is not
    // the question it needs answered: three sibling shards each boot their own.
    if (iosSimulatorUdid !== 'booted') {
      return result.stdout.includes(iosSimulatorUdid)
    }
    return /\(Booted\)/.test(result.stdout)
  } catch {
    return false
  }
}

const ensureIosSimulatorTooling = async () => {
  if (!isMac) {
    throw new Error('iOS Maestro runs require macOS with Xcode Simulator installed.')
  }

  let runtimes
  try {
    runtimes = await captureProcess('xcrun', ['simctl', 'list', 'runtimes', '-j'], {
      timeoutMs: 5_000,
    })
  } catch {
    throw new Error(
      'Xcode Simulator is not responding to `xcrun simctl list runtimes -j`. Install/repair an iOS Simulator runtime in Xcode before running `npm run test:mobile:e2e:ios`.'
    )
  }

  try {
    const parsed = JSON.parse(runtimes.stdout)
    const availableRuntimes = Array.isArray(parsed.runtimes)
      ? parsed.runtimes.filter((runtime) => runtime?.isAvailable !== false)
      : []
    if (availableRuntimes.length === 0) {
      throw new Error('missing runtimes')
    }
  } catch {
    throw new Error(
      'No available iOS Simulator runtime was found. Install one in Xcode Settings > Platforms before running `npm run test:mobile:e2e:ios`.'
    )
  }
}

/**
 * Read the Expo Go version installed on the booted iOS simulator.
 *
 * @returns {Promise<string | null>}
 */
const getInstalledExpoGoVersionOnIos = async () => {
  if (!isMac) return null

  try {
    const appContainer = await captureProcess(
      'xcrun',
      ['simctl', 'get_app_container', iosSimulatorUdid, 'host.exp.Exponent', 'app'],
      { timeoutMs: 5000 }
    )
    const version = await captureProcess(
      '/usr/libexec/PlistBuddy',
      [
        '-c',
        'Print :CFBundleShortVersionString',
        path.join(appContainer.stdout.trim(), 'Info.plist'),
      ],
      { timeoutMs: 5000 }
    )
    return version.stdout.trim() || null
  } catch {
    return null
  }
}

/**
 * Install the SDK-compatible Expo Go build on the booted iOS simulator.
 *
 * Expo CLI normally prompts before replacing an old simulator build. Local E2E
 * runs are non-interactive, so resolve the same release metadata Expo uses,
 * download its simulator app, and install it before Metro starts.
 *
 * @returns {Promise<boolean>}
 */
const ensureExpoGoOnIos = async () => {
  if (!isMac) return false

  const expoGoUtilsPath = path.join(
    projectRoot,
    'node_modules/@expo/cli/build/src/utils/downloadExpoGoAsync.js'
  )
  let expoGoUtils
  try {
    // Expo CLI does not currently export a supported simulator-download API.
    // Keep this dependency guarded so an Expo upgrade fails with an actionable
    // message instead of a bare MODULE_NOT_FOUND or response-shape error.
    expoGoUtils = require(expoGoUtilsPath)
  } catch (cause) {
    throw new Error(
      `Expo SDK ${EXPO_SDK_VERSION} no longer exposes the iOS Expo Go installer used by local E2E. Update ensureExpoGoOnIos in scripts/run-maestro.mjs for the installed @expo/cli version.`,
      { cause }
    )
  }
  const { downloadExpoGoAsync, getExpoGoVersionEntryAsync } = expoGoUtils
  if (
    typeof downloadExpoGoAsync !== 'function' ||
    typeof getExpoGoVersionEntryAsync !== 'function'
  ) {
    throw new Error(
      `The installed @expo/cli does not provide the expected Expo Go download functions for SDK ${EXPO_SDK_VERSION}. Update ensureExpoGoOnIos in scripts/run-maestro.mjs.`
    )
  }
  const release = await getExpoGoVersionEntryAsync(EXPO_SDK_VERSION)
  if (
    !release ||
    typeof release.iosClientUrl !== 'string' ||
    typeof release.iosClientVersion !== 'string'
  ) {
    throw new Error(
      `Expo returned incomplete iOS Expo Go metadata for SDK ${EXPO_SDK_VERSION}. Set MOBILE_E2E_IOS_EXPO_GO_VERSION after updating the local installer integration.`
    )
  }
  const expectedVersion =
    process.env.MOBILE_E2E_IOS_EXPO_GO_VERSION || release.iosClientVersion
  const installedVersion = await getInstalledExpoGoVersionOnIos()

  if (installedVersion === expectedVersion) {
    log(`Expo Go ${installedVersion} already installed on the iOS simulator`)
    return true
  }

  log(
    installedVersion
      ? `Expo Go ${installedVersion} found on iOS; expected ${expectedVersion}`
      : 'Expo Go not found on the booted iOS simulator'
  )
  const binaryPath = await downloadExpoGoAsync('ios', {
    sdkVersion: EXPO_SDK_VERSION,
    url: release.iosClientUrl,
  })
  log(`Installing Expo Go ${expectedVersion} on the booted iOS simulator`)
  await spawnProcess('xcrun', ['simctl', 'install', iosSimulatorUdid, binaryPath], {
    timeoutMs: 120_000,
  })

  const verifiedVersion = await getInstalledExpoGoVersionOnIos()
  if (verifiedVersion !== expectedVersion) {
    throw new Error(
      `Expo Go install finished, but iOS reports ${verifiedVersion ?? 'no version'}; expected ${expectedVersion}.`
    )
  }

  log(`Expo Go ${verifiedVersion} installed on the iOS simulator`)
  return true
}

/**
 * Resolve the explicit mobile target that Maestro should drive.
 *
 * @returns {Promise<{ platform: 'android' | 'ios', appId: string, expoGoReady: boolean }>}
 */
const resolveTarget = async () => {
  if (REQUESTED_PLATFORM !== 'android' && REQUESTED_PLATFORM !== 'ios') {
    throw new Error(
      'Choose a mobile platform explicitly: `npm run test:mobile:e2e:android` or `npm run test:mobile:e2e:ios`.'
    )
  }

  if (REQUESTED_PLATFORM === 'android') {
    let expoGoStatus = await ensureExpoGoOnAndroid()
    if (expoGoStatus === 'no-device') {
      await bootAndroidTarget()
      expoGoStatus = await ensureExpoGoOnAndroid()
    }

    if (expoGoStatus === 'installed') {
      return { platform: 'android', appId: 'host.exp.exponent', expoGoReady: true }
    }

    if (expoGoStatus === 'missing') {
      throw new Error(
        'Expo Go is not installed on the Android emulator/device and automatic install failed. Boot the emulator and run `npm run mobile:expo-go`, then rerun `npm run test:mobile:e2e:android`.'
      )
    }

    throw new Error(
      'No Android emulator/device is available. Create an AVD or set `AVD_NAME`, then rerun `npm run test:mobile:e2e:android`.'
    )
  }

  await ensureIosSimulatorTooling()

  if (PARALLEL_DEVICES) {
    // Every device has to be booted and carrying Expo Go before Maestro starts,
    // because Maestro is handed the whole device list at once.
    let expoGoReady = true
    for (const udid of IOS_UDIDS) {
      iosSimulatorUdid = udid
      if (!(await hasBootedIosSimulator())) {
        log(`Booting simulator ${udid}`)
        await spawnProcess('xcrun', ['simctl', 'boot', udid], {
          timeoutMs: 120_000,
        }).catch(() => {
          // `simctl boot` exits non-zero when the device is already booted.
        })
        await waitForCondition(hasBootedIosSimulator, 120_000, 1_000)
      }
      expoGoReady = (await ensureExpoGoOnIos()) && expoGoReady
    }
    iosSimulatorUdid = IOS_UDIDS[0]
    log(`Using ${IOS_UDIDS.length} iOS simulators for a parallel Maestro run`)
    return { platform: 'ios', appId: 'host.exp.Exponent', expoGoReady }
  }

  if (await hasBootedIosSimulator()) {
    const expoGoReady = await ensureExpoGoOnIos()
    log('Using booted iOS simulator for Maestro run')
    return { platform: 'ios', appId: 'host.exp.Exponent', expoGoReady }
  }

  log('No iOS simulator detected. Attempting to boot an iOS simulator.')
  if (iosSimulatorUdid === 'booted') {
    await spawnProcess('bash', ['./scripts/start-ios-simulator.sh'], {
      timeoutMs: 60_000,
    })
  } else {
    // The shard owns a specific device; `start-ios-simulator.sh` boots whatever
    // the default device name resolves to, which is another shard's simulator.
    log(`Booting pinned simulator ${iosSimulatorUdid}`)
    await spawnProcess('xcrun', ['simctl', 'boot', iosSimulatorUdid], {
      timeoutMs: 120_000,
    }).catch(() => {
      // `simctl boot` exits non-zero when the device is already booted.
    })
    await waitForCondition(hasBootedIosSimulator, 120_000, 1_000)
  }

  if (await hasBootedIosSimulator()) {
    const expoGoReady = await ensureExpoGoOnIos()
    log('Booted iOS simulator for Maestro run')
    return { platform: 'ios', appId: 'host.exp.Exponent', expoGoReady }
  }

  throw new Error(
    'No iOS simulator is available. Ensure Xcode Simulator has an installed runtime/device, then rerun `npm run test:mobile:e2e:ios`.'
  )
}

/**
 * Wrapper kept for readability at the call site.
 *
 * @returns {ReturnType<typeof resolveTarget>}
 */
const ensureMaestroTarget = async () => {
  return resolveTarget()
}

/**
 * Look up a simulator's name from its UDID.
 *
 * The name is the key the app matches on: `mobile-auth.ts` reads
 * `Constants.deviceName` and finds its own entry in the token map.
 *
 * @param {string} udid
 * @returns {Promise<string>}
 */
const getSimulatorName = async (udid) => {
  const result = await captureProcess('xcrun', ['simctl', 'list', 'devices', '-j'], {
    timeoutMs: 15_000,
  })
  const parsed = JSON.parse(result.stdout)
  for (const devices of Object.values(parsed.devices ?? {})) {
    for (const device of devices) {
      if (device?.udid === udid && typeof device?.name === 'string') {
        return device.name
      }
    }
  }
  throw new Error(`No simulator found for UDID ${udid}`)
}

/**
 * Read which flows a JUnit report recorded as passed and failed.
 *
 * The report is the authority on a sharded run, not the exit code. Maestro
 * 2.0.10 has been observed exiting 0 from a `--shard-split` invocation whose own
 * summary said `Passed: 16/17` and whose report carried `failures="1"`. A runner
 * that trusts the exit code turns that into a green suite, which is the exact
 * hollow green this harness exists to prevent.
 *
 * Names here are flow titles (the `name:` inside the flow), not file names.
 *
 * @param {string} reportPath
 * @returns {{ passed: string[], failed: string[] }}
 */
const readSuiteReport = (reportPath) => {
  try {
    const xml = fs.readFileSync(path.resolve(projectRoot, reportPath), 'utf8')
    const passed = []
    const failed = []
    for (const segment of xml.split('<testcase').slice(1)) {
      const name = /name="([^"]+)"/.exec(segment)?.[1]
      if (!name) continue
      if (segment.includes('<failure')) failed.push(name)
      else passed.push(name)
    }
    return { passed, failed }
  } catch {
    return { passed: [], failed: [] }
  }
}

/**
 * Kill iOS driver processes left behind by an earlier run.
 *
 * Maestro's iOS driver listens on a fixed host port. A driver that outlived its
 * run keeps that port, and the next run's first flow dies with
 * `Failed to connect to /127.0.0.1:7001` -- a failure that looks exactly like a
 * flaky device and was recorded as one twice before it was traced here.
 *
 * @returns {Promise<void>}
 */
const killStaleIosDrivers = async () => {
  if (!isMac) return
  for (const pattern of [
    'maestro-driver-iosUITests-Runner',
    'maestro-driver-ios-config.xctestrun',
  ]) {
    await spawnProcess('pkill', ['-f', pattern], { timeoutMs: 5_000 }).catch(() => {
      // `pkill` exits non-zero when nothing matched, which is the normal case.
    })
  }
}

/**
 * Build the JavaScript bundle before the first flow runs.
 *
 * Metro answers its health check as soon as it is listening, long before it can
 * serve a bundle. A serial run hid that: `expo start --ios` opens the app on the
 * simulator during setup, so the cold bundle was already paid for by the time
 * Maestro started. Sharded runs do not open the app that way -- with four
 * simulators booted, Expo CLI would open it on whichever one it resolved first
 * -- so the cold build landed inside the first flow instead, and
 * `analytics.yaml` failed on `tab-home` after 3m28s having never mounted.
 *
 * Requesting the bundle over HTTP is the deterministic fix: the response does
 * not arrive until the bundle is built, so there is nothing to guess about.
 * Best-effort by design. If Expo changes its entry path this logs and continues
 * rather than failing a suite over a warm-up.
 *
 * @param {string} healthUrl
 * @param {'android' | 'ios'} platform
 * @returns {Promise<void>}
 */
const warmMetroBundle = async (healthUrl, platform) => {
  const bundleUrl =
    `${healthUrl.replace(/\/$/, '')}/node_modules/expo-router/entry.bundle` +
    `?platform=${platform}&dev=true&hot=false`
  const startedAt = Date.now()
  try {
    const response = await fetch(bundleUrl, {
      signal: AbortSignal.timeout(300_000),
    })
    if (!response.ok) {
      log(`Metro warm-up returned ${response.status}; continuing without it`)
      return
    }
    // The body has to be drained for Metro to consider the build served.
    const bytes = (await response.arrayBuffer()).byteLength
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    log(`Metro bundle warm (${Math.round(bytes / 1024 / 1024)}MB in ${seconds}s)`)
  } catch (error) {
    log(`Metro warm-up failed (${error.message}); continuing without it`)
  }
}

/**
 * Run Maestro from the local installation when available, otherwise fall back
 * to `npx maestro@latest`.
 *
 * @param {string[]} args
 * @param {SpawnProcessOptions} [options]
 * @returns {Promise<void>}
 */
const runMaestroCommand = async (args, options = {}) => {
  try {
    await spawnProcess('maestro', args, options)
  } catch (err) {
    if (err.code === 'ENOENT') {
      log('System maestro command missing, retrying via npx maestro@latest')
      await spawnProcess('npx', ['--yes', 'maestro@latest', ...args], options)
    } else {
      throw err
    }
  }
}

/**
 * End-to-end runner for the mobile smoke flow.
 *
 * High-level order:
 * 1) choose a Metro port,
 * 2) resolve a mobile target,
 * 3) start or reuse the local API and create an authenticated fixture,
 * 4) start or reuse Expo,
 * 5) wait until Expo Go is actually usable,
 * 6) run Maestro,
 * 7) stop local processes on the way out.
 *
 * @returns {Promise<void>}
 */
const run = async () => {
  await killStaleIosDrivers()
  const metroPort = await chooseMetroPort()
  process.env.MOBILE_E2E_METRO_PORT = String(metroPort)
  const target = await ensureMaestroTarget()
  const apiHealthUrl = 'http://127.0.0.1:4000/api/health'
  const apiSetupBaseUrl = 'http://127.0.0.1:4000'
  const mobileApiBaseUrl = getLocalApiUrl(target.platform)
  let apiProcess
  let workerProcess
  let mobileIdentity
  /** @type {{ accessToken: string, userId: string }[]} */
  const mobileIdentities = []

  try {
    if (process.env.MOBILE_E2E_SKIP_API !== '1') {
      let apiAlreadyRunning = false
      try {
        await waitForHealth(apiHealthUrl, 2_000, 250)
        apiAlreadyRunning = true
      } catch {
        apiAlreadyRunning = false
      }

      if (apiAlreadyRunning) {
        log(`Detected existing local API at ${apiHealthUrl}, reusing it`)
        if (SKIP_WORKER) {
          log('Skipping wardrobe worker start (MOBILE_E2E_SKIP_WORKER=1)')
        } else {
          workerProcess = spawn(
            'npm',
            ['run', 'start:workers:wardrobe', '--workspace', 'api'],
            {
              cwd: projectRoot,
              detached: process.platform !== 'win32',
              stdio: ['inherit', 'pipe', 'pipe'],
              env: {
                ...process.env,
                DATABASE_URL: MOBILE_E2E_DATABASE_URL,
                GARMENT_TAGGING_ENGINE: 'fixture',
                TEST_ENV: 'local',
              },
            }
          )
          managedProcesses.set(workerProcess, 'Wardrobe worker')
          await waitForProcessOutput(workerProcess, 'Dedicated wardrobe worker started')
        }
      } else {
        log('Starting local API for mobile E2E')
        apiProcess = spawn('npm', ['run', 'start:api:e2e-with-workers'], {
          cwd: projectRoot,
          detached: process.platform !== 'win32',
          stdio: 'inherit',
          env: {
            ...process.env,
            ALLOW_DEV_GUARDIAN_SECRET: 'true',
            DATABASE_URL: MOBILE_E2E_DATABASE_URL,
            GUARDIAN_INVITE_WEB_BASE_URL: 'http://127.0.0.1:3005',
            GARMENT_TAGGING_ENGINE: 'fixture',
            PUBLIC_API_URL: process.env.MOBILE_E2E_PUBLIC_API_URL || mobileApiBaseUrl,
            TEST_ENV: 'local',
          },
        })
        managedProcesses.set(apiProcess, 'Local API')
        apiProcess.on('exit', (code) => {
          if (code !== null && code !== 0) {
            console.error(`[maestro:runner] Local API exited early with code ${code}`)
          }
        })
        await waitForHealth(apiHealthUrl, 180_000, 1_000)
        log(`Local API reachable on ${apiHealthUrl}`)
      }

      if (PARALLEL_DEVICES) {
        // One fixture user per simulator. The bundle carries the whole map and
        // each device selects its own entry in `mobile-auth.ts`, because a
        // single Metro bundle cannot hold a different token per device.
        const tokensByDeviceName = {}
        for (const udid of IOS_UDIDS) {
          iosSimulatorUdid = udid
          await clearMobileE2EDeviceSettings()
          const identity = await setupMobileE2EIdentity(apiSetupBaseUrl)
          const deviceName = await getSimulatorName(udid)
          tokensByDeviceName[deviceName] = identity.accessToken
          mobileIdentities.push(identity)
          log(`Created authenticated mobile E2E fixture for ${deviceName}`)
        }
        iosSimulatorUdid = IOS_UDIDS[0]
        mobileIdentity = mobileIdentities[0]
        process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE =
          JSON.stringify(tokensByDeviceName)
      } else {
        await clearMobileE2EDeviceSettings()
        mobileIdentity = await setupMobileE2EIdentity(apiSetupBaseUrl)
        mobileIdentities.push(mobileIdentity)
        log('Created authenticated mobile E2E fixture')
      }
      process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN = mobileIdentity.accessToken
      process.env.EXPO_PUBLIC_API_BASE_URL = mobileApiBaseUrl
      process.env.WEATHER_ALERT_ID = mobileE2EWeatherAlertId(mobileIdentity.userId)
    } else if (!process.env.EXPO_PUBLIC_API_BASE_URL) {
      throw new Error(
        'MOBILE_E2E_SKIP_API=1 requires EXPO_PUBLIC_API_BASE_URL and an externally managed test identity.'
      )
    }
  } catch (error) {
    await stopManagedProcess(workerProcess, 'Wardrobe worker')
    await stopManagedProcess(apiProcess, 'Local API')
    throw error
  }

  // Before any URL is handed to the device, give it a route to the host. Both
  // candidate Metro ports are mapped because the pair list below falls back
  // from the chosen port to 8081.
  if (target.platform === 'android') {
    await reverseAndroidPorts([...new Set([metroPort, 8081, 4000])])
  }

  // Maestro needs both an app URL and a health URL. We probe the explicit env
  // override first, then the chosen Metro port, then the default Expo port.
  const portPairs = [
    {
      app: process.env.MOBILE_E2E_APP_URL,
      health: process.env.MOBILE_E2E_HEALTH_URL,
    },
    {
      app: getLocalAppUrl(target.platform, metroPort),
      health: `http://127.0.0.1:${metroPort}`,
    },
    {
      app: getLocalAppUrl(target.platform, 8081),
      health: 'http://127.0.0.1:8081',
    },
  ].filter((pair, index, self) => {
    if (!pair.app || !pair.health) {
      return false
    }
    const key = `${pair.app}-${pair.health}`
    return self.findIndex((p) => `${p.app}-${p.health}` === key) === index
  })

  let serverProcess
  let resolvedPair
  let startServer = START_SERVER

  if (startServer) {
    for (const pair of portPairs) {
      try {
        await waitForHealth(pair.health, 5_000, 500)
        log(`Detected existing Expo dev server at ${pair.health}, reusing it`)
        resolvedPair = pair
        startServer = false
        break
      } catch {
        // keep checking
      }
    }
  }
  try {
    if (startServer) {
      log(`Starting Expo dev server for mobile smoke (metro port ${metroPort})`)
      serverProcess = spawn('npm', ['run', 'start:mobile:server'], {
        detached: process.platform !== 'win32',
        stdio: 'inherit',
        env: {
          ...process.env,
          MOBILE_E2E_PLATFORM: target.platform,
        },
      })
      managedProcesses.set(serverProcess, 'Expo dev server')
      serverProcess.on('exit', (code) => {
        if (code !== null && code !== 0) {
          console.error(`[maestro:runner] Expo dev server exited early with code ${code}`)
        }
      })
      for (const pair of portPairs) {
        try {
          await waitForHealth(pair.health)
          resolvedPair = pair
          log(`Expo dev server reachable on ${pair.health}`)
          break
        } catch {
          // try next candidate
        }
      }
      if (!resolvedPair) {
        throw new Error(
          `Expo dev server never became healthy. Tried: ${portPairs.map((p) => p.health).join(', ')}`
        )
      }
    } else {
      log('Skipping Expo dev server start (MOBILE_E2E_SKIP_SERVER=1)')
      resolvedPair = portPairs[0]
      if (!resolvedPair) {
        throw new Error(
          'No MOBILE_E2E_APP_URL / MOBILE_E2E_HEALTH_URL provided while server skip is enabled'
        )
      }
    }

    if (!resolvedPair) {
      resolvedPair = portPairs[0]
      if (!resolvedPair) {
        throw new Error('Unable to resolve Expo dev server port configuration')
      }
    }

    // Android reaches the host by one of two routes and which one works is a
    // property of the machine, not something worth assuming. `adb reverse` plus
    // `127.0.0.1` works on a developer machine; on a GitHub runner the reverse
    // is accepted by adb and the device still cannot open the port, and the
    // suite fails with every flow reporting `tab-home` missing while Expo Go
    // sits on its own "Something went wrong." screen. `10.0.2.2` is QEMU's alias
    // for the host loopback and does not depend on the reverse at all.
    //
    // So the device is asked which one it can actually open, and the answer is
    // used. Both are probed and logged even after one succeeds, because knowing
    // that the other route is dead is what makes the next failure diagnosable.
    if (target.platform === 'android' && !process.env.MOBILE_E2E_ANDROID_HOST) {
      const port = Number(new URL(resolvedPair.health).port || metroPort)
      const reachable = []
      for (const candidate of ['127.0.0.1', '10.0.2.2']) {
        // eslint-disable-next-line no-await-in-loop -- two candidates, ordered
        if (await probeAndroidMetroReachability(candidate, port)) {
          reachable.push(candidate)
        }
      }
      if (reachable.length > 0 && reachable[0] !== androidHost) {
        log(`Switching the Android host to ${reachable[0]}: the device can open it`)
        androidHost = reachable[0]
        resolvedPair = {
          app: getLocalAppUrl(target.platform, port),
          health: resolvedPair.health,
        }
      } else if (reachable.length === 0) {
        log(
          `The device could not open Metro on any candidate host. Expo Go will ` +
            `fail to load the project; every flow will report tab-home missing.`
        )
      }
    }

    process.env.MOBILE_E2E_APP_URL = resolvedPair.app
    process.env.MOBILE_E2E_HEALTH_URL = resolvedPair.health
    process.env.APP_URL = resolvedPair.app
    process.env.WARDROBE_URL = `${resolvedPair.app}wardrobe`
    const widgetUrl = (size, slot) =>
      target.platform === 'ios'
        ? `${resolvedPair.app}(tabs)?source=widget&size=${size}&slot=${slot}`
        : `mobile://(tabs)?source=widget&size=${size}&slot=${slot}`
    process.env.WIDGET_NOW_URL = widgetUrl('small', 'now')
    process.env.WIDGET_NEXT_URL = widgetUrl('medium', 'next')
    if (!process.env.MAESTRO_APP_ID) {
      process.env.MAESTRO_APP_ID = target.appId
    }

    // When Expo CLI has to install Expo Go on iOS, Metro can be healthy before
    // the app is ready. Poll briefly so Maestro does not race the install.
    const iosExpoGoReady =
      target.platform !== 'ios' ||
      (await waitForCondition(
        async () => (await getInstalledExpoGoVersionOnIos()) !== null,
        target.expoGoReady ? 10_000 : 90_000,
        2_000
      ))

    await warmMetroBundle(resolvedPair.health, target.platform)

    if (!iosExpoGoReady) {
      throw new Error(
        'Expo Go is still unavailable on the booted iOS simulator after starting Expo. Verify the simulator is healthy, then rerun `npm run test:mobile:e2e:ios`.'
      )
    }

    let xcrunShimDir
    const maestroEnv = { ...process.env }
    if (
      target.platform === 'android' &&
      process.env.MAESTRO_DISABLE_ANDROID_XCRUN_SHIM !== '1'
    ) {
      xcrunShimDir = createAndroidXcrunShim()
      maestroEnv.PATH = `${xcrunShimDir}:${maestroEnv.PATH ?? ''}`
      log('Using Android-only xcrun shim to avoid broken iOS simulator discovery')
    }

    // A suite runner reports on every flow. Rejecting on the first failure hid
    // the state of the other seventeen and made a full pass take one boot per
    // flow, so failures are collected and rethrown as one summary at the end.
    const flowFailures = []

    /**
     * @param {string[]} failures
     * @returns {void}
     */
    const finishSuite = (failures) => {
      const passedCount = flowsToRun.length - failures.length
      log(`Maestro suite: ${passedCount}/${flowsToRun.length} flows passed`)
      if (failures.length > 0) {
        throw new Error(
          `${failures.length} Maestro flow(s) failed:\n  ${failures.join('\n  ')}`
        )
      }
    }

    // Flows that depend on a value seeded for one specific user cannot be
    // sharded: Maestro passes one set of `-e` values to every device, so
    // `WEATHER_ALERT_ID` can only ever match the user of one of them. There is
    // exactly one such flow, and it runs on the first device after the sharded
    // pass rather than being weakened to suit the split.
    const USER_SCOPED_FLOWS = ['maestro/deep-link-handling.yaml']

    try {
      if (PARALLEL_DEVICES) {
        const shardedFlows = flowsToRun.filter(
          (flow) => !USER_SCOPED_FLOWS.includes(flow)
        )
        const serialFlows = flowsToRun.filter((flow) => USER_SCOPED_FLOWS.includes(flow))

        for (const identity of mobileIdentities) {
          await resetMobileE2EPerFlowState(identity)
        }

        if (shardedFlows.length > 0) {
          const reportPath = toPosixPath(
            path.join(MAESTRO_ARTIFACT_DIR, 'parallel-suite-report.xml')
          )
          const parallelArgs = [
            '--platform',
            target.platform,
            '--udid',
            IOS_UDIDS.join(','),
            'test',
            '--shard-split',
            String(IOS_UDIDS.length),
            '-e',
            `MAESTRO_APP_ID=${process.env.MAESTRO_APP_ID}`,
            '-e',
            `WEATHER_ALERT_ID=${process.env.WEATHER_ALERT_ID ?? ''}`,
            '-e',
            `APP_URL=${process.env.APP_URL}`,
            '-e',
            `WARDROBE_URL=${process.env.WARDROBE_URL}`,
            '-e',
            `WIDGET_NOW_URL=${process.env.WIDGET_NOW_URL}`,
            '-e',
            `WIDGET_NEXT_URL=${process.env.WIDGET_NEXT_URL}`,
          ]
          if (WRITE_ARTIFACTS) {
            fs.mkdirSync(path.resolve(projectRoot, MAESTRO_ARTIFACT_DIR), {
              recursive: true,
            })
            parallelArgs.push(
              '--format',
              'junit',
              '--output',
              reportPath,
              '--test-output-dir',
              MAESTRO_ARTIFACT_DIR,
              '--debug-output',
              MAESTRO_ARTIFACT_DIR
            )
          }
          parallelArgs.push(...shardedFlows)

          log(
            `Running ${shardedFlows.length} flows across ${IOS_UDIDS.length} simulators`
          )
          // The exit code is not trusted on its own here. A sharded invocation
          // has been observed exiting 0 while its own summary printed
          // `Passed: 16/17` and the JUnit report recorded `failures="1"`, so
          // believing the exit code reported a green suite over a red one. The
          // report is the evidence; the exit code only adds a failure the
          // report could not describe.
          let maestroExitError
          try {
            await runMaestroCommand(parallelArgs, {
              env: maestroEnv,
              logFile: WRITE_ARTIFACTS
                ? path.resolve(projectRoot, MAESTRO_ARTIFACT_DIR, 'parallel-suite.log')
                : undefined,
            })
          } catch (error) {
            maestroExitError = error
          }

          const report = readSuiteReport(reportPath)
          for (const name of report.failed) {
            flowFailures.push(name)
            log(`FAIL ${name}`)
          }
          for (const name of report.passed) {
            log(`PASS ${name}`)
          }

          const accountedFor = report.failed.length + report.passed.length
          if (accountedFor !== shardedFlows.length) {
            // Every flow handed to Maestro has to appear in the report, or the
            // count this run reports is a guess. Fail loudly instead.
            const missing = shardedFlows.length - accountedFor
            flowFailures.push(
              `${missing} flow(s) missing from ${reportPath} (ran ${shardedFlows.length}, report described ${accountedFor})`
            )
            log(`FAIL ${missing} flow(s) absent from the JUnit report`)
          } else if (maestroExitError && report.failed.length === 0) {
            flowFailures.push(
              `Maestro exited non-zero with no failure in the report: ${maestroExitError.message}`
            )
            log('FAIL Maestro exited non-zero while the report recorded no failure')
          }
        }

        for (const flowPath of serialFlows) {
          const serialArgs = [
            '--platform',
            target.platform,
            '--udid',
            IOS_UDIDS[0],
            'test',
            '-e',
            `MAESTRO_APP_ID=${process.env.MAESTRO_APP_ID}`,
            '-e',
            `WEATHER_ALERT_ID=${process.env.WEATHER_ALERT_ID ?? ''}`,
            '-e',
            `APP_URL=${process.env.APP_URL}`,
            '-e',
            `WARDROBE_URL=${process.env.WARDROBE_URL}`,
            '-e',
            `WIDGET_NOW_URL=${process.env.WIDGET_NOW_URL}`,
            '-e',
            `WIDGET_NEXT_URL=${process.env.WIDGET_NEXT_URL}`,
          ]
          if (WRITE_ARTIFACTS) {
            serialArgs.push(
              '--format',
              'junit',
              '--output',
              getFlowReportPath(flowPath),
              '--test-output-dir',
              MAESTRO_ARTIFACT_DIR,
              '--debug-output',
              MAESTRO_ARTIFACT_DIR
            )
          }
          serialArgs.push(flowPath)

          log(`Running user-scoped flow on ${IOS_UDIDS[0]}: ${flowPath}`)
          try {
            await runMaestroCommand(serialArgs, {
              env: maestroEnv,
              logFile: WRITE_ARTIFACTS ? getFlowLogPath(flowPath) : undefined,
            })
            log(`PASS ${flowPath}`)
          } catch (error) {
            flowFailures.push(flowPath)
            log(`FAIL ${flowPath} (${error.message})`)
          }
        }
        return await finishSuite(flowFailures)
      }

      for (const flowPath of flowsToRun) {
        const maestroArgs = []
        let maestroLogFile
        if (process.env.MAESTRO_CLOUD_API_KEY && process.env.MAESTRO_CLOUD_WORKSPACE) {
          maestroArgs.push(
            'cloud',
            '--workspace',
            process.env.MAESTRO_CLOUD_WORKSPACE,
            '--apiKey',
            process.env.MAESTRO_CLOUD_API_KEY,
            'test',
            flowPath
          )
        } else {
          maestroArgs.push('--platform', target.platform)
          if (target.platform === 'ios' && iosSimulatorUdid !== 'booted') {
            // Without this, concurrent shards all drive whichever simulator
            // Maestro picks first.
            maestroArgs.push('--udid', iosSimulatorUdid)
          }
          maestroArgs.push('test')
          maestroArgs.push('-e', `MAESTRO_APP_ID=${process.env.MAESTRO_APP_ID}`)
          maestroArgs.push('-e', `WEATHER_ALERT_ID=${process.env.WEATHER_ALERT_ID ?? ''}`)
          maestroArgs.push('-e', `APP_URL=${process.env.APP_URL}`)
          maestroArgs.push('-e', `WARDROBE_URL=${process.env.WARDROBE_URL}`)
          maestroArgs.push('-e', `WIDGET_NOW_URL=${process.env.WIDGET_NOW_URL}`)
          maestroArgs.push('-e', `WIDGET_NEXT_URL=${process.env.WIDGET_NEXT_URL}`)
          if (WRITE_ARTIFACTS) {
            fs.mkdirSync(path.resolve(projectRoot, MAESTRO_ARTIFACT_DIR), {
              recursive: true,
            })
            maestroLogFile = getFlowLogPath(flowPath)
            maestroArgs.push(
              '--format',
              'junit',
              '--output',
              getFlowReportPath(flowPath),
              '--test-output-dir',
              MAESTRO_ARTIFACT_DIR,
              '--debug-output',
              MAESTRO_ARTIFACT_DIR
            )
          }
          maestroArgs.push(flowPath)
        }

        if (mobileIdentity) {
          await resetMobileE2EPerFlowState(mobileIdentity)
        }

        log(`Running Maestro flow (${maestroArgs.join(' ')})`)
        try {
          await runMaestroCommand(maestroArgs, {
            env: maestroEnv,
            logFile: maestroLogFile,
          })
          log(`PASS ${flowPath}`)
        } catch (error) {
          flowFailures.push(flowPath)
          log(`FAIL ${flowPath} (${error.message})`)
        }
      }
    } finally {
      if (xcrunShimDir) {
        fs.rmSync(xcrunShimDir, { recursive: true, force: true })
      }
    }

    finishSuite(flowFailures)
  } finally {
    for (const identity of mobileIdentities) {
      log('Cleaning authenticated mobile E2E fixture')
      try {
        await cleanupMobileE2EIdentity(apiSetupBaseUrl, identity)
      } catch (cleanupError) {
        console.error('[maestro:runner] Failed to clean mobile E2E fixture')
        console.error(cleanupError)
      }
    }
    const processCleanup = [
      [serverProcess, 'Expo dev server'],
      [workerProcess, 'Wardrobe worker'],
      [apiProcess, 'Local API'],
    ].filter(([child]) => Boolean(child))
    const processCleanupResults = await Promise.allSettled(
      processCleanup.map(([child, label]) => {
        log(`Stopping ${label}`)
        return stopManagedProcess(child, label)
      })
    )
    for (const result of processCleanupResults) {
      if (result.status === 'rejected') {
        console.error('[maestro:runner] Failed to stop managed process')
        console.error(result.reason)
      }
    }
  }
}

run().catch((err) => {
  console.error('[maestro:runner] Failed to complete flow')
  console.error(err)
  process.exit(1)
})
