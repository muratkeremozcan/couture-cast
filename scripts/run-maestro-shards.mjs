#!/usr/bin/env node
/**
 * Run the Maestro suite across several simulators at once.
 *
 * The suite is serial by nature: `scripts/run-maestro.mjs` drives one device
 * and one flow at a time, so eighteen flows cost the sum of eighteen flows.
 * That is roughly 35 minutes on this machine, which is too slow to gate a pull
 * request next to the ~10 minute Playwright job.
 *
 * The obvious lever, Maestro's own `--shard-split N`, is not enough on its own.
 * It splits flows across N connected devices in a single invocation, so every
 * device shares one set of `-e` values, one Metro bundle, and therefore one
 * fixture user. These flows create, rename and delete capsules and garments for
 * the signed-in user, so sharing a user across concurrent devices means shards
 * corrupting each other's data.
 *
 * This orchestrator gives each shard the isolation a Playwright worker gets:
 *
 *   per shard      simulator, Metro port, Expo dev-server ports, Metro cache
 *                  directory, signed-up user, bearer token, seeded wardrobe
 *   shared         the API on :4000, Postgres, Redis, the app source
 *
 * The per-user part is what makes it safe, and it is only possible because
 * `EXPO_PUBLIC_E2E_ACCESS_TOKEN` is baked into the bundle at Metro startup:
 * one bundler per shard means one token per shard.
 *
 * Usage:
 *   node ./scripts/run-maestro-shards.mjs                # 4 shards
 *   node ./scripts/run-maestro-shards.mjs --shards 2
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

const ARTIFACT_DIR = process.env.MAESTRO_ARTIFACT_DIR || 'maestro/artifacts'
const API_HEALTH_URL = 'http://127.0.0.1:4000/api/health'
const MOBILE_E2E_DATABASE_URL =
  process.env.MOBILE_E2E_DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/**
 * The device name prefix this script owns.
 *
 * Simulators are created once and reused across runs; creating four devices per
 * run would leave a pile of them behind and cost a fresh Expo Go install every
 * time.
 */
const SHARD_DEVICE_PREFIX = 'couture-e2e'

/**
 * The simulator model every shard runs on.
 *
 * `scripts/start-ios-simulator.sh` boots `iPhone 17` for a serial run, so the
 * shards use the same model and their results stay comparable with it.
 */
const IOS_DEVICE_NAME = process.env.IOS_SIM_DEVICE || 'iPhone 17'

/**
 * Same discovery rule as `run-maestro.mjs`: every flow in `maestro/`, minus
 * Maestro's reserved `config.yaml`, sorted so the split is reproducible.
 *
 * @returns {string[]}
 */
const discoverFlows = () => {
  const flowsDir = path.join(projectRoot, 'maestro')
  return fs
    .readdirSync(flowsDir)
    .filter((entry) => entry.endsWith('.yaml') && entry !== 'config.yaml')
    .map((entry) => `maestro/${entry}`)
    .sort()
}

/**
 * Read the last measured duration of each flow from its JUnit report.
 *
 * Splitting evenly by flow count would put `commerce-affiliate` (6 minutes) and
 * `garment-capsule-repair` (2.5 minutes) in the same shard as often as not, and
 * the suite is only as fast as its slowest shard.
 *
 * @param {string[]} flows
 * @returns {Map<string, number>}
 */
const readFlowDurations = (flows) => {
  const durations = new Map()
  for (const flow of flows) {
    const name = path.basename(flow, '.yaml')
    const reportPath = path.join(projectRoot, ARTIFACT_DIR, `${name}-report.xml`)
    try {
      const xml = fs.readFileSync(reportPath, 'utf8')
      const match = /time="([0-9.]+)"/.exec(xml)
      const failed = /failures="([1-9][0-9]*)"/.test(xml)
      // A failed report's time is the time to fail, which for a driver
      // disconnect is a 20 minute hang. Using it would starve one shard.
      if (match && !failed) {
        durations.set(flow, Number(match[1]))
      }
    } catch {
      // No report yet: fall through to the default below.
    }
  }
  return durations
}

/**
 * Longest-processing-time partition: sort the flows longest first and hand each
 * to whichever shard currently has the least work. Standard greedy makespan
 * scheduling, and it is what keeps four shards finishing within a minute or so
 * of one another.
 *
 * @param {string[]} flows
 * @param {number} shardCount
 * @returns {{ flows: string[], seconds: number }[]}
 */
const partitionFlows = (flows, shardCount) => {
  const durations = readFlowDurations(flows)
  const measured = [...durations.values()]
  const fallback =
    measured.length > 0
      ? measured.reduce((sum, value) => sum + value, 0) / measured.length
      : 90

  const shards = Array.from({ length: shardCount }, () => ({ flows: [], seconds: 0 }))
  const ordered = [...flows].sort(
    (a, b) => (durations.get(b) ?? fallback) - (durations.get(a) ?? fallback)
  )

  for (const flow of ordered) {
    const target = shards.reduce((min, shard) =>
      shard.seconds < min.seconds ? shard : min
    )
    target.flows.push(flow)
    target.seconds += durations.get(flow) ?? fallback
  }

  // Restore alphabetical order inside each shard so a shard's own run is still
  // the stable order the flows were written against.
  for (const shard of shards) {
    shard.flows.sort()
  }
  return shards
}

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
    // Match the device the serial suite was written and measured against. A
    // different iPhone is a different screen height, and these flows assert on
    // elements that sit under a sticky tab bar or the software keyboard, so
    // silently shipping shards onto another model would make a shard failure
    // impossible to compare with a serial run.
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
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
const waitForHealth = async (url, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  return false
}

