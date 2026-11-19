/**
 * The closed record of what the owned services did during a native job, for a failed run's
 * public evidence. The service logs stay private: they can carry owned-runtime credentials,
 * user ids and request bodies, and the repository is public. This reads them in memory and
 * keeps only closed values.
 *
 * API: the request logger's JSON lines (apps/api/src/logger/request-logger.middleware.ts) as
 * routes with their dynamic segments masked, method, phase, status and duration, plus a count per
 * route of answers by status, failures, requests that never got an answer and answers slower than
 * the app's 15 s request deadline (COMMERCE_REQUEST_TIMEOUT_MS in apps/mobile/src/lib/commerce.ts,
 * which the community reads use). Each service (auth proxy, API, Metro): its log's line count and
 * whether it exited.
 *
 * Nightly run 44298434117, iOS live font scale (community): the restore read showed "We could not
 * load the community feed." and nothing public said whether the API answered, failed or was slow.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const API_REQUESTS_FILE = 'native-ios-api-requests.json'
export const APP_REQUEST_DEADLINE_MS = 15_000
export const RECENT_ROWS = 60
export const SERVICES = Object.freeze(['auth', 'api', 'metro'])
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const PHASES = {
  request_received: 'received',
  request_completed: 'completed',
  request_failed: 'failed',
}
// A segment kept as is: a lowercase route word (community, feed, notification-preferences).
const ROUTE_WORD = /^[a-z][a-z0-9-]{0,39}$/
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * A request path as a route (`api/v1/community/feed`): no query and no leading slash, every
 * segment that is not a route word read as `:id`.
 */
export function routeOf(requestPath) {
  if (typeof requestPath !== 'string' || !requestPath.startsWith('/')) return null
  const pathname = requestPath.split('?')[0]
  const segments = pathname.split('/').slice(1)
  if (segments.length > 12) return null
  // No leading slash: the public selector reads a string that starts with one as a local path.
  return segments
    .map((segment) =>
      segment === '' ||
      (ROUTE_WORD.test(segment) && !UUID.test(segment) && !/\d{3,}/.test(segment))
        ? segment
        : ':id'
    )
    .join('/')
}

const integerOrNull = (value) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : null

/** One request-logger line as a row, or null for any other line. */
function requestRow(line) {
  let entry
  try {
    entry = JSON.parse(line)
  } catch {
    return null
  }
  const phase = PHASES[entry?.msg ?? entry?.message]
  const route = routeOf(entry?.path)
  if (!phase || !route) return null
  // The API's logger writes an ISO `timestamp` (apps/api/src/logger/pino.config.ts).
  const stamp = Date.parse(entry.timestamp)
  return {
    // Only to pair a request's lines here; never published.
    id: typeof entry.requestId === 'string' ? entry.requestId : null,
    stamp: Number.isFinite(stamp) ? stamp : null,
    route,
    method: METHODS.has(entry.method) ? entry.method : 'OTHER',
    phase,
    status: Number.isSafeInteger(entry.statusCode) ? entry.statusCode : null,
    ms: integerOrNull(entry.durationMs),
  }
}

/** Per method and route: answers by status, failures, unanswered and over-deadline counts. */
function routeSummaries(rows) {
  const answered = new Set(
    rows.filter((row) => row.phase !== 'received' && row.id).map((row) => row.id)
  )
  const routes = new Map()
  for (const row of rows) {
    const key = `${row.method} ${row.route}`
    if (!routes.has(key))
      routes.set(key, {
        route: row.route,
        method: row.method,
        completed: {},
        failed: {},
        unanswered: 0,
        overDeadline: 0,
        slowestMs: null,
      })
    const summary = routes.get(key)
    if (row.phase === 'received') {
      if (row.id && !answered.has(row.id)) summary.unanswered += 1
      continue
    }
    const bucket = row.phase === 'completed' ? summary.completed : summary.failed
    const status = String(row.status ?? 'none')
    bucket[status] = (bucket[status] ?? 0) + 1
    if (row.ms === null) continue
    summary.slowestMs = Math.max(summary.slowestMs ?? 0, row.ms)
    if (row.ms > APP_REQUEST_DEADLINE_MS) summary.overDeadline += 1
  }
  return [...routes.values()].sort(
    (a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method)
  )
}

/** The closed request record of one API log. Unparsed lines are counted, never kept. */
export function apiRequestRecord(apiLog, { limit = RECENT_ROWS } = {}) {
  const lines = String(apiLog ?? '')
    .split('\n')
    .filter((line) => line.trim() !== '')
  const rows = lines.map(requestRow).filter(Boolean)
  const firstAt = rows.find((row) => row.stamp !== null)?.stamp ?? null
  return {
    version: 1,
    deadlineMs: APP_REQUEST_DEADLINE_MS,
    lines: lines.length,
    otherLines: lines.length - rows.length,
    routes: routeSummaries(rows),
    // Seconds since the first stamped request line, to place each row against the run.
    recent: rows.slice(-limit).map(({ id: _id, stamp, ...row }) => ({
      at:
        stamp === null || firstAt === null
          ? null
          : Math.round((stamp - firstAt) / 100) / 10,
      ...row,
    })),
  }
}

/** Line count and exit status of each owned service, from its private log and exit file. */
export function serviceRecord(directory = '/tmp') {
  return Object.fromEntries(
    SERVICES.map((service) => {
      const log = path.join(directory, `cc68-${service}.log`)
      const exit = path.join(directory, `cc68-${service}.exit`)
      let logLines = null
      try {
        logLines = fs
          .readFileSync(log, 'utf8')
          .split('\n')
          .filter((line) => line !== '').length
      } catch {
        logLines = null
      }
      let exitStatus = null
      try {
        const value = Number.parseInt(fs.readFileSync(exit, 'utf8'), 10)
        exitStatus = Number.isSafeInteger(value) ? value : null
      } catch {
        exitStatus = null
      }
      return [service, { logLines, exited: fs.existsSync(exit), exitStatus }]
    })
  )
}

/** Writes the closed record for the job's public evidence selector to pick up. */
export function writeApiRequestEvidence({
  harnessDirectory,
  serviceDirectory = '/tmp',
} = {}) {
  const apiLog = path.join(serviceDirectory, 'cc68-api.log')
  let text = ''
  try {
    text = fs.readFileSync(apiLog, 'utf8')
  } catch {
    text = ''
  }
  const record = {
    ...apiRequestRecord(text),
    services: serviceRecord(serviceDirectory),
  }
  fs.mkdirSync(harnessDirectory, { recursive: true })
  fs.writeFileSync(
    path.join(harnessDirectory, API_REQUESTS_FILE),
    `${JSON.stringify(record, null, 2)}\n`
  )
  return record
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const record = writeApiRequestEvidence({
    harnessDirectory: path.resolve(
      process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
    ),
  })
  console.log(
    JSON.stringify({
      apiRequests: {
        lines: record.lines,
        routes: record.routes.length,
        services: record.services,
      },
    })
  )
}
