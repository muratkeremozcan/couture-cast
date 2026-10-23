/**
 * Opens deep links in Expo Go on Android with its developer-menu onboarding off.
 *
 * Expo Go 54 (`DevMenuManager.maybeShowWithOnboarding`, expo/expo sdk-54) shows
 * its developer menu by itself two seconds after an experience finishes loading
 * whenever the `is_onboarding_finished` preference is false. Maestro's
 * `clearState: true` wipes that preference before every flow, so every flow's
 * first launch raised the sheet over the app. Its surface is added inside the
 * app's own window, and on CI it sometimes never animated in: a full-screen dim
 * stayed up with the sheet parked below the screen, invisible to Maestro, and
 * swallowed every tap for the rest of the flow (CI job 120258320163).
 *
 * The kernel skips that onboarding for the whole process when a launch intent
 * carries the boolean extra `EXKernelDisableNuxDefaultsKey`
 * (`Kernel.handleIntent`). Only the deep-link entry point passes intents to the
 * kernel, and Maestro's `openLink` cannot add extras, so flows ask this
 * endpoint to send the VIEW intent over adb instead
 * (`maestro/subflows/open-link.yaml`). Maestro injects `MAESTRO_DEVICE_UDID`,
 * which is the adb serial, so a run that drives several emulators opens each
 * link on the device that asked.
 */
import { spawn } from 'node:child_process'
import http from 'node:http'

export const EXPO_GO_PACKAGE = 'host.exp.exponent'
export const DISABLE_ONBOARDING_EXTRA = 'EXKernelDisableNuxDefaultsKey'

/**
 * Single-quotes a value for the device shell `adb shell` hands its arguments to.
 *
 * @param {string} value
 */
const quoteForDeviceShell = (value) => `'${value.replaceAll("'", "'\\''")}'`

/**
 * The adb arguments that open `url` in Expo Go on `device`.
 *
 * @param {string} device adb serial
 * @param {string} url an exp:// or exps:// link
 * @param {{ disableOnboarding?: boolean }} [options]
 * @returns {string[]}
 */
export function expoGoOpenLinkArgs(device, url, { disableOnboarding = true } = {}) {
  return [
    '-s',
    device,
    'shell',
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    quoteForDeviceShell(url),
    ...(disableOnboarding ? ['--ez', DISABLE_ONBOARDING_EXTRA, 'true'] : []),
    EXPO_GO_PACKAGE,
  ]
}

/**
 * @param {string} binary
 * @param {string[]} args
 * @returns {Promise<{ code: number | null, output: string }>}
 */
const runCommand = (binary, args) =>
  new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('error', (error) => resolve({ code: null, output: String(error) }))
    child.on('close', (code) => resolve({ code, output }))
  })

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<string>}
 */
const readBody = async (request) => {
  let body = ''
  for await (const chunk of request) body += chunk
  return body
}

/**
 * Starts the loopback endpoint `POST /open` with a JSON body `{ device, url }`.
 *
 * Answers 200 once `am start -W` reports the activity launched, 400 for a body
 * that names an unknown device or a link that is not exp:// or exps://, and 502
 * when adb or the activity manager refuses (`am start` reports some failures on
 * stdout with exit code 0).
 *
 * @param {{
 *   adbBinary: string,
 *   devices: string[],
 *   disableOnboarding?: boolean,
 *   run?: typeof runCommand,
 * }} options
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function startExpoGoLinkEndpoint({
  adbBinary,
  devices,
  disableOnboarding = true,
  run = runCommand,
}) {
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/open') {
      response.writeHead(404).end()
      return
    }
    /** @type {{ device?: unknown, url?: unknown }} */
    let body
    try {
      body = JSON.parse(await readBody(request)) ?? {}
    } catch {
      response.writeHead(400).end('Body must be JSON: { "device", "url" }')
      return
    }
    const { device, url } = body
    if (typeof device !== 'string' || !devices.includes(device)) {
      response.writeHead(400).end(`Unknown device ${String(device)}`)
      return
    }
    if (typeof url !== 'string' || !/^exps?:\/\//.test(url)) {
      response.writeHead(400).end('Only exp:// and exps:// links open in Expo Go')
      return
    }
    const result = await run(
      adbBinary,
      expoGoOpenLinkArgs(device, url, { disableOnboarding })
    )
    if (result.code !== 0 || /^Error/m.test(result.output)) {
      response.writeHead(502).end(result.output)
      return
    }
    response.writeHead(200).end(result.output)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(undefined))
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}/open`,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  }
}

/**
 * Serials of the devices adb currently reports as ready.
 *
 * @param {string} adbBinary
 * @param {typeof runCommand} [run]
 * @returns {Promise<string[]>}
 */
export async function listAdbDevices(adbBinary, run = runCommand) {
  const { output } = await run(adbBinary, ['devices'])
  return output
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
}
