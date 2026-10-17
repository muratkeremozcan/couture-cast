/*
 * Measures how many Redis commands an idle community worker spends, against a
 * Redis the worker alone is connected to.
 *
 * Story 6.2b. A BullMQ consumer polls Redis whether or not anyone posts, and
 * the production database's Upstash Pay as You Go plan bills every command. This
 * reports commands; the readiness generator prices them. Start the worker
 * container against a local Redis that
 * nothing else uses, then run this for a window; it resets Redis's command
 * statistics, waits, and reports commands per hour and the projected monthly
 * total, with the per-command breakdown. Its own statistics reads are
 * subtracted.
 *
 * Story 6.2b peer review (CX6): an idle window with no worker connected costs
 * almost nothing and would understate the budget. The worker is identified by
 * the name the container gives itself (its baked commit), and its presence is
 * sampled through the whole window from its Redis heartbeat
 * (`community-worker:heartbeat:<name>:<instance>`); the report records every
 * sample, and the readiness gate rejects an idle product whose worker process
 * did not hold one heartbeat throughout. The heartbeat is the authority because
 * CLIENT LIST on Upstash shows one node's clients (Story 6.2b review, RF15);
 * CLIENT LIST is still sampled here, on a one-node local Redis, as a
 * cross-check. The samples' own SCAN, GET, PTTL and CLIENT LIST calls are
 * subtracted like the statistics reads. The worker's heartbeat refreshes are
 * the worker's own cost and stay in.
 *
 * `--canary-runs <n>` measures traffic instead: it runs the local canary n times
 * and reports the commands one screened post costs, with the idle rate from
 * `--idle-baseline <file>` subtracted for the time the runs took. The canary's
 * own lookups (worker count, job state, job removal) are included, so the
 * figure is an upper bound on what a member's post costs.
 *
 * Usage:
 *   node scripts/measure-community-worker-redis.mjs [--minutes 10] [--redis-url redis://localhost:6379] [--container cc-community-worker]
 *   node scripts/measure-community-worker-redis.mjs --canary-runs 5 --idle-baseline <redis-idle.json>
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { workerNameFor } from './community-screening-canary.mjs'
import { readHeartbeats } from './lib/community-worker-heartbeat.mjs'
import { inputSetHash } from './lib/community-screening-input-set.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const HOURS_PER_MONTH = 730
/** How often the worker's connection is checked during the idle window. */
export const PRESENCE_SAMPLE_INTERVAL_MS = 15_000

function parseArgs(argv) {
  const options = {
    minutes: 10,
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    canaryRuns: 0,
    idleBaseline: null,
    container: 'cc-community-worker',
  }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--minutes') options.minutes = Number(argv[++index])
    else if (argv[index] === '--container') options.container = argv[++index]
    else if (argv[index] === '--canary-runs') options.canaryRuns = Number(argv[++index])
    else if (argv[index] === '--idle-baseline') options.idleBaseline = argv[++index]
    else if (argv[index] === '--redis-url') options.redisUrl = argv[++index]
    else throw new Error(`Unknown argument: ${argv[index]}`)
  }
  if (!(options.minutes > 0)) throw new Error('--minutes must be positive')
  if (!Number.isInteger(options.canaryRuns) || options.canaryRuns < 0) {
    throw new Error('--canary-runs must be a non-negative integer')
  }
  return options
}

/**
 * The ids of the named worker's connections in a CLIENT LIST reply. BullMQ names
 * a worker's connection `<prefix>:<base64 queue>:w:<worker name>`.
 */
export function workerClientIds(clientList, workerName) {
  return clientList
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      Object.fromEntries(line.split(' ').map((pair) => pair.split(/=(.*)/s)))
    )
    .filter((client) => client.name?.endsWith(`:w:${workerName}`))
    .map((client) => client.id)
}

/**
 * One presence sample: the named worker's heartbeat instances, the other
 * workers' heartbeats, and the named worker's CLIENT LIST connections.
 */
