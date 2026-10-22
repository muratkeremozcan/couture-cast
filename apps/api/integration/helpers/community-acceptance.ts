// Story 6.5 acceptance harness #3: evidence, DB clock and usage collection shared by lanes.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PrismaClient } from '@prisma/client'
import { readySchema, type OwnedProcess } from './community-engagement-harness.js'

/** Writes a lane's timeline beside its `run-evidence.py` record when one is configured. */
export async function writeEvidence(name: string, value: unknown) {
  const directory = process.env.STORY65_EVIDENCE_DIR
  if (!directory) return
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * DB clock minus local wall clock, in ms, from the lowest-latency of several round trips.
 *
 * Cache claims, origins and expiries are stamped with `clock_timestamp()`, so a lane
 * schedules its phases on DB time. The bound is half that round trip.
 */
export async function dbClockSkew(prisma: PrismaClient) {
  let best = { skew: 0, roundTrip: Number.POSITIVE_INFINITY }
  for (let sample = 0; sample < 7; sample++) {
    const sent = Date.now()
    const [row] = await prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    const received = Date.now()
    const roundTrip = received - sent
    if (row && roundTrip < best.roundTrip)
      best = { skew: row.now.getTime() - (sent + received) / 2, roundTrip }
  }
  return { skewMs: best.skew, boundMs: best.roundTrip / 2 }
}

export async function usageCollector(
  spawn: (file: string, variables?: NodeJS.ProcessEnv) => OwnedProcess,
  databaseUrl: string
) {
  const child = spawn('community-usage-collector.mjs', {
    STORY65_COLLECTOR_DATABASE_URL: databaseUrl,
    STORY65_COLLECTOR_REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    STORY65_COLLECTOR_STATEMENTS_URL:
      process.env.INTEGRATION_TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  readySchema.parse(await child.event('ready', 10_000))
  return {
    child,
    track: (pids: Record<string, number | undefined>) =>
      child.call(
        'track',
        Object.fromEntries(Object.entries(pids).filter(([, pid]) => pid !== undefined))
      ),
    start: () => child.call('start'),
    stop: () => child.call('stop'),
  }
}
