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
const flowsToRun =
  FLOW_PATHS.length > 0 ? FLOW_PATHS : ['maestro/sanity.yaml', 'maestro/analytics.yaml']
const WRITE_ARTIFACTS =
  process.argv.includes('--ci') ||
  process.argv.includes('--artifacts') ||
  process.env.MOBILE_E2E_ARTIFACTS === '1'
const MAESTRO_ARTIFACT_DIR = process.env.MAESTRO_ARTIFACT_DIR || 'maestro/artifacts'

const START_SERVER = process.env.MOBILE_E2E_SKIP_SERVER !== '1'
const AUTO_BOOT_ANDROID = process.env.MOBILE_E2E_AUTO_BOOT_ANDROID !== '0'
const REQUESTED_PLATFORM = process.env.MOBILE_E2E_PLATFORM || cliPlatform
const EXPECTED_EXPO_GO_VERSION = process.env.MOBILE_E2E_EXPO_GO_VERSION || '54.0.8'

const log = (msg) => console.log(`[maestro:runner] ${msg}`)
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

const getLocalAppUrl = (platform, port) => {
  const host =
    platform === 'android'
      ? process.env.MOBILE_E2E_ANDROID_HOST || '10.0.2.2'
      : process.env.MOBILE_E2E_IOS_HOST || '127.0.0.1'
  return `exp://${host}:${port}/--/`
}

const getLocalApiUrl = (platform) => {
  const host =
    platform === 'android'
      ? process.env.MOBILE_E2E_ANDROID_HOST || '10.0.2.2'
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

const setupMobileE2EIdentity = async (apiBaseUrl) => {
  const email = `mobile-e2e-${Date.now()}-${process.pid}@example.com`
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

  const accessToken = `test-token:guardian:${userId}`
  const authorization = `Bearer ${accessToken}`
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

  return accessToken
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
      ['simctl', 'get_app_container', 'booted', 'host.exp.Exponent', 'app'],
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
  await spawnProcess('xcrun', ['simctl', 'install', 'booted', binaryPath], {
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

  if (await hasBootedIosSimulator()) {
    const expoGoReady = await ensureExpoGoOnIos()
    log('Using booted iOS simulator for Maestro run')
    return { platform: 'ios', appId: 'host.exp.Exponent', expoGoReady }
  }

  log('No iOS simulator detected. Attempting to boot an iOS simulator.')
  await spawnProcess('bash', ['./scripts/start-ios-simulator.sh'], { timeoutMs: 60_000 })

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
  const metroPort = await chooseMetroPort()
  process.env.MOBILE_E2E_METRO_PORT = String(metroPort)
  const target = await ensureMaestroTarget()
  const apiHealthUrl = 'http://127.0.0.1:4000/api/health'
  const apiSetupBaseUrl = 'http://127.0.0.1:4000'
  let apiProcess

  try {
    if (process.env.MOBILE_E2E_SKIP_API !== '1') {
      try {
        await waitForHealth(apiHealthUrl, 2_000, 250)
        log(`Detected existing local API at ${apiHealthUrl}, reusing it`)
      } catch {
        log('Starting local API for mobile E2E')
        apiProcess = spawn('npm', ['run', 'start:api:e2e'], {
          cwd: projectRoot,
          detached: process.platform !== 'win32',
          stdio: 'inherit',
          env: {
            ...process.env,
            ALLOW_DEV_GUARDIAN_SECRET: 'true',
            DATABASE_URL:
              process.env.MOBILE_E2E_DATABASE_URL ||
              'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
            GUARDIAN_INVITE_WEB_BASE_URL: 'http://127.0.0.1:3005',
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

      process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN =
        await setupMobileE2EIdentity(apiSetupBaseUrl)
      process.env.EXPO_PUBLIC_API_BASE_URL = getLocalApiUrl(target.platform)
      log('Created authenticated mobile E2E fixture')
    } else if (!process.env.EXPO_PUBLIC_API_BASE_URL) {
      throw new Error(
        'MOBILE_E2E_SKIP_API=1 requires EXPO_PUBLIC_API_BASE_URL and an externally managed test identity.'
      )
    }
  } catch (error) {
    await stopManagedProcess(apiProcess, 'Local API')
    throw error
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

    process.env.MOBILE_E2E_APP_URL = resolvedPair.app
    process.env.MOBILE_E2E_HEALTH_URL = resolvedPair.health
    process.env.APP_URL = resolvedPair.app
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

    try {
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
          maestroArgs.push('--platform', target.platform, 'test')
          maestroArgs.push('-e', `MAESTRO_APP_ID=${process.env.MAESTRO_APP_ID}`)
          maestroArgs.push('-e', `APP_URL=${process.env.APP_URL}`)
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

        log(`Running Maestro flow (${maestroArgs.join(' ')})`)
        await runMaestroCommand(maestroArgs, { env: maestroEnv, logFile: maestroLogFile })
      }
    } finally {
      if (xcrunShimDir) {
        fs.rmSync(xcrunShimDir, { recursive: true, force: true })
      }
    }
  } finally {
    if (serverProcess) {
      log('Stopping Expo dev server')
      await stopManagedProcess(serverProcess, 'Expo dev server')
    }
    if (apiProcess) {
      log('Stopping local API')
      await stopManagedProcess(apiProcess, 'Local API')
    }
  }
}

run().catch((err) => {
  console.error('[maestro:runner] Failed to complete flow')
  console.error(err)
  process.exit(1)
})
