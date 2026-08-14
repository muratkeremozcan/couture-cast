#!/usr/bin/env node
/**
 * Run the Maestro suite across several devices at once, on either platform.
 *
 * The serial suite costs the sum of its eighteen flows: roughly 35 minutes on
 * iOS and 1.5-2 hours on Android, both too slow to gate a pull request beside
 * the ~10 minute Playwright job.
 *
 * This script only owns the devices. It creates and boots the simulators or
 * emulators, then hands the whole list to `scripts/run-maestro.mjs`, which
 * seeds one fixture user per device and drives them from a single Maestro
 * process using Maestro's own `--shard-split`.
 *
 * Why a single Maestro process, rather than one per shard: Maestro pins its iOS
 * driver to a fixed host port and derives per-device ports from the device list
 * it is given. Two `maestro` processes on one machine therefore drive the same
 * XCUITest runner, and the symptoms are
 * `only one gesture can be performed at a time` and
 * `Failed to connect to /127.0.0.1:7001`.
 *
 * Why one user per device: the flows create, rename and delete capsules and
 * garments for the signed-in user. Sharing a user across concurrent devices
 * means shards corrupting each other's data. `EXPO_PUBLIC_E2E_ACCESS_TOKEN` is
 * baked into the bundle at Metro startup, so the bundle carries a map of device
 * name to token and `apps/mobile/src/lib/mobile-auth.ts` picks this device's
 * entry. On Android that name has to be written to the device first; see
 * `assignAndroidDeviceName` in `scripts/run-maestro.mjs`.
 *
 * Usage:
 *   node ./scripts/run-maestro-shards.mjs                        # 4 simulators
 *   node ./scripts/run-maestro-shards.mjs --shards 2
 *   node ./scripts/run-maestro-shards.mjs --platform android
 *   MOBILE_E2E_SHARDS=6 node ./scripts/run-maestro-shards.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const log = (msg) => console.log(`[maestro:shards] ${msg}`)

const shardsFlagIndex = process.argv.indexOf('--shards')
const SHARD_COUNT = Math.max(
  1,
  Number(
    shardsFlagIndex !== -1
      ? process.argv[shardsFlagIndex + 1]
      : process.env.MOBILE_E2E_SHARDS || 4
  ) || 4
)

/**
 * The device name prefix this script owns.
 *
 * Simulators are created once and reused across runs. Creating them per run
 * would leave a pile of them behind and pay for a fresh Expo Go install every
 * time.
 */
const SHARD_DEVICE_PREFIX = 'couture-e2e'

/**
 * The simulator model every shard runs on.
 *
 * `scripts/start-ios-simulator.sh` boots `iPhone 17` for a serial run, so the
 * shards use the same model and their results stay comparable with it. A
 * different iPhone is a different screen height, and these flows assert on
 * elements that sit under a sticky tab bar or the software keyboard.
 */
const IOS_DEVICE_NAME = process.env.IOS_SIM_DEVICE || 'iPhone 17'

const platformFlagIndex = process.argv.indexOf('--platform')
const PLATFORM =
  (platformFlagIndex !== -1 ? process.argv[platformFlagIndex + 1] : '') ||
  process.env.MOBILE_E2E_PLATFORM ||
  'ios'
if (PLATFORM !== 'ios' && PLATFORM !== 'android') {
  throw new Error(
    `Unsupported platform "${PLATFORM}". Use --platform ios or --platform android.`
  )
}

/**
 * The hardware profile every Android shard is created from.
 *
 * Same reasoning as `IOS_DEVICE_NAME`: the serial Android runs that produced
 * this suite's known results were on a `medium_phone` (1080x2400, density 420),
 * and these flows assert on elements under a sticky tab bar, so a different
 * profile is a different set of results rather than the same results faster.
 */
const ANDROID_DEVICE_PROFILE = process.env.ANDROID_AVD_DEVICE || 'medium_phone'

/**
 * The console port of the first shard emulator.
 *
 * Emulator serials are `emulator-<console port>` and the ports must be even and
 * two apart, because each emulator claims its console port and the adb port
 * above it. 5554 is where a single emulator lands by default, so a sharded run
 * and a serial one address their first device identically.
 */
