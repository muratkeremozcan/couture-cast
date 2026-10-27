const holdLimitMs = 12_000
export const browserWatermarkPhases = [
  'profile-before',
  'connect',
  'pin',
  'acquire',
  'initial',
  'blocked',
  'off',
  'on',
  'profile-after',
  'blocked-after',
  'rollback',
  'preview',
  'requests',
  'complete',
]
export const browserWatermarkChecks = [
  'ownerVerified',
  'databasePinned',
  'initialRequest',
  'blockedSource',
  'watermarkOff',
  'watermarkOn',
  'authenticatedProfile',
  'blockedAtRelease',
  'rolledBack',
  'previewLoaded',
  'threeRequests',
  'zero503',
]
const codes = [
  'ok',
  'browser_watermark_hold_deadline',
  'browser_watermark_database_mismatch',
  'browser_watermark_connection_failed',
  'browser_watermark_source_not_blocked',
  'browser_watermark_prepare_503',
  'browser_watermark_three_requests_required',
  'browser_watermark_check_failed',
  'browser_watermark_cleanup_failed',
  'browser_watermark_failed',
]
const exactKeys = (object, keys) =>
  object &&
  typeof object === 'object' &&
  Object.keys(object).length === keys.length &&
  keys.every((key) => Object.hasOwn(object, key))
function validOutcome(value) {
  if (!value.passed) return value.code !== 'ok'
  return (
    value.code === 'ok' &&
    value.phase === 'complete' &&
    value.heldMs < holdLimitMs &&
    value.requests >= 3 &&
    value.unavailableResponses === 0 &&
    browserWatermarkChecks.every((key) => value.checks[key] === true)
  )
}
export function assertBrowserWatermarkEvidence(value) {
  if (
    !exactKeys(value, [
      'version',
      'browser',
      'passed',
      'code',
      'phase',
      'elapsedMs',
      'heldMs',
      'requests',
      'unavailableResponses',
      'checks',
    ]) ||
    value.version !== 1 ||
    !['chromium', 'firefox', 'webkit'].includes(value.browser) ||
    typeof value.passed !== 'boolean' ||
    !codes.includes(value.code) ||
    !browserWatermarkPhases.includes(value.phase) ||
    ![value.elapsedMs, value.heldMs].every(
      (n) => Number.isFinite(n) && n >= 0 && n <= 600_000
    ) ||
    ![value.requests, value.unavailableResponses].every(
      (n) => Number.isSafeInteger(n) && n >= 0 && n <= 10_000
    ) ||
    !exactKeys(value.checks, browserWatermarkChecks) ||
    !browserWatermarkChecks.every((key) => typeof value.checks[key] === 'boolean') ||
    !validOutcome(value)
  )
    throw new Error('invalid_browser_watermark_evidence')
}
export function closedBrowserWatermarkFailure(error) {
  return error instanceof Error && codes.includes(error.message) && error.message !== 'ok'
    ? error.message
    : 'browser_watermark_failed'
}
function ownedDatabaseName(connectionString) {
  const url = new URL(connectionString)
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !/^\/tea_community_[a-f0-9]{32}$/.test(url.pathname)
  )
    throw new Error('browser_watermark_database_mismatch')
  return url.pathname.slice(1)
}
async function observeBlocked({ stopped, signal, checkBlocked }) {
  while (!stopped() && !signal.aborted) {
    await checkBlocked()
    if (stopped() || signal.aborted) break
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(pause)
        signal.removeEventListener('abort', done)
        resolve()
      }
      const pause = setTimeout(done, 20)
      signal.addEventListener('abort', done, { once: true })
    })
  }
}
function assertOperationCurrent(connectionFailure, signal, observed) {
  if (connectionFailure) throw connectionFailure
  if (signal.aborted) throw signal.reason
  if (!observed) throw new Error('browser_watermark_source_not_blocked')
}
function finishHeldTime({ started, now, onHeld, result, failure }) {
  if (started === undefined) return failure
  const heldMs = now() - started
  onHeld(heldMs)
  if (result) result.heldMs = heldMs
  return heldMs >= holdLimitMs
    ? (failure ?? new Error('browser_watermark_hold_deadline'))
    : failure
}
/** Own only a loopback UUID database and one LookbookPost table barrier. */
export async function withBrowserWatermarkLock({
  connectionString,
  createClient,
  whileLocked,
  onPhase,
  onHeld,
  onCheck,
  now = () => performance.now(),
}) {
  const name = ownedDatabaseName(connectionString)
  const clients = [0, 1].map(() =>
    createClient({
      connectionString,
      connectionTimeoutMillis: 2000,
      query_timeout: 2000,
    })
  )
  const [lock, observer] = clients
  const abort = new AbortController()
  let transaction = false
  let stopped = false
  let timer
  let watcher
  let work
  let started
  let failure
  let connectionFailure
  let result
  let observed = false
  let signalObserved
  const blocked = new Promise((resolve) => {
    signalObserved = resolve
  })
  let rejectWatch
  const watchFailure = new Promise((_, reject) => {
    rejectWatch = reject
  })
  void watchFailure.catch(() => undefined)
  const failConnection = () => {
    const error = new Error('browser_watermark_connection_failed')
    connectionFailure = error
    abort.abort(error)
    rejectWatch(error)
  }
  for (const client of clients) client.on('error', failConnection)
  const checkBlocked = async () => {
    const result = await observer.query(`
      SELECT a.pid FROM pg_stat_activity a JOIN pg_locks l ON l.pid = a.pid
      WHERE a.datname = current_database() AND NOT l.granted
        AND l.relation = 'public."LookbookPost"'::regclass AND a.query LIKE 'SELECT%'
    `)
    const current = result.rows.length > 0
    if (current) {
      observed = true
      signalObserved()
    }
    return current
  }
  try {
    onPhase('connect')
    await Promise.all(clients.map((client) => client.connect()))
    onPhase('pin')
    for (const client of clients) {
      const effective = await client.query('SELECT current_database() AS name')
      if (effective.rows[0]?.name !== name)
        throw new Error('browser_watermark_database_mismatch')
    }
    onCheck('databasePinned', true)
    onPhase('acquire')
    await lock.query('BEGIN')
    transaction = true
    await lock.query("SET LOCAL lock_timeout = '1000ms'")
    await lock.query("SET LOCAL idle_in_transaction_session_timeout = '12000ms'")
    await lock.query('LOCK TABLE "LookbookPost" IN ACCESS EXCLUSIVE MODE')
    started = now()
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('browser_watermark_hold_deadline')
        abort.abort(error)
        reject(error)
      }, holdLimitMs)
    })
    watcher = observeBlocked({
      stopped: () => stopped,
      signal: abort.signal,
      checkBlocked,
    }).catch(failConnection)
    work = Promise.resolve().then(() =>
      whileLocked({
        signal: abort.signal,
        waitForBlocked: () => Promise.race([blocked, deadline, watchFailure]),
        checkBlocked,
      })
    )
    await Promise.race([work, deadline, watchFailure])
    assertOperationCurrent(connectionFailure, abort.signal, observed)
    if (!(await checkBlocked())) throw new Error('browser_watermark_source_not_blocked')
    onCheck('blockedAtRelease', true)
    result = { blockedSourceObserved: true, blockedSourceAtRelease: true }
  } catch (error) {
    failure = error
  } finally {
    clearTimeout(timer)
    stopped = true
    abort.abort(failure)
    if (transaction) {
      if (!failure) onPhase('rollback')
      try {
        await lock.query('ROLLBACK')
        onCheck('rolledBack', true)
      } catch {
        failure ??= new Error('browser_watermark_cleanup_failed')
      }
    }
    failure = finishHeldTime({ started, now, onHeld, result, failure })
    await Promise.allSettled([watcher, work])
    const ended = await Promise.allSettled(clients.map((client) => client.end()))
    failure ??= connectionFailure
    if (ended.some((entry) => entry.status === 'rejected'))
      failure ??= new Error('browser_watermark_cleanup_failed')
  }
  if (failure) throw failure
  return result
}