export function presenceSample(at, heartbeats, clientIds, workerName) {
  const live = heartbeats.known ? heartbeats.heartbeats : []
  return {
    at,
    heartbeatKnown: heartbeats.known === true,
    instanceIds: live
      .filter((heartbeat) => heartbeat.workerName === workerName)
      .map((heartbeat) => heartbeat.instanceId),
    otherWorkers: live
      .filter((heartbeat) => heartbeat.workerName !== workerName)
      .map((heartbeat) => heartbeat.workerName),
    clientIds,
  }
}

/**
 * Whether one worker process, the named one, held its heartbeat at every
 * sample, and what was seen. A sample counts when the heartbeat scan finished
 * and found exactly one heartbeat of the named worker; the window counts when
 * every sample did and they all name the same instance, so a worker that
 * restarted mid-window does not pass as one idle process.
 */
export function summarizeWorkerPresence(workerName, samples) {
  const connected = samples.filter(
    (sample) => sample.heartbeatKnown === true && sample.instanceIds?.length === 1
  )
  const instanceIds = [...new Set(samples.flatMap((sample) => sample.instanceIds ?? []))]
  return {
    name: workerName,
    presenceSource: 'heartbeat',
    sampleIntervalSeconds: PRESENCE_SAMPLE_INTERVAL_MS / 1000,
    samples: samples.length,
    connectedSamples: connected.length,
    connectedThroughout:
      samples.length >= 2 &&
      connected.length === samples.length &&
      instanceIds.length === 1,
    instanceIds,
    otherWorkers: [...new Set(samples.flatMap((sample) => sample.otherWorkers ?? []))],
    firstSampleAt: samples[0]?.at ?? null,
    lastSampleAt: samples.at(-1)?.at ?? null,
    clientListSamples: samples.filter((sample) => sample.clientIds?.length > 0).length,
    clientIds: [...new Set(samples.flatMap((sample) => sample.clientIds ?? []))],
  }
}