const ANDROID_BASE_PORT = Number(process.env.ANDROID_EMULATOR_BASE_PORT || 5554)

/**
 * Whether the shard emulators run without a window.
 *
 * Off by default deliberately. `-no-window` has not been verified against
 * Maestro's Android driver in this repository, and the serial runs whose
 * results this suite is compared against were windowed. Turn it on with
 * `ANDROID_EMULATOR_HEADLESS=1` and check the flows still pass before making it
 * the default.
 */
const ANDROID_HEADLESS = process.env.ANDROID_EMULATOR_HEADLESS === '1'

/**
 * How long one emulator gets to reach `sys.boot_completed`.
 *
 * Generous because four cold boots compete for the same CPU, and a boot that is
 * merely slow should not be reported as a broken image.
 */
const BOOT_TIMEOUT_MS = Number(process.env.ANDROID_EMULATOR_BOOT_TIMEOUT_MS || 300_000)

/**
 * The bound every `capture` call gets unless it asks for another.
 *
 * Long enough for `avdmanager create avd`, which unpacks a system image.
 */
const DEFAULT_CAPTURE_TIMEOUT_MS = 120_000

const androidSdkRoot =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  path.join(os.homedir(), 'Library', 'Android', 'sdk')

const androidBinary = (...segments) => path.join(androidSdkRoot, ...segments)

/**
 * Run a command and return its stdout.
 *
 * `timeoutMs` is not optional discipline here. `adb wait-for-device` blocks
 * forever when the emulator it is waiting for never appears, and an unbounded
 * `adb` call has already cost this repository a CI run that looked like slow
 * flows for thirty minutes. Every call gets a bound, and a bound that is hit
 * produces an error naming the command rather than silence.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ input?: string, timeoutMs?: number }} [options]
 * @returns {Promise<string>}
 */
const capture = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot })
    if (options.input !== undefined) {
      child.stdin.end(options.input)
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      child.kill('SIGKILL')
      reject(
        new Error(
          `${command} ${args.join(' ')} timed out after ${options.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS}ms`
        )
      )
    }, options.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      if (!settled) reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      if (code === 0) resolve(stdout)
      else reject(new Error(`${command} ${args.join(' ')} failed: ${stderr || code}`))
    })
  })

/**
 * Find or create the simulators this run needs, and return their UDIDs.
 *
 * @param {number} count
 * @returns {Promise<string[]>}
 */
const ensureShardSimulators = async (count) => {
  const parsed = JSON.parse(await capture('xcrun', ['simctl', 'list', 'devices', '-j']))
  /** @type {Map<string, string>} */
  const byName = new Map()
  for (const devices of Object.values(parsed.devices ?? {})) {
    for (const device of devices) {
      if (device?.isAvailable !== false && typeof device?.name === 'string') {
        byName.set(device.name, device.udid)
      }
    }
  }

  const udids = []
  for (let index = 0; index < count; index += 1) {
    const name = `${SHARD_DEVICE_PREFIX}-${index + 1}`
    const existing = byName.get(name)
    if (existing) {
      udids.push(existing)
      continue
    }

    const runtimes = JSON.parse(
      await capture('xcrun', ['simctl', 'list', 'runtimes', '-j'])
    )
    const runtime = (runtimes.runtimes ?? [])
      .filter((entry) => entry?.isAvailable !== false && /iOS/.test(entry?.name ?? ''))
      .pop()
    const deviceTypes = JSON.parse(
      await capture('xcrun', ['simctl', 'list', 'devicetypes', '-j'])
    )
    const deviceType =
      (deviceTypes.devicetypes ?? []).find((entry) => entry?.name === IOS_DEVICE_NAME) ??
      (deviceTypes.devicetypes ?? [])
        .filter((entry) => /^iPhone \d+$/.test(entry?.name ?? ''))
        .sort(
          (a, b) =>
            Number(/\d+/.exec(a.name)?.[0] ?? 0) - Number(/\d+/.exec(b.name)?.[0] ?? 0)
        )
        .pop()
    if (!runtime || !deviceType) {
      throw new Error(
        'Could not resolve an iPhone device type and iOS runtime to create shard simulators with.'
      )
    }
    log(`Creating simulator ${name} (${deviceType.name}, ${runtime.name})`)
    const created = await capture('xcrun', [
      'simctl',
      'create',
      name,
      deviceType.identifier,
      runtime.identifier,
    ])
    udids.push(created.trim())
  }
  return udids
}

