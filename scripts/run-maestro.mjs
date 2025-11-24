#!/usr/bin/env node

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { URL } from 'node:url'
import path from 'node:path'

const FLOW_PATH = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'maestro/sanity.yaml'
const isCI = process.argv.includes('--ci')

const START_SERVER = process.env.MOBILE_E2E_SKIP_SERVER !== '1'

const log = (msg) => console.log(`[maestro:runner] ${msg}`)

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

const chooseMetroPort = async () => {
  const preferred = process.env.MOBILE_E2E_METRO_PORT
    ? [Number(process.env.MOBILE_E2E_METRO_PORT)]
    : [8081, 8082, 8083]
  for (const port of preferred) {
    if (await isPortFree(port)) return port
  }
  return preferred[preferred.length - 1]
}

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

const spawnProcess = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: true, ...options })
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        const error = new Error(`${command} exited with code ${code}`)
        error.code = code
        reject(error)
      }
    })
    child.on('error', (err) => {
      reject(err)
    })
    if (options.signal) {
      options.signal.addEventListener('abort', () => child.kill('SIGINT'))
    }
  })

const captureProcess = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: true, ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        const err = new Error(`${command} exited with code ${code}`)
        err.stdout = stdout
        err.stderr = stderr
        reject(err)
      }
    })
    child.on('error', reject)
  })

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

const run = async () => {
  const metroPort = await chooseMetroPort()
  process.env.MOBILE_E2E_METRO_PORT = String(metroPort)

  const portPairs = [
    {
      app: process.env.MOBILE_E2E_APP_URL,
      health: process.env.MOBILE_E2E_HEALTH_URL,
    },
    {
      app: `exp://127.0.0.1:${metroPort}`,
      health: `http://127.0.0.1:${metroPort}`,
    },
    {
      app: 'exp://127.0.0.1:8081',
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
        throw new Error(`Expo dev server never became healthy. Tried: ${DEFAULT_PORT_PAIRS.map((p) => p.health).join(', ')}`)
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
    if (!process.env.MAESTRO_APP_ID) {
      process.env.MAESTRO_APP_ID = 'host.exp.exponent'
    }

    const expoGoStatus = await ensureExpoGoOnAndroid()
    if (expoGoStatus === 'missing') {
      throw new Error(
        'Expo Go is not installed on the Android emulator/device. Open the emulator, install Expo Go from the Play Store (package: host.exp.exponent), then rerun. You can deep link the Play Store via: adb shell am start -a android.intent.action.VIEW -d "market://details?id=host.exp.exponent".'
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
