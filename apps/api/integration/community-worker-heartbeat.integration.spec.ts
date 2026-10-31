// Learning path Step 40: Community screening release gate and hosted worker.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-40-community-screening-release-gate-and-hosted-worker
// Story 6.2b review (RF15): the worker's presence heartbeat against real Redis.
//
// Upstash answers CLIENT LIST from one node, so the canary and the measurements
// count consumers by the heartbeat keys each worker process writes. This runs a
// worker process with its heartbeat (scaled down: a 2-second TTL refreshed every
// 500 ms), and shows the three things the canary relies on: the key is there
// and kept alive while the worker runs, a graceful shutdown removes it at once,
// and a worker killed with SIGKILL, which removes nothing, drops out once the
// TTL passes.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import Redis from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getRedisConfig, redisOptionsFromConfig } from '../src/config/redis.js'

const repoRoot = path.resolve(__dirname, '../../..')
const childScript = path.join(__dirname, 'support/community-heartbeat-worker.ts')

const TTL_SECONDS = 2
const INTERVAL_MS = 500
const namespace = `heartbeat-${randomUUID().slice(0, 8)}`
const connection = redisOptionsFromConfig(getRedisConfig())

interface HeartbeatLib {
  readHeartbeats: (redis: Redis) => Promise<{
    known: boolean
    heartbeats: { key: string; workerName: string; ttlMs: number; problems: string[] }[]
  }>
}

let redis: Redis
let redisReady = false
const children: ChildProcess[] = []

beforeAll(async () => {
  redis = new Redis({ ...connection, maxRetriesPerRequest: 1, lazyConnect: true })
  redis.on('error', () => undefined)
  try {
    await redis.connect()
    await redis.ping()
    redisReady = true
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[community-worker-heartbeat] Skipped: Redis is not reachable.', error)
  }
})

afterAll(async () => {
  for (const child of children) child.kill('SIGKILL')
  if (redisReady) {
    const leftover = await redis.keys(`community-worker:heartbeat:${namespace}*`)
    if (leftover.length > 0) await redis.del(...leftover)
  }
  redis.disconnect()
})

/** Starts a heartbeat worker and resolves with it and its key once it wrote one. */
function startWorker(label: string): Promise<{ child: ChildProcess; key: string }> {
  const workerName = `${namespace}-${label}`
  // Node itself, with tsx as a loader: the `tsx` binary runs the script in a
  // second process, which a signal sent to the wrapper would not reach.
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      childScript,
      `${namespace}-${label}-queue`,
      workerName,
      String(TTL_SECONDS),
      String(INTERVAL_MS),
      JSON.stringify(connection),
    ],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'inherit'] }
  )
  children.push(child)
  return new Promise((resolve, reject) => {
    let buffered = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8')
      const line = buffered
        .split('\n')
        .find((candidate) => candidate.startsWith('ready '))
      if (line) resolve({ child, key: line.slice('ready '.length).trim() })
    })
    child.once('exit', (code) =>
      reject(new Error(`heartbeat worker exited (${String(code)}) before it was ready`))
    )
  })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('6.2b community worker heartbeat against Redis', () => {
  it('6.2b-INT-002 stays live while the worker runs and is gone the moment it shuts down gracefully', async (context) => {
    if (!redisReady) {
      context.skip()
      return
    }
    const { child, key } = await startWorker('graceful')
    const { readHeartbeats } = (await import(
      path.join(repoRoot, 'scripts/lib/community-worker-heartbeat.mjs')
    )) as HeartbeatLib

    // Across three TTLs it is refreshed and never lapses.
    for (let check = 0; check < 12; check += 1) {
      const ttl = await redis.pttl(key)
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(TTL_SECONDS * 1000)
      await sleep(INTERVAL_MS)
    }
    expect(JSON.parse((await redis.get(key)) ?? 'null')).toMatchObject({
      name: `${namespace}-graceful`,
      commitSha: null,
      pid: child.pid,
    })
    // The canary's reader sees it, by SCAN, as one live heartbeat.
    const observed = await readHeartbeats(redis)
    expect(observed.known).toBe(true)
    expect(observed.heartbeats.filter((heartbeat) => heartbeat.key === key)).toEqual([
      expect.objectContaining({ workerName: `${namespace}-graceful`, problems: [] }),
    ])

    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM')
    expect(await exited).toBe(0)
    expect(await redis.exists(key)).toBe(0)
  }, 30_000)

  it('6.2b-INT-003 outlives a SIGKILLed worker only until its TTL passes', async (context) => {
    if (!redisReady) {
      context.skip()
      return
    }
    const { child, key } = await startWorker('crash')
    await sleep(INTERVAL_MS * 2)

    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGKILL')
    await exited
    const killedAt = Date.now()

    // Nothing removed it: a crashed worker still reads as present...
    expect(await redis.exists(key)).toBe(1)
    // ...for at least the TTL less one refresh interval after its last refresh...
    await sleep(TTL_SECONDS * 1000 - INTERVAL_MS - 300)
    expect(await redis.exists(key)).toBe(1)
    // ...and no longer than the TTL.
    let goneAt: number | null = null
    while (Date.now() - killedAt < TTL_SECONDS * 1000 + 1_000) {
      if ((await redis.exists(key)) === 0) {
        goneAt = Date.now()
        break
      }
      await sleep(50)
    }
    expect(goneAt).not.toBeNull()
    expect((goneAt ?? Number.NaN) - killedAt).toBeLessThanOrEqual(
      TTL_SECONDS * 1000 + 100
    )
  }, 30_000)
})
