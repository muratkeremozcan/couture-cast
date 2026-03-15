#!/usr/bin/env node

/**
 * Mobile E2E bootstrap for Maestro.
 *
 * Purpose:
 * - Choose a usable mobile target (Android first, iOS fallback on macOS).
 * - Start or reuse a healthy Expo/Metro session.
 * - Wait until Expo Go is actually available before running Maestro.
 * - Execute one Maestro flow with the resolved app id and app URL.
 *
 * Why this script exists:
 * - `maestro test ...` alone is not enough in this repo because the app under test
 *   depends on Expo Go, Metro, and sometimes simulator boot/install work.
 * - We keep that orchestration here so the npm scripts stay small and the flow is
 *   readable in one place.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import os from 'node:os'
import { URL } from 'node:url'
import path from 'node:path'

const FLOW_PATH = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'maestro/sanity.yaml'
const isCI = process.argv.includes('--ci')

const START_SERVER = process.env.MOBILE_E2E_SKIP_SERVER !== '1'
const AUTO_BOOT_IOS = process.env.MOBILE_E2E_AUTO_BOOT_IOS === '1'

const log = (msg) => console.log(`[maestro:runner] ${msg}`)
const isMac = os.platform() === 'darwin'

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
 * Poll an HTTP(S) endpoint until it stops returning a server error.
 *
 * In this script, "healthy enough" means the Expo dev server is listening and
 * able to answer requests, not that the mobile app itself has loaded yet.
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
          log(`Detected Expo dev server at ${urlObj.href}`)
          resolve()
        } else if (Date.now() > deadline) {
          reject(new Error(`Expo dev server not ready before timeout (${timeoutMs}ms)`))
        } else {
          setTimeout(attempt, intervalMs)
        }
      })

      req.on('error', (err) => {
        if (Date.now() > deadline) {
          reject(new Error(`Failed to reach Expo dev server: ${err.message}`))
        } else {
          setTimeout(attempt, intervalMs)
        }
      })

      req.end()
    }

    attempt()
  })

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
    const { timeoutMs, signal, ...spawnOptions } = options
    const child = spawn(command, args, { stdio: 'inherit', shell: true, ...spawnOptions })
    let timedOut = false
    const timeout =
      typeof timeoutMs === 'number'
        ? setTimeout(() => {
            timedOut = true
            child.kill('SIGINT')
          }, timeoutMs)
        : null

    child.on('exit', (code) => {
      if (timeout) clearTimeout(timeout)
      if (timedOut) {
        reject(new Error(`${command} timed out after ${timeoutMs}ms`))
        return
      }
      if (code === 0) {
        resolve()
      } else {
        const error = new Error(`${command} exited with code ${code}`)
        error.code = code
        reject(error)
      }
    })
    child.on('error', (err) => {
      if (timeout) clearTimeout(timeout)
      reject(err)
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
      shell: true,
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
    process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.HOME ?? '', 'Library', 'Android', 'sdk')
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
    const packages = await captureProcess(adbBinary, ['shell', 'pm', 'list', 'packages', 'host.exp.exponent'])
    if (packages.stdout.includes('host.exp.exponent')) {
      log('Expo Go already installed on Android emulator/device')
      return 'installed'
    }
  } catch {
    // fall through to install
  }

  log('Expo Go not found on Android emulator/device')
  return 'missing'
}

/**
 * Detect whether any iOS simulator is already booted.
 *
 * @returns {Promise<boolean>}
 */
const hasBootedIosSimulator = async () => {
  if (!isMac) return false

  try {
    const result = await captureProcess('xcrun', ['simctl', 'list', 'devices', 'booted'], {
      timeoutMs: 5000,
    })
    return /\(Booted\)/.test(result.stdout)
  } catch {
    return false
  }
}

/**
 * Detect whether Expo Go is installed on the currently booted iOS simulator.
 *
 * This is separate from "simulator is booted" because Expo CLI may still need
 * to fetch and install Expo Go the first time the smoke runs.
 *
 * @returns {Promise<boolean>}
 */
const hasExpoGoOnIos = async () => {
  if (!isMac) return false

  try {
    await captureProcess(
      'xcrun',
      ['simctl', 'get_app_container', 'booted', 'host.exp.Exponent'],
      { timeoutMs: 5000 }
    )
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the mobile target that Maestro should drive.
 *
 * Selection order:
 * 1) use Android when an attached device/emulator with Expo Go is ready,
 * 2) fail fast if Android exists but Expo Go is missing,
 * 3) otherwise fall back to iOS simulator on macOS when allowed,
 * 4) if nothing usable exists, explain exactly what is missing.
 *
 * @returns {Promise<{ platform: 'android' | 'ios', appId: string, expoGoReady: boolean }>}
 */
