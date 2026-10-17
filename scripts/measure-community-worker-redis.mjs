/*
 * Measures how many Redis commands an idle community worker spends, against a
 * Redis the worker alone is connected to.
 *
 * Story 6.2b. A BullMQ consumer polls Redis whether or not anyone posts, and a
 * metered free tier counts every command: the Upstash free plan allows 500,000
 * commands a month. Start the worker container against a local Redis that
 * nothing else uses, then run this for a window; it resets Redis's command
 * statistics, waits, and reports commands per hour and the projected monthly
 * total, with the per-command breakdown. Its own statistics reads are
 * subtracted.
 *
 * `--canary-runs <n>` measures traffic instead: it runs the local canary n times
 * and reports the commands one screened post costs, with the idle rate from
 * `--idle-baseline <file>` subtracted for the time the runs took. The canary's
 * own lookups (worker count, job state, job removal) are included, so the
 * figure is an upper bound on what a member's post costs.
 *
 * Usage:
 *   node scripts/measure-community-worker-redis.mjs [--minutes 10] [--redis-url redis://localhost:6379]
 *   node scripts/measure-community-worker-redis.mjs --canary-runs 5 --idle-baseline <redis-idle.json>
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inputSetHash } from './lib/community-screening-input-set.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const UPSTASH_FREE_MONTHLY_COMMANDS = 500_000
const HOURS_PER_MONTH = 730

function parseArgs(argv) {
  const options = {
    minutes: 10,
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    canaryRuns: 0,
    idleBaseline: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--minutes') options.minutes = Number(argv[++index])
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
    note: 'Upper bound: includes the canary’s own worker-count, job-state and job-removal lookups beside the dispatch-equivalent enqueue and the screening itself.',
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
  const clients = (await redis.client('LIST')).trim().split('\n').length - 1
  await redis.config('RESETSTAT')
  const startedAt = Date.now()
  await new Promise((resolve) => setTimeout(resolve, options.minutes * 60_000))
  const stats = parseCommandStats(await redis.info('commandstats'))
  await redis.quit()
  const elapsedHours = (Date.now() - startedAt) / 3_600_000

  // This script issued one INFO and one CONFIG RESETSTAT; neither is the worker's.
  if (stats.info) stats.info -= 1
  delete stats['config|resetstat']
  const total = Object.values(stats).reduce((sum, calls) => sum + calls, 0)
  const perHour = total / elapsedHours
  const perMonth = perHour * HOURS_PER_MONTH
  const report = {
    measuredAt: new Date().toISOString(),
    inputSetHash: inputSetHash(),
    windowMinutes: options.minutes,
    otherClientsAtStart: clients,
    commands: total,
    commandsPerHour: Math.round(perHour),
    commandsPerDay: Math.round(perHour * 24),
    projectedCommandsPerMonth: Math.round(perMonth),
    upstashFreeMonthlyCommands: UPSTASH_FREE_MONTHLY_COMMANDS,
    shareOfFreeTier: Number((perMonth / UPSTASH_FREE_MONTHLY_COMMANDS).toFixed(3)),
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