/**
 * The system image the shard AVDs are created from.
 *
 * Read off disk rather than downloaded: an installer that fetches a multi-
 * gigabyte image mid-run turns "the suite is slow" into "the suite hung", and
 * the image a developer already has is the one their serial runs used.
 *
 * @returns {{ packagePath: string, tag: string, abi: string, api: string }}
 */
const resolveAndroidSystemImage = () => {
  const root = androidBinary('system-images')
  if (!fs.existsSync(root)) {
    throw new Error(
      `No Android system images under ${root}. Install one from Android Studio's SDK Manager.`
    )
  }

  const hostAbi = os.arch() === 'arm64' ? 'arm64-v8a' : 'x86_64'
  const candidates = []
  for (const api of fs.readdirSync(root)) {
    for (const tag of fs.readdirSync(path.join(root, api))) {
      for (const abi of fs.readdirSync(path.join(root, api, tag))) {
        candidates.push({
          api,
          tag,
          abi,
          packagePath: `system-images;${api};${tag};${abi}`,
        })
      }
    }
  }

  // The emulator can run a foreign ABI, at a speed that makes an 18-flow suite
  // pointless, so a mismatched image is treated as no image at all.
  const usable = candidates.filter((entry) => entry.abi === hostAbi)
  if (usable.length === 0) {
    throw new Error(
      `No ${hostAbi} Android system image is installed (found: ${
        candidates.map((entry) => entry.packagePath).join(', ') || 'none'
      }).`
    )
  }

  // Prefer a Play Store image: Expo Go is installed from an APK either way, but
  // the serial runs this suite's results come from used one.
  const preferred =
    usable.filter((entry) => entry.tag === 'google_apis_playstore').pop() ?? usable.pop()
  return preferred
}

/**
 * Find or create the AVDs this run needs.
 *
 * Created once and reused, for the same reason the simulators are: a fresh AVD
 * per run means a fresh Expo Go install per run.
 *
 * @param {number} count
 * @returns {Promise<string[]>}
 */
const ensureShardAvds = async (count) => {
  const emulatorBinary = androidBinary('emulator', 'emulator')
  const avdManagerBinary = androidBinary('cmdline-tools', 'latest', 'bin', 'avdmanager')
  for (const [label, binary] of [
    ['emulator', emulatorBinary],
    ['avdmanager', avdManagerBinary],
  ]) {
    if (!fs.existsSync(binary)) {
      throw new Error(
        `${label} not found at ${binary}. Set ANDROID_HOME or install the Android SDK.`
      )
    }
  }

  const existing = new Set(
    (await capture(emulatorBinary, ['-list-avds']))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  )

  const names = []
  let image
  for (let index = 0; index < count; index += 1) {
    const name = `${SHARD_DEVICE_PREFIX}-${index + 1}`
    names.push(name)
    if (existing.has(name)) continue

    image = image ?? resolveAndroidSystemImage()
    log(`Creating AVD ${name} (${ANDROID_DEVICE_PROFILE}, ${image.packagePath})`)
    // avdmanager prompts for a custom hardware profile even when `--device` is
    // given, and a prompt with no stdin hangs the run rather than failing it.
    await capture(
      avdManagerBinary,
      [
        'create',
        'avd',
        '--name',
        name,
        '--package',
        image.packagePath,
        '--device',
        ANDROID_DEVICE_PROFILE,
      ],
      { input: 'no\n' }
    )
  }
  return names
}

/**
 * Boot one emulator per shard and return their adb serials.
 *
 * Each emulator is pinned to an explicit console port, which is what makes its
 * serial predictable: `emulator -port 5556` is `emulator-5556`. Letting the
 * emulator pick would mean discovering serials by diffing `adb devices`, which
 * is a race as soon as two boot at once.
 *
 * @param {string[]} avdNames
 * @returns {Promise<string[]>}
 */
