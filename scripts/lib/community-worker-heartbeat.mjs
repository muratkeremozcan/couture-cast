/*
 * Reads the community workers' presence heartbeats (Story 6.2b review, RF15).
 *
 * Each community worker process writes
 * `community-worker:heartbeat:<worker name>:<instance id>` with a TTL and
 * refreshes it (`apps/api/src/modules/community/community-worker-heartbeat.ts`,
 * whose prefix the release-gate spec holds equal to this one). A live key is a
 * worker process that refreshed within the TTL.
 *
 * This replaces `CLIENT LIST` (BullMQ's `queue.getWorkers()`) as the source of
 * truth for who consumes. Upstash answers `CLIENT LIST` per node: measured
 * against production on 2026-10-17, 5 of 12 fresh connections listed the hosted
 * worker's connection and 7 did not, while the worker stayed connected. That
 * made the hosted canary fail `worker_absent` against a healthy worker, and it
 * would hide a second consumer on another node from the sole-consumer proof. A
 * key reads the same from every node.
 *
 * The keys are found with SCAN and a MATCH pattern, never KEYS, in a bounded
 * loop: a scan that has not come back to cursor 0 within the bound is reported
 * as incomplete (`known: false`), never as a count.
 */

export const HEARTBEAT_KEY_PREFIX = 'community-worker:heartbeat:'
export const HEARTBEAT_KEY_PATTERN = `${HEARTBEAT_KEY_PREFIX}*`
/** SCAN's COUNT hint, and the most SCAN calls one read may make. */
export const HEARTBEAT_SCAN_COUNT = 1000
export const HEARTBEAT_SCAN_MAX_CALLS = 100

/**
 * The worker name and instance id a heartbeat key carries, or null for a key
 * that does not have the shape. The instance id is a UUID and the name has no
 * colon, so the last colon separates them.
 */
export function parseHeartbeatKey(key) {
  if (typeof key !== 'string' || !key.startsWith(HEARTBEAT_KEY_PREFIX)) return null
  const rest = key.slice(HEARTBEAT_KEY_PREFIX.length)
  const split = rest.lastIndexOf(':')
  if (split <= 0 || split === rest.length - 1) return null
  return { workerName: rest.slice(0, split), instanceId: rest.slice(split + 1) }
}

/** Every key matching the heartbeat pattern, and whether the scan finished. */
export async function scanHeartbeatKeys(
  redis,
  { count = HEARTBEAT_SCAN_COUNT, maxCalls = HEARTBEAT_SCAN_MAX_CALLS } = {}
) {
  const keys = new Set()
  let cursor = '0'
  let calls = 0
  do {
    const [next, batch] = await redis.scan(
      cursor,
      'MATCH',
      HEARTBEAT_KEY_PATTERN,
      'COUNT',
      count
    )
    calls += 1
    for (const key of batch) keys.add(key)
    cursor = String(next)
  } while (cursor !== '0' && calls < maxCalls)
  return { complete: cursor === '0', keys: [...keys].toSorted(), calls }
}

/** One heartbeat key as the canary records it, with what is wrong with it. */
function describeHeartbeat(key, raw, ttlMs) {
  const parsed = parseHeartbeatKey(key)
  let value = null
  try {
    value = JSON.parse(raw)
  } catch {
    value = null
  }
  const problems = []
  if (!parsed) problems.push('the key does not name a worker and an instance')
  if (!value || typeof value !== 'object') problems.push('the value is not JSON')
  else if (parsed && value.name !== parsed.workerName) {
    problems.push(`the value names ${String(value.name)}, the key ${parsed.workerName}`)
  }
  if (ttlMs === -1) problems.push('the key has no TTL, so it never expires')
  return {
    key,
    workerName: parsed?.workerName ?? null,
    instanceId: parsed?.instanceId ?? null,
    commitSha: value?.commitSha ?? null,
    startedAt: value?.startedAt ?? null,
    pid: value?.pid ?? null,
    ttlMs,
    problems,
  }
}

/**
 * The live heartbeats on this Redis: one observation of who consumes.
 *
 * `known` is false when the scan did not finish or Redis refused it. A key that
 * expired between the scan and its read is not counted. `commands` is what the
 * read cost, so a measurement can subtract its own commands.
 */
export async function readHeartbeats(redis, options = {}) {
  const observedAt = () => new Date().toISOString()
  const commands = { scan: 0, get: 0, pttl: 0 }
  try {
    const scan = await scanHeartbeatKeys(redis, options)
    commands.scan = scan.calls
    if (!scan.complete) {
      return {
        source: 'heartbeat',
        known: false,
        count: null,
        note: `the heartbeat scan did not finish within ${scan.calls} SCAN calls`,
        commands,
        observedAt: observedAt(),
      }
    }
    const heartbeats = []
    for (const key of scan.keys) {
      const [raw, ttlMs] = await Promise.all([redis.get(key), redis.pttl(key)])
      commands.get += 1
      commands.pttl += 1
      if (raw === null || ttlMs === -2) continue
      heartbeats.push(describeHeartbeat(key, raw, Number(ttlMs)))
    }
    return {
      source: 'heartbeat',
      known: true,
      count: heartbeats.length,
      names: heartbeats.map((heartbeat) => heartbeat.workerName),
      instanceIds: heartbeats.map((heartbeat) => heartbeat.instanceId),
      heartbeats,
      commands,
      observedAt: observedAt(),
    }
  } catch (error) {
    return {
      source: 'heartbeat',
      known: false,
      count: null,
      note: `the heartbeat scan failed: ${error instanceof Error ? error.message : String(error)}`,
      commands,
      observedAt: observedAt(),
    }
  }
}
