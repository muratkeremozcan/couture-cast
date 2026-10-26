const holdLimitMs = 12_000
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

/** Both clients are checked before BEGIN. The server deadline also survives a blocked Node event loop. */
export async function withRapidWatermarkLock({
  connectionString,
  createClient,
  whileLocked,
  now = () => performance.now(),
}) {
  const name = ownedDatabase(connectionString)
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
  let timer
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
    await lock.query("SET LOCAL idle_in_transaction_session_timeout = '12000ms'")
    await lock.query('LOCK TABLE "OutfitRecommendation" IN ACCESS EXCLUSIVE MODE')
    started = now()
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('rapid_watermark_hold_deadline')
        abort.abort(error)
        reject(error)
      }, holdLimitMs)
    })
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
    await Promise.race([work, deadline, watching])
    if (connectionFailure) throw connectionFailure
    if (!blockedSourceObserved) throw new Error('blocked_outfit_source_required')
    result = { heldMs: now() - started, blockedSourceObserved }
  } catch (error) {
    failure = error
  } finally {
    clearTimeout(timer)
    stopped = true
    abort.abort()
    // Release immediately, before waiting for the observer or terminating clients.
    let cleanupError
    if (transaction) {
      try {
        await lock.query('ROLLBACK')
        if (result) {
          result.heldMs = now() - started
          if (result.heldMs >= holdLimitMs)
            cleanupError = new Error('rapid_watermark_hold_deadline')
        }
      } catch (error) {
        cleanupError = error
      }
    }
    await Promise.allSettled([watching, work])
    const ended = await Promise.allSettled([lock.end(), observer.end()])
    cleanupError ??= ended.find((entry) => entry.status === 'rejected')?.reason
    failure ??= cleanupError
  }
  if (failure) throw failure
  return result
}