/** The worker the container runs, named from its baked commit. */
function containerWorker(container) {
  const env = Object.fromEntries(
    JSON.parse(
      execFileSync('docker', ['inspect', container, '--format', '{{json .Config.Env}}'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    ).map((line) => line.split(/=(.*)/s).slice(0, 2))
  )
  const commitSha = env.COMMUNITY_WORKER_COMMIT_SHA?.trim()
  if (!commitSha || commitSha === 'unset') {
    throw new Error(
      `${container} has no baked COMMUNITY_WORKER_COMMIT_SHA to name its worker`
    )
  }
  return {
    container,
    commitSha,
    name: workerNameFor(commitSha),
    containerInputSetHash: env.COMMUNITY_WORKER_INPUT_SET_HASH ?? null,
  }
}

export function parseCommandStats(info) {
  const stats = {}
  for (const line of info.split('\n')) {
    const match = /^cmdstat_([a-z|_-]+):calls=(\d+)/.exec(line.trim())
    if (match) stats[match[1]] = Number(match[2])
  }
  return stats
}

async function measurePerPost(redis, options) {
  if (!options.idleBaseline) throw new Error('--canary-runs needs --idle-baseline')
  const idle = JSON.parse(fs.readFileSync(path.resolve(options.idleBaseline), 'utf8'))
  await redis.config('RESETSTAT')
  const startedAt = Date.now()
  for (let run = 0; run < options.canaryRuns; run += 1) {
    execFileSync(
      process.execPath,
      [
        path.join(projectRoot, 'scripts/community-screening-canary.mjs'),
        '--target',
        'local',
        '--env-file',
        '.env.local',
      ],
      // The child canary measures against the Redis this run counts, not
      // whatever its env file names.
      {
        cwd: projectRoot,
        stdio: 'ignore',
        env: { ...process.env, REDIS_URL: options.redisUrl },
      }
    )
  }
  const stats = parseCommandStats(await redis.info('commandstats'))
  if (stats.info) stats.info -= 1
  delete stats['config|resetstat']
  const elapsedHours = (Date.now() - startedAt) / 3_600_000
  const total = Object.values(stats).reduce((sum, calls) => sum + calls, 0)
  const idleShare = idle.commandsPerHour * elapsedHours
  return {
    measuredAt: new Date().toISOString(),
    inputSetHash: inputSetHash(),
    canaryRuns: options.canaryRuns,
    commandsDuringRuns: total,
    idleCommandsSubtracted: Math.round(idleShare),
    commandsPerPost: Math.round((total - idleShare) / options.canaryRuns),
    byCommandPerPost: Object.fromEntries(
      Object.entries(stats)
        .filter(([, calls]) => calls > 0)
        .toSorted((a, b) => b[1] - a[1])
        .map(([command, calls]) => [
          command,
          Number((calls / options.canaryRuns).toFixed(1)),
        ])
    ),
    note: 'Upper bound: includes the canary’s own heartbeat scan, CLIENT LIST cross-check, job-state and job-removal lookups beside the dispatch-equivalent enqueue and the screening itself.',
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const { default: Redis } = await import('ioredis')
  const redis = new Redis(options.redisUrl, { maxRetriesPerRequest: 1 })
  if (options.canaryRuns > 0) {
    const report = await measurePerPost(redis, options)
    await redis.quit()
    console.log(JSON.stringify(report, null, 2))
    return
  }
  const worker = containerWorker(options.container)
  const clients = (await redis.client('LIST')).trim().split('\n').length - 1
  await redis.config('RESETSTAT')
  const startedAt = Date.now()
  const windowEnd = startedAt + options.minutes * 60_000
  const samples = []
  const own = { scan: 0, get: 0, pttl: 0 }
  const sample = async () => {
    const heartbeats = await readHeartbeats(redis)
    for (const command of Object.keys(own)) own[command] += heartbeats.commands[command]
    const clientIds = workerClientIds(await redis.client('LIST'), worker.name)
    samples.push(
      presenceSample(new Date().toISOString(), heartbeats, clientIds, worker.name)
    )
  }
  await sample()
  while (Date.now() < windowEnd) {
    const wait = Math.min(PRESENCE_SAMPLE_INTERVAL_MS, windowEnd - Date.now())
    await new Promise((resolve) => setTimeout(resolve, wait))
    await sample()
  }
  const stats = parseCommandStats(await redis.info('commandstats'))
  await redis.quit()
  const elapsedHours = (Date.now() - startedAt) / 3_600_000

  // This script issued one INFO, one CONFIG RESETSTAT, and per presence sample
  // the heartbeat scan's SCAN, GET and PTTL calls and one CLIENT LIST; none of
  // them is the worker's.
  if (stats.info) stats.info -= 1
  if (stats['client|list']) stats['client|list'] -= samples.length
  for (const [command, calls] of Object.entries(own)) {
    if (stats[command]) stats[command] -= calls
  }
  delete stats['config|resetstat']
  const presence = summarizeWorkerPresence(worker.name, samples)
  if (!presence.connectedThroughout) {
    throw new Error(
      `${worker.name} held one heartbeat at ${presence.connectedSamples} of ${presence.samples} samples (instances ${JSON.stringify(presence.instanceIds)}); an idle window without the worker measures nothing.`
    )
  }
  const total = Object.values(stats).reduce((sum, calls) => sum + calls, 0)
  const perHour = total / elapsedHours
  const perMonth = perHour * HOURS_PER_MONTH
  const report = {
    measuredAt: new Date().toISOString(),
    inputSetHash: inputSetHash(),
    windowMinutes: options.minutes,
    otherClientsAtStart: clients,
    worker: {
      ...presence,
      container: worker.container,
      commitSha: worker.commitSha,
      containerInputSetHash: worker.containerInputSetHash,
    },
    presenceSamples: samples,
    commands: total,
    commandsPerHour: Math.round(perHour),
    commandsPerDay: Math.round(perHour * 24),
    projectedCommandsPerMonth: Math.round(perMonth),
    byCommandPerHour: Object.fromEntries(
      Object.entries(stats)
        .filter(([, calls]) => calls > 0)
        .toSorted((a, b) => b[1] - a[1])
        .map(([command, calls]) => [command, Math.round(calls / elapsedHours)])
    ),
  }
  console.log(JSON.stringify(report, null, 2))
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((error) => {
    console.error(
      `[redis-measure] ${error instanceof Error ? error.message : String(error)}`
    )
    process.exit(1)
  })
}