const run = async () => {
  if (os.platform() !== 'darwin') {
    throw new Error('Sharded Maestro runs are iOS-only today and need macOS.')
  }

  const flows = discoverFlows()
  const shards = partitionFlows(flows, SHARD_COUNT)
  const projected = Math.max(...shards.map((shard) => shard.seconds))
  log(`${flows.length} flows across ${SHARD_COUNT} shards`)
  shards.forEach((shard, index) => {
    log(
      `  shard ${index + 1}: ${shard.flows.length} flows, ~${Math.round(shard.seconds / 60)}m`
    )
    for (const flow of shard.flows) log(`    ${flow}`)
  })
  log(`Projected wall clock: ~${Math.round(projected / 60)}m of flows plus setup`)

  // `--plan` prints the split and stops. It is how the shard count for CI gets
  // chosen without booting anything.
  if (process.argv.includes('--plan')) return

  const udids = await ensureShardSimulators(SHARD_COUNT)

  // One API for every shard. Each shard signs up its own user against it, so
  // the isolation that matters is per user, not per API.
  let apiProcess
  const apiAlreadyRunning = await waitForHealth(API_HEALTH_URL, 2_000)
  if (apiAlreadyRunning) {
    log('Reusing the local API already listening on :4000')
  } else {
    log('Starting one local API for all shards')
    apiProcess = spawn('npm', ['run', 'start:api:e2e-with-workers'], {
      cwd: projectRoot,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        ALLOW_DEV_GUARDIAN_SECRET: 'true',
        DATABASE_URL: MOBILE_E2E_DATABASE_URL,
        GUARDIAN_INVITE_WEB_BASE_URL: 'http://127.0.0.1:3005',
        GARMENT_TAGGING_ENGINE: 'fixture',
        PUBLIC_API_URL: 'http://127.0.0.1:4000',
        TEST_ENV: 'local',
      },
    })
    if (!(await waitForHealth(API_HEALTH_URL, 180_000))) {
      throw new Error('Local API never became healthy for the sharded run')
    }
    log('Local API reachable on :4000')
  }

  const startedAt = Date.now()
  const results = await Promise.all(
    shards.map(
      (shard, index) =>
        new Promise((resolve) => {
          const shardNumber = index + 1
          const metroPort = 8081 + index
          const tmpDir = path.join(os.tmpdir(), `couture-maestro-shard-${shardNumber}`)
          fs.mkdirSync(tmpDir, { recursive: true })

          const child = spawn(
            'node',
            ['./scripts/run-maestro.mjs', ...shard.flows, '--artifacts'],
            {
              cwd: projectRoot,
              stdio: 'inherit',
              env: {
                ...process.env,
                MOBILE_E2E_PLATFORM: 'ios',
                MOBILE_E2E_IOS_UDID: udids[index],
                MOBILE_E2E_METRO_PORT: String(metroPort),
                MOBILE_E2E_SHARD_LABEL: `shard ${shardNumber}/${SHARD_COUNT}`,
                MOBILE_E2E_SKIP_WORKER: '1',
                MOBILE_E2E_EXPO_NO_OPEN: '1',
                EXPO_DEV_SERVER_PORT: String(19000 + index * 10),
                EXPO_PACKAGER_PROXY_PORT: String(19000 + index * 10),
                EXPO_USE_DEV_SERVER_PORT: String(19000 + index * 10),
                EXPO_WEB_PORT: String(19005 + index * 10),
                // Metro keys its cache under the temp directory. Four bundlers
                // sharing one cache directory is a corruption risk that costs
                // more than the disk a per-shard cache uses.
                TMPDIR: tmpDir,
              },
            }
          )
          child.on('close', (code) => {
            resolve({ shardNumber, code: code ?? 1, flows: shard.flows })
          })
        })
    )
  )

  const elapsedMinutes = ((Date.now() - startedAt) / 60_000).toFixed(1)
  const failed = results.filter((result) => result.code !== 0)
  for (const result of results) {
    log(
      `shard ${result.shardNumber}: ${result.code === 0 ? 'PASS' : 'FAIL'} (${result.flows.length} flows)`
    )
  }
  log(`Sharded suite finished in ${elapsedMinutes}m`)

  if (apiProcess?.pid) {
    log('Stopping the local API')
    try {
      process.kill(-apiProcess.pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }

  if (failed.length > 0) {
    throw new Error(
      `${failed.length} shard(s) reported failures: ${failed
        .map((result) => result.shardNumber)
        .join(', ')}`
    )
  }
}

run().catch((err) => {
  console.error('[maestro:shards] Sharded run failed')
  console.error(err)
  process.exit(1)
})