const bootShardEmulators = async (avdNames) => {
  const emulatorBinary = androidBinary('emulator', 'emulator')
  const adbBinary = androidBinary('platform-tools', 'adb')

  const attached = new Set(
    (await capture(adbBinary, ['devices']))
      .split('\n')
      .slice(1)
      .map((line) => line.split(/\s+/))
      .filter(([, state]) => state === 'device')
      .map(([serial]) => serial)
  )

  const serials = []
  for (const [index, name] of avdNames.entries()) {
    const port = ANDROID_BASE_PORT + index * 2
    const serial = `emulator-${port}`
    serials.push(serial)
    if (attached.has(serial)) {
      log(`Reusing already-booted ${serial} (${name})`)
      continue
    }

    const logPath = path.join(os.tmpdir(), `avd-${name}.log`)
    log(`Booting ${name} on ${serial} (log: ${logPath})`)
    const child = spawn(
      emulatorBinary,
      [
        '-avd',
        name,
        '-port',
        String(port),
        '-no-snapshot',
        '-no-boot-anim',
        '-no-audio',
        '-gpu',
        'swiftshader_indirect',
        ...(ANDROID_HEADLESS ? ['-no-window'] : []),
      ],
      {
        detached: true,
        stdio: ['ignore', fs.openSync(logPath, 'a'), fs.openSync(logPath, 'a')],
      }
    )
    child.unref()
  }

  for (const serial of serials) {
    log(`Waiting for ${serial} to finish booting`)
    // `wait-for-device` returns as soon as adb can see it, which is well before
    // the framework is up; `sys.boot_completed` is the property that means the
    // device can actually launch an app.
    await capture(adbBinary, ['-s', serial, 'wait-for-device'])
    const deadline = Date.now() + BOOT_TIMEOUT_MS
    for (;;) {
      const booted = await capture(adbBinary, [
        '-s',
        serial,
        'shell',
        'getprop',
        'sys.boot_completed',
      ]).catch(() => '')
      if (booted.trim() === '1') break
      if (Date.now() > deadline) {
        throw new Error(
          `${serial} did not report sys.boot_completed within ${BOOT_TIMEOUT_MS / 1000}s.`
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
    await capture(adbBinary, ['-s', serial, 'shell', 'input', 'keyevent', '82']).catch(
      () => {}
    )
    log(`${serial} ready`)
  }

  return serials
}

const run = async () => {
  if (PLATFORM === 'ios' && os.platform() !== 'darwin') {
    throw new Error('Sharded iOS runs need macOS.')
  }

  const startedAt = Date.now()
  const passthroughArgs = process.argv.slice(2).filter((arg, index, all) => {
    if (arg === '--shards' || arg === '--platform') return false
    return all[index - 1] !== '--shards' && all[index - 1] !== '--platform'
  })

  /** @type {Record<string, string>} */
  let deviceEnv
  if (PLATFORM === 'android') {
    const avdNames = await ensureShardAvds(SHARD_COUNT)
    const serials = await bootShardEmulators(avdNames)
    log(`Driving ${serials.length} emulators: ${serials.join(', ')}`)
    deviceEnv = { MOBILE_E2E_ANDROID_SERIALS: serials.join(',') }
  } else {
    const udids = await ensureShardSimulators(SHARD_COUNT)
    log(`Driving ${udids.length} simulators: ${udids.join(', ')}`)
    deviceEnv = { MOBILE_E2E_IOS_UDIDS: udids.join(',') }
  }

  const exitCode = await new Promise((resolve) => {
    const child = spawn(
      'node',
      ['./scripts/run-maestro.mjs', ...passthroughArgs, '--artifacts'],
      {
        cwd: projectRoot,
        stdio: 'inherit',
        env: {
          ...process.env,
          MOBILE_E2E_PLATFORM: PLATFORM,
          ...deviceEnv,
          // Expo CLI would open the app on whichever device it resolves first.
          // Maestro launches the app itself on each device.
          MOBILE_E2E_EXPO_NO_OPEN: '1',
        },
      }
    )
    child.on('close', (code) => resolve(code ?? 1))
  })

  log(`Parallel suite finished in ${((Date.now() - startedAt) / 60_000).toFixed(1)}m`)
  if (exitCode !== 0) {
    throw new Error(`Maestro reported failures (exit code ${exitCode})`)
  }
}

run().catch((err) => {
  console.error('[maestro:shards] Parallel run failed')
  console.error(err)
  process.exit(1)
})
