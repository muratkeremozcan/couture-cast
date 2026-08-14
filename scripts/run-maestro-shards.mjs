#!/usr/bin/env node
/**
 * Run the Maestro suite across several simulators at once.
 *
 * The serial suite costs the sum of its eighteen flows, roughly 35 minutes,
 * which is too slow to gate a pull request beside the ~10 minute Playwright job.
 *
 * This script only owns the devices. It creates and names the simulators, then
 * hands the whole list to `scripts/run-maestro.mjs`, which seeds one fixture
 * user per simulator and drives them from a single Maestro process using
 * Maestro's own `--shard-split`.
 *
 * Why a single Maestro process, rather than one per shard: Maestro pins its iOS
 * driver to a fixed host port and derives per-device ports from the device list
 * it is given. Two `maestro` processes on one machine therefore drive the same
 * XCUITest runner, and the symptoms are
 * `only one gesture can be performed at a time` and
 * `Failed to connect to /127.0.0.1:7001`.
 *
 * Why one user per simulator: the flows create, rename and delete capsules and
 * garments for the signed-in user. Sharing a user across concurrent devices
 * means shards corrupting each other's data. `EXPO_PUBLIC_E2E_ACCESS_TOKEN` is
 * baked into the bundle at Metro startup, so the bundle carries a map of device
 * name to token and `apps/mobile/src/lib/mobile-auth.ts` picks this device's
 * entry.
 *
 * Usage:
 *   node ./scripts/run-maestro-shards.mjs               # 4 simulators
 *   node ./scripts/run-maestro-shards.mjs --shards 2
 *   MOBILE_E2E_SHARDS=6 node ./scripts/run-maestro-shards.mjs
 */
import { spawn } from 'node:child_process'
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

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<string>}
 */
const capture = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
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

const run = async () => {
  if (os.platform() !== 'darwin') {
    throw new Error('Sharded Maestro runs are iOS-only today and need macOS.')
  }

  const udids = await ensureShardSimulators(SHARD_COUNT)
  log(`Driving ${udids.length} simulators: ${udids.join(', ')}`)

  const startedAt = Date.now()
  const passthroughArgs = process.argv.slice(2).filter((arg, index, all) => {
    if (arg === '--shards') return false
    return all[index - 1] !== '--shards'
  })

  const exitCode = await new Promise((resolve) => {
    const child = spawn(
      'node',
      ['./scripts/run-maestro.mjs', ...passthroughArgs, '--artifacts'],
      {
        cwd: projectRoot,
        stdio: 'inherit',
        env: {
          ...process.env,
          MOBILE_E2E_PLATFORM: 'ios',
          MOBILE_E2E_IOS_UDIDS: udids.join(','),
          // Expo CLI would open the app on whichever simulator it resolves
          // first. Maestro launches the app itself on each device.
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
