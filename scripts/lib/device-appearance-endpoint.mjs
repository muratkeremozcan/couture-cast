/**
 * Story CC-7.9 (TEA, 7.9-NVIS): lets a Maestro flow change the Android system appearance while
 * the app stays open, the way a member flips Dark theme in quick settings.
 *
 * Maestro cannot run adb, and a second Maestro invocation would restart the API, worker and Metro
 * that `scripts/run-maestro.mjs` owns. So, as `expo-go-link-endpoint.mjs` does for deep links,
 * the runner hosts a loopback endpoint and the flow posts to it from `runScript`
 * (`maestro/subflows/set-system-appearance.js`):
 *
 * - `POST /night` `{ device, mode: 'yes' | 'no' }` runs `cmd uimode night <mode>`;
 * - `POST /status-bar` `{ device, demo: true | false }` enters or leaves SystemUI demo mode with
 *   a fixed clock, full battery, full Wi-Fi and no notification icons, so a screenshot of the
 *   whole screen does not change with the time of the run.
 *
 * Only these fixed commands run, only on a device this run drives, and the server listens on
 * 127.0.0.1 only.
 */
import { spawn } from 'node:child_process'
import http from 'node:http'

export const APPEARANCE_TIMEOUT_MS = 15_000

/** @param {string} device @param {'yes' | 'no'} mode */
export const nightModeCommands = (device, mode) => [
  ['-s', device, 'shell', 'cmd', 'uimode', 'night', mode],
]

const demo = (device, ...extras) => [
  '-s',
  device,
  'shell',
  'am',
  'broadcast',
  '-a',
  'com.android.systemui.demo',
  ...extras,
]

/** @param {string} device @param {boolean} enabled */
export const statusBarDemoCommands = (device, enabled) =>
  enabled
    ? [
        ['-s', device, 'shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1'],
        demo(device, '-e', 'command', 'enter'),
        demo(device, '-e', 'command', 'clock', '-e', 'hhmm', '1200'),
        demo(
          device,
          '-e',
          'command',
          'battery',
          '-e',
          'level',
          '100',
          '-e',
          'plugged',
          'false'
        ),
        demo(
          device,
          '-e',
          'command',
          'network',
          '-e',
          'wifi',
          'show',
          '-e',
          'level',
          '4',
          '-e',
          'mobile',
          'hide'
        ),
        demo(device, '-e', 'command', 'notifications', '-e', 'visible', 'false'),
      ]
    : [demo(device, '-e', 'command', 'exit')]

const runCommand = (binary, args, signal) =>
  new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], signal })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('error', (error) => resolve({ code: null, output: String(error) }))
    child.on('close', (code) => resolve({ code, output }))
  })

const readBody = async (request) => {
  let body = ''
  for await (const chunk of request) body += chunk
  return body
}

/**
 * Validates one request into the adb argument lists it runs, or an error status and message.
 *
 * @param {string | undefined} route
 * @param {unknown} body
 * @param {string[]} devices
 * @returns {{ commands: string[][] } | { status: number, message: string }}
 */
export function appearanceCommands(route, body, devices) {
  const {
    device,
    mode,
    demo: demoMode,
  } = /** @type {Record<string, unknown>} */ (body ?? {})
  if (typeof device !== 'string' || !devices.includes(device))
    return { status: 400, message: `Unknown device ${String(device)}` }
  if (route === '/night') {
    if (mode !== 'yes' && mode !== 'no')
      return { status: 400, message: 'mode must be "yes" or "no"' }
    return { commands: nightModeCommands(device, mode) }
  }
  if (route === '/status-bar') {
    if (typeof demoMode !== 'boolean')
      return { status: 400, message: 'demo must be a boolean' }
    return { commands: statusBarDemoCommands(device, demoMode) }
  }
  return { status: 404, message: `No route ${String(route)}` }
}

/**
 * @param {{
 *   adbBinary: string,
 *   devices: string[],
 *   timeoutMs?: number,
 *   run?: (binary: string, args: string[], signal?: AbortSignal) => Promise<{ code: number | null, output: string }>,
 * }} options
 */
export async function startDeviceAppearanceEndpoint({
  adbBinary,
  devices,
  timeoutMs = APPEARANCE_TIMEOUT_MS,
  run = runCommand,
}) {
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end()
      return
    }
    let body
    try {
      body = JSON.parse(await readBody(request))
    } catch {
      response.writeHead(400).end('Body must be JSON')
      return
    }
    const plan = appearanceCommands(request.url, body, devices)
    if ('status' in plan) {
      response.writeHead(plan.status).end(plan.message)
      return
    }
    let output = ''
    for (const args of plan.commands) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      // eslint-disable-next-line no-await-in-loop -- the commands run in order on one device
      const result = await run(adbBinary, args, controller.signal)
      clearTimeout(timer)
      output += result.output
      if (result.code !== 0 || /^(Error|Exception)/m.test(result.output)) {
        response.writeHead(502).end(`${adbBinary} ${args.join(' ')}\n${result.output}`)
        return
      }
    }
    response.writeHead(200).end(output)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(undefined))
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  }
}
