import fs from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

// The API refuses a preparation 15 s after it arrives, queue time included
// (share-cards.service.ts). No preparation may stay held at the source for 12 s, so every one
// keeps 3 s to settle after release and the hold itself can never cause the product's 503.
// The clock starts when the API receives each request, the instant its own deadline starts;
// one that the client superseded and aborted no longer has a deadline to protect.
export const PREPARE_DEADLINE_MS = 15_000
export const PREPARE_SETTLE_MARGIN_MS = 3_000
export const liveRequestLimitMs = PREPARE_DEADLINE_MS - PREPARE_SETTLE_MARGIN_MS
// Bounds the whole hold, server-side too, so the table is released even if this process stalls.
export const holdLimitMs = 30_000
const preparePath = '/api/v1/share-cards/prepare'
const parseLines = (text) =>
  text.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
function ownedDatabase(connectionString) {
  const url = new URL(connectionString)
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !/^\/tea_community_[a-f0-9]{32}$/.test(url.pathname)
  )
    throw new Error('owned_uuid_loopback_database_required')
  return url.pathname.slice(1)
}
export function assertRapidWatermarkRuntime({ environment, build, resources, apiLog }) {
  const name = ownedDatabase(environment.DATABASE_URL)
  if (
    !['http://127.0.0.1:4088', 'http://localhost:4088'].includes(
      environment.API_BASE_URL
    ) ||
    build.EXPO_PUBLIC_API_BASE_URL !== environment.API_BASE_URL ||
    build.STORY68_NATIVE_TEST_BUILD !== '1' ||
    resources.owner !== 'cc68-impl' ||
    resources.createdDatabase !== true ||
    resources.database !== name ||
    resources.apiPort !== 4088
  )
    throw new Error('pinned_owned_native_runtime_required')
  if (
    !parseLines(apiLog).some(
      (row) => row.code === 'owned_database_verified' && row.database === name
    )
  )
    throw new Error('effective_owned_api_database_proof_required')
  return environment.DATABASE_URL
}
export function rapidWatermarkRequests(log) {
  const rows = parseLines(log).filter((row) => row.path === '/api/v1/share-cards/prepare')
  if (rows.some((row) => row.statusCode === 503))
    throw new Error('rapid_watermark_prepare_503')
  const requests = new Set(
    rows
      .filter(
        (row) =>
          row.method === 'POST' &&
          row.message === 'request_received' &&
          typeof row.requestId === 'string'
      )
      .map((row) => row.requestId)
  ).size
  if (requests < 3) throw new Error('three_fresh_prepare_requests_required')
  return { requests, unavailableResponses: 0 }
}

/** Prepare requests the API has received and not yet answered, from its JSON request log. */
export function createPrepareRequestTracker() {
  const live = new Map()
  let partial = ''
  return {
    update(text) {
      const lines = (partial + text).split('\n')
      partial = lines.pop()
      for (const row of parseLines(lines.join('\n'))) {
        if (row.path !== preparePath || typeof row.requestId !== 'string') continue
        if (row.message === 'request_received') {
          const arrived = Date.parse(row.timestamp)
          if (Number.isFinite(arrived)) live.set(row.requestId, arrived)
        } else if (['request_completed', 'request_failed'].includes(row.message))
          live.delete(row.requestId)
      }
    },
    /** How long the oldest request still in flight has waited, in ms; 0 when none is. */
    oldestAgeMs(nowMs) {
      let oldest = 0
      for (const arrived of live.values()) oldest = Math.max(oldest, nowMs - arrived)
      return oldest
    },
  }
}

/** Reads the API log from `fromByte` on each call and returns the oldest live request's age. */
export function apiPrepareRequestClock({ file, fromByte, files = fs, clock = Date.now }) {
  const tracker = createPrepareRequestTracker()
  const decoder = new StringDecoder('utf8')
  let position = fromByte
  return () => {
    const size = files.statSync(file).size
    if (size > position) {
      const bytes = Buffer.alloc(size - position)
      const fd = files.openSync(file, 'r')
      try {
        position += files.readSync(fd, bytes, 0, bytes.length, position)
      } finally {
        files.closeSync(fd)
      }
      tracker.update(decoder.write(bytes))
    }
    return tracker.oldestAgeMs(clock())
  }
}

/** Samples the oldest live request's age, keeps the longest seen and throws past the limit. */
function requestWatch(oldestLiveRequestMs) {
  if (typeof oldestLiveRequestMs !== 'function')
    throw new Error('rapid_watermark_request_clock_required')
  let longest = 0
  return {
    longest: () => longest,
    sample() {
      const age = oldestLiveRequestMs()
      if (!Number.isFinite(age) || age < 0)
        throw new Error('rapid_watermark_request_clock_required')
      longest = Math.max(longest, age)
      if (age >= liveRequestLimitMs) throw new Error('rapid_watermark_request_deadline')
    },
  }
}

