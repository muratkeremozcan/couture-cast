// Step 58 step 6 owner: searchable owner anchor
/**
 * The closed record of what the owned services did during a native job, for a failed run's
 * public evidence. The service logs stay private: they can carry owned-runtime credentials,
 * user ids and request bodies, and the repository is public. This reads them in memory and
 * keeps only closed values.
 *
 * API: the request logger's JSON lines (apps/api/src/logger/request-logger.middleware.ts) as
 * route templates, method, phase, status and duration, plus a count per route of answers by
 * status, failures, requests that never got an answer and answers slower than the app's 15 s
 * request deadline (COMMERCE_REQUEST_TIMEOUT_MS in apps/mobile/src/lib/commerce.ts, which the
 * community reads use). The request lines come from the API child's own log, `api.log` in the
 * harness directory (`child(..., 'api.log')` in scripts/run-story68-native.mjs); the workflow's
 * `/tmp/cc68-api.log` holds only the `serve` launcher's output. Each service (auth proxy, API
 * launcher, Metro): its wrapper log's line count and whether it exited.
 *
 * A route is published only as a template of the canonical HTTP contract
 * (packages/api-client/docs/http.openapi.json), so no request value, in a parameter position or
 * on a path the contract does not name, ever reaches the record: an unknown path is `unknown`.
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
export const UNKNOWN_ROUTE = 'unknown'
export const API_CHILD_LOG = 'api.log'
const CONTRACT = new URL(
  '../../packages/api-client/docs/http.openapi.json',
  import.meta.url
)
const MAX_SEGMENTS = 12

/** The canonical contract's path templates (`/api/v1/community/posts/{postId}`). */
export function contractRouteTemplates(file = CONTRACT) {
  return Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).paths ?? {})
}

let contractTemplates = null
const defaultTemplates = () => (contractTemplates ??= contractRouteTemplates())

/**
 * A request path as its contract template with no leading slash
 * (`api/v1/community/posts/{postId}`): the public selector reads a string that starts with a
 * slash as a local path. Every parameter position takes the template's name, never the request's
 * value. A path no template matches is `unknown`; a value that is not a path is null.
 */
export function routeOf(requestPath, templates = defaultTemplates()) {
  if (typeof requestPath !== 'string' || !requestPath.startsWith('/')) return null
  const segments = requestPath.split('?')[0].split('/').slice(1)
  if (segments.length > MAX_SEGMENTS) return UNKNOWN_ROUTE
  let best = null
  let bestStatic = -1
  for (const template of templates) {
    const parts = template.split('/').slice(1)
    if (parts.length !== segments.length) continue
    let statics = 0
    const matches = parts.every((part, at) => {
      if (/^\{[A-Za-z][A-Za-z0-9_]*\}$/.test(part)) return segments[at] !== ''
      statics += 1
      return part === segments[at]
    })
    // A static segment outranks a parameter: posts/allocate is not posts/{postId}.
    if (matches && statics > bestStatic) {
      best = template
      bestStatic = statics
    }
  }
  return best === null ? UNKNOWN_ROUTE : best.slice(1)
}

const integerOrNull = (value) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : null

/** One request-logger line as a row, or null for any other line. */
function requestRow(line, templates) {
  let entry
  try {
    entry = JSON.parse(line)
  } catch {
    return null
  }
  const phase = PHASES[entry?.msg ?? entry?.message]
  const route = routeOf(entry?.path, templates)
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
export function apiRequestRecord(
  apiLog,
  { limit = RECENT_ROWS, templates = defaultTemplates() } = {}
) {
  const lines = String(apiLog ?? '')
    .split('\n')
    .filter((line) => line.trim() !== '')
  const rows = lines.map((line) => requestRow(line, templates)).filter(Boolean)
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

/**
 * Writes the closed record for the job's public evidence selector to pick up. The request lines
 * are read from the API child's log in the harness directory; `apiLog` says whether that log was
 * read, so a missing log reads as not measured, never as an API that served nothing.
 */
export function writeApiRequestEvidence({
  harnessDirectory,
  serviceDirectory = '/tmp',
  templates,
} = {}) {
  let text = null
  try {
    text = fs.readFileSync(path.join(harnessDirectory, API_CHILD_LOG), 'utf8')
  } catch {
    text = null
  }
  const record = {
    apiLog: text === null ? 'missing' : 'read',
    ...apiRequestRecord(text ?? '', templates ? { templates } : {}),
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
        apiLog: record.apiLog,
        lines: record.lines,
        routes: record.routes.length,
        services: record.services,
      },
    })
  )
}