function ownTargetResolution(response, postId) {
  return response.status() === 200 && ownResolveRequest(response, postId)
}
function ownResolveRequest(response, postId) {
  if (!response.url().endsWith('/api/v1/community/targets/resolve')) return false
  const input = response.request().postDataJSON()
  return (
    Array.isArray(input?.targets) &&
    input.targets.some((target) => target?.postId === postId)
  )
}
function cursorRequest(request) {
  const url = new URL(request.url())
  return (
    url.pathname === '/api/v1/community/events' && Boolean(url.searchParams.get('cursor'))
  )
}
/** A cursor replay starts only after the real bootstrap has applied resolved targets. */
export async function afterInitialCommunityVerification({ page, postId, navigate }) {
  let resolutionSeen = false
  const replays = new Set()
  // Every owned resolve status, so a timeout names what the product actually answered.
  const statuses = []
  const onResponse = (response) => {
    if (ownResolveRequest(response, postId)) statuses.push(response.status())
    if (ownTargetResolution(response, postId)) resolutionSeen = true
  }
  const onRequest = (request) => {
    if (resolutionSeen && cursorRequest(request)) replays.add(request)
  }
  page.on('response', onResponse)
  page.on('request', onRequest)
  const resolved = page.waitForResponse(
    (response) => ownTargetResolution(response, postId),
    { timeout: 20_000 }
  )
  const replayed = page.waitForResponse(
    (response) => response.status() === 200 && replays.has(response.request()),
    { timeout: 20_000 }
  )
  void resolved.catch(() => undefined)
  void replayed.catch(() => undefined)
  try {
    await navigate()
    const owned = await resolved.catch((error) => {
      throw new Error(
        `browser_watermark_community_resolution_timeout: owned resolve statuses ${JSON.stringify(statuses.slice(-12))}`,
        { cause: error }
      )
    })
    const body = await owned.json()
    if (
      !body?.data?.targets?.some(
        (target) => target.key === postId && target.status === 'available'
      )
    )
      throw new Error('browser_watermark_community_not_verified')
    const replay = await (await replayed).json()
    if (replay?.data?.resyncRequired !== false)
      throw new Error('browser_watermark_community_not_verified')
  } finally {
    page.off('response', onResponse)
    page.off('request', onRequest)
  }
}