/** Aborts the held work and rejects when the first of the two hold clocks expires. */
function holdDeadline(abort, requests) {
  let timer
  let interval
  const promise = new Promise((_, reject) => {
    const expire = (error) => {
      abort.abort(error)
      reject(error)
    }
    timer = setTimeout(
      () => expire(new Error('rapid_watermark_hold_deadline')),
      holdLimitMs
    )
    interval = setInterval(() => {
      try {
        requests.sample()
      } catch (error) {
        expire(error)
      }
    }, 50)
  })
  const clear = () => {
    clearTimeout(timer)
    clearInterval(interval)
  }
  return { promise, clear }
}

const failureOf = async (step) => {
  try {
    await step()
    return undefined
  } catch (error) {
    return error
  }
}

/** The first problem found while releasing a hold that otherwise succeeded, if any. */
function releaseFailure({ lastSample, released, result, ended }) {
  if (lastSample || released) return lastSample ?? released
  if (result?.heldMs >= holdLimitMs) return new Error('rapid_watermark_hold_deadline')
  return ended.find((entry) => entry.status === 'rejected')?.reason
}

/**
 * Both clients are checked before BEGIN. Two clocks bound the hold: no prepare request may wait
 * at the source for liveRequestLimitMs, and the whole hold ends by holdLimitMs. The server-side
 * idle timeout repeats the second, so it also survives a blocked Node event loop.
 */
export async function withRapidWatermarkLock({
  connectionString,
  createClient,
  whileLocked,
  oldestLiveRequestMs,
  now = () => performance.now(),
}) {
  const name = ownedDatabase(connectionString)
  const requests = requestWatch(oldestLiveRequestMs)
  const lock = createClient({ connectionString })
  const observer = createClient({ connectionString })
  const abort = new AbortController()
  let connectionFailure
  for (const client of [lock, observer])
    client.on('error', (error) => {
      connectionFailure = error
      abort.abort(error)
    })
  let transaction = false
  let deadline
  let failure
  let stopped = false
  let watching
  let work
  let started
  let result
  let blockedSourceObserved = false
  try {
    await Promise.all([lock.connect(), observer.connect()])
    for (const client of [lock, observer]) {
      const effective = await client.query('SELECT current_database() AS name')
      if (effective.rows[0]?.name !== name)
        throw new Error('effective_owned_database_mismatch')
    }
    await lock.query('BEGIN')
    transaction = true
    await lock.query("SET LOCAL lock_timeout = '1000ms'")
    await lock.query(`SET LOCAL idle_in_transaction_session_timeout = '${holdLimitMs}ms'`)
    await lock.query('LOCK TABLE "OutfitRecommendation" IN ACCESS EXCLUSIVE MODE')
    started = now()
    deadline = holdDeadline(abort, requests)
    watching = (async () => {
      do {
        const result = await observer.query(`
          SELECT a.pid, a.state, a.wait_event_type FROM pg_stat_activity a
          JOIN pg_locks l ON l.pid = a.pid
          WHERE a.datname = current_database() AND NOT l.granted
            AND l.relation = 'public."OutfitRecommendation"'::regclass
            AND a.query LIKE 'SELECT%'
        `)
        blockedSourceObserved ||= result.rows.length > 0
        if (!stopped && !abort.signal.aborted)
          await new Promise((resolve) => {
            const done = () => {
              clearTimeout(pause)
              abort.signal.removeEventListener('abort', done)
              resolve()
            }
            const pause = setTimeout(done, 20)
            abort.signal.addEventListener('abort', done, { once: true })
          })
      } while (!stopped && !abort.signal.aborted)
    })()
    work = Promise.resolve().then(() => whileLocked(abort.signal))
    await Promise.race([work, deadline.promise, watching])
    if (connectionFailure) throw connectionFailure
    if (!blockedSourceObserved) throw new Error('blocked_outfit_source_required')
    result = { heldMs: now() - started, blockedSourceObserved }
  } catch (error) {
    failure = error
  } finally {
    deadline?.clear()
    stopped = true
    abort.abort()
    // The last sample before release: a request still waiting counts up to this instant.
    const lastSample = result ? await failureOf(requests.sample) : undefined
    // Release immediately, before waiting for the observer or terminating clients.
    const released = transaction
      ? await failureOf(() => lock.query('ROLLBACK'))
      : undefined
    if (result) {
      result.heldMs = now() - started
      result.longestLiveRequestMs = requests.longest()
    }
    await Promise.allSettled([watching, work])
    const ended = await Promise.allSettled([lock.end(), observer.end()])
    failure ??= releaseFailure({ lastSample, released, result, ended })
  }
  if (failure) throw failure
  return result
}