const resolveTarget = async () => {
  const expoGoStatus = await ensureExpoGoOnAndroid()
  if (expoGoStatus === 'installed') {
    return { platform: 'android', appId: 'host.exp.exponent', expoGoReady: true }
  }
  if (expoGoStatus === 'missing') {
    throw new Error(
      'Expo Go is not installed on the Android emulator/device. Open the emulator, install Expo Go from the Play Store (package: host.exp.exponent), then rerun. You can deep link the Play Store via: adb shell am start -a android.intent.action.VIEW -d "market://details?id=host.exp.exponent".'
    )
  }

  if (!AUTO_BOOT_IOS) {
    throw new Error(
      'No Android device/emulator with Expo Go is available. Attach one, or run `npm run test:mobile:e2e:ios` to attempt the iOS simulator path.'
    )
  }

  if (await hasBootedIosSimulator()) {
    const expoGoReady = await hasExpoGoOnIos()
    // iOS is the fallback path on macOS when no Android target is attached.
    // Expo CLI can install Expo Go for us, so "booted" is enough to continue.
    log(
      expoGoReady
        ? 'Using booted iOS simulator for Maestro run'
        : 'Using booted iOS simulator; Expo Go will be launched via Expo CLI'
    )
    return { platform: 'ios', appId: 'host.exp.Exponent', expoGoReady }
  }

  if (isMac) {
    log('No mobile target detected. Attempting to boot an iOS simulator.')
    await spawnProcess('bash', ['./scripts/start-ios-simulator.sh'], { timeoutMs: 30000 })

    if (await hasBootedIosSimulator()) {
      const expoGoReady = await hasExpoGoOnIos()
      log(
        expoGoReady
          ? 'Booted iOS simulator for Maestro run'
          : 'Booted iOS simulator; Expo Go will be launched via Expo CLI'
      )
      return { platform: 'ios', appId: 'host.exp.Exponent', expoGoReady }
    }
  }

  throw new Error(
    'No Maestro target is available. Attach an Android device/emulator with Expo Go, or ensure Xcode Simulator is available for the iOS fallback.'
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
 * @returns {Promise<void>}
 */
const runMaestroCommand = async (args) => {
  try {
    await spawnProcess('maestro', args)
  } catch (err) {
    if (err.code === 'ENOENT') {
      log('System maestro command missing, retrying via npx maestro@latest')
      await spawnProcess('npx', ['--yes', 'maestro@latest', ...args])
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
 * 3) start or reuse Expo,
 * 4) wait until Expo Go is actually usable,
 * 5) run Maestro,
 * 6) stop the local Expo process on the way out.
 *
 * @returns {Promise<void>}
 */
const run = async () => {
  const metroPort = await chooseMetroPort()
  process.env.MOBILE_E2E_METRO_PORT = String(metroPort)
  const target = await ensureMaestroTarget()

  // Maestro needs both an app URL and a health URL. We probe the explicit env
  // override first, then the chosen Metro port, then the default Expo port.
  const portPairs = [
    {
      app: process.env.MOBILE_E2E_APP_URL,
      health: process.env.MOBILE_E2E_HEALTH_URL,
    },
    {
      app: `exp://127.0.0.1:${metroPort}/--/`,
      health: `http://127.0.0.1:${metroPort}`,
    },
    {
      app: 'exp://127.0.0.1:8081/--/',
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
        stdio: 'inherit',
        shell: true,
        env: {
          ...process.env,
          MOBILE_E2E_PLATFORM: target.platform,
        },
      })
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
        throw new Error('No MOBILE_E2E_APP_URL / MOBILE_E2E_HEALTH_URL provided while server skip is enabled')
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
    if (!process.env.MAESTRO_APP_ID) {
      process.env.MAESTRO_APP_ID = target.appId
    }

    // When Expo CLI has to install Expo Go on iOS, Metro can be healthy before
    // the app is ready. Poll briefly so Maestro does not race the install.
    const iosExpoGoReady =
      target.platform !== 'ios' ||
      (await waitForCondition(() => hasExpoGoOnIos(), target.expoGoReady ? 10_000 : 90_000, 2_000))

    if (!iosExpoGoReady) {
      throw new Error(
        'Expo Go is still unavailable on the booted iOS simulator after starting Expo. Verify the simulator is healthy, then rerun `npm run test:mobile:e2e:ios`.'
      )
    }

    const maestroArgs = []
    if (process.env.MAESTRO_CLOUD_API_KEY && process.env.MAESTRO_CLOUD_WORKSPACE) {
      maestroArgs.push(
        'cloud',
        '--workspace',
        process.env.MAESTRO_CLOUD_WORKSPACE,
        '--apiKey',
        process.env.MAESTRO_CLOUD_API_KEY,
        'test',
        FLOW_PATH
      )
    } else {
      maestroArgs.push('test', FLOW_PATH)
    }

    if (isCI) {
      maestroArgs.push('--format', 'junit', '--output', 'maestro/artifacts')
    }

    log(`Running Maestro flow (${maestroArgs.join(' ')})`)
    await runMaestroCommand(maestroArgs)
  } finally {
    if (serverProcess) {
      log('Stopping Expo dev server')
      serverProcess.kill('SIGINT')
    }
  }
}

run().catch((err) => {
  console.error('[maestro:runner] Failed to complete flow')
  console.error(err)
  process.exit(1)
})
