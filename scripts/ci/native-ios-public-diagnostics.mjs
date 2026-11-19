/**
 * The iOS job writes many diagnostic records. A public repository serves its workflow artifacts
 * to any signed-in user, so only records that pass this closed-value check are copied into the
 * uploaded evidence directory. Nothing else leaves the runner.
 *
 * Closed means every key is a plain identifier and every value is a finite number, a boolean,
 * null or a short printable string that cannot carry a secret, a device identifier or a local
 * path. A record that fails is left out and named in `native-ios-diagnostics-omitted.json`
 * with the first reason, so the omission is itself evidence and never a job failure.
 *
 * The three `*-private.json` records and the two device-identity records are never read here; the
 * startup record alone is projected into per-command timings by native-ios-startup-timings.mjs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  API_REQUESTS_FILE,
  UNKNOWN_ROUTE,
  contractRouteTemplates,
} from './native-api-requests.mjs'

/** Records projected for the run report, each validated by value, never copied unchecked. */
export const PUBLIC_DIAGNOSTIC_FILES = Object.freeze([
  'native-ios-preflight.json',
  'native-ios-runtime-deadline.json',
  'native-ios-collectors.json',
  'native-ios-crashes.json',
  'native-ios-quiet-services.json',
  'native-host-ios-inflow.json',
  'native-ios-siri-preferences.json',
  'native-ios-log-counts.json',
  'native-ios-metro-bundles.json',
  'native-ios-flow-command-timings.json',
  'native-ios-flow-progress.json',
  'native-ios-expo-go-probe.json',
  // native-api-requests.mjs: the owned services' closed request and exit record.
  API_REQUESTS_FILE,
])

/** Never opened by the selector. The first three can carry paths, keys and tokens. */
export const NEVER_PUBLISHED_DIAGNOSTICS = Object.freeze([
  'native-ios-startup-private.json',
  'native-ios-sampler-private.json',
  'native-host-snapshot-private.json',
  'native-ios-device.json',
  'native-ios-device-cleanup.json',
])

export const OMITTED_FILE = 'native-ios-diagnostics-omitted.json'

const MAX_BYTES = 1_000_000
const MAX_DEPTH = 10
const MAX_STRING = 200
const MAX_ENTRIES = 20000
const KEY = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,79}$/
const PRINTABLE = /^[\x20-\x7e]*$/
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
export const SECRET_TEXT =
  /eyJ[A-Za-z0-9_-]{8,}|bearer\s|access_token|refresh_token|service_role|api[_-]?key|secret|password|passwd|sb_[a-z]+_|sk_[a-z]+_|gh[pousr]_[A-Za-z0-9]|AKIA[0-9A-Z]{8}|-----BEGIN/i
export const LOCAL_PATH =
  /(^|[\s=:(])(\/|~\/)[^\s]|\/(Users|private|var|tmp|Library|Volumes|home|opt|runner)\/|file:\/\/|[A-Za-z]:\\/
const LONG_TOKEN = /[A-Za-z0-9+/_=-]{40,}/
export const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/

/**
 * One xcodebuild or harness log line made fit for the public job log (story 6.15, Antigravity
 * audit-diag P3 and its re-check): a secret-shaped line is withheld whole; otherwise each token
 * between separators (whitespace and | , ; [ ] { } < > ( ) = and quotes) is masked on its own:
 * Swift sources keep their file name, every other local path or URL, email, UUID (simulator UDIDs)
 * and long token with a digit or token symbol is masked.
 */
export function publicLogLine(text, limit = 300) {
  const line = String(text)
    .replace(/\t/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?')
  // A secret-shaped line is withheld whole, before any mask could hide what it was.
  if (SECRET_TEXT.test(line)) return '[withheld: secret-shaped line]'
  return line
    .split(LOG_BOUNDARY)
    .map((part, index) => (index % 2 ? part : publicLogToken(part)))
    .join('')
    .trim()
    .slice(0, limit)
}

// Separators that end a token in xcodebuild output and in CC68 records (`a|b|c`), kept as is.
const LOG_BOUNDARY = /([\s|,;[\]{}<>()='"]+)/
// A long run that is an identifier, not a token, has no digit or token symbol (camelCase test names).
const LOG_TOKEN = /^(?=[^\s]*[0-9+/_=-])[A-Za-z0-9+/_=-]{40,}$/
const SWIFT_SOURCE = /^(?:file:\/\/|~\/|\/).*\/([^/]+\.swift)(:.*)?$/

/** One token between separators: Swift sources keep their name, paths and identifiers are masked. */
function publicLogToken(token) {
  if (!token) return token
  const swift = token.match(SWIFT_SOURCE)
  if (swift) return `${swift[1]}${swift[2] ?? ''}`
  if (/^(?:file:\/\/|~\/|\/)/.test(token) || /^[A-Za-z]+:\/\//.test(token))
    return '<path>'
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token)) return '<email>'
  if (LOG_TOKEN.test(token)) return '<token>'
  // A root path inside a token (key:/Users/x, id=/tmp/y) is masked from where it starts.
  return token
    .replace(/(:)(?:~\/|\/)\S*/, '$1<path>')
    .replace(new RegExp(UUID.source, 'gi'), '<uuid>')
}

const STRING_RULES = [
  [(text) => text.length > MAX_STRING, 'string_too_long'],
  [(text) => !PRINTABLE.test(text), 'non_printable_string'],
  [(text) => UUID.test(text), 'identifier_in_string'],
  [(text) => SECRET_TEXT.test(text), 'secret_shaped_string'],
  [(text) => LOCAL_PATH.test(text), 'path_in_string'],
  [(text) => LONG_TOKEN.test(text), 'token_shaped_string'],
  [(text) => EMAIL.test(text), 'email_in_string'],
]
const stringProblem = (text) => STRING_RULES.find(([broken]) => broken(text))?.[1] ?? null
const unsafeKey = (key) => !KEY.test(key) || UUID.test(key) || LONG_TOKEN.test(key)

/**
 * The first reason `value` is not closed, or null. A string reason names the rule only.
 * `fields` maps a key to a closed identifier set: a value under that key, at any depth, must be a
 * string in the set (else the set's reason), and is then exempt from the generic string rules. The
 * walk is one pass under the depth and entry budgets, so a malformed record of any shape is
 * omitted by reason and never throws.
 */
export function closedValueProblem(
  value,
  depth = 0,
  budget = { entries: 0 },
  fields = {}
) {
  if (++budget.entries > MAX_ENTRIES) return 'too_many_entries'
  if (depth > MAX_DEPTH) return 'too_deep'
  if (value === null || typeof value === 'boolean') return null
  if (typeof value === 'number')
    return Number.isFinite(value) ? null : 'non_finite_number'
  if (typeof value === 'string') return stringProblem(value)
  if (Array.isArray(value))
    return firstProblem(value, (item) =>
      closedValueProblem(item, depth + 1, budget, fields)
    )
  if (typeof value !== 'object') return 'unsupported_value'
  const keys = Object.keys(value)
  if (keys.some(unsafeKey)) return 'unsafe_key'
  return firstProblem(keys, (key) =>
    Object.hasOwn(fields, key)
      ? closedFieldProblem(fields[key], value[key], budget)
      : closedValueProblem(value[key], depth + 1, budget, fields)
  )
}

/** The first problem `check` reports over `items`, checking each only while none has. */
function firstProblem(items, check) {
  for (const item of items) {
    const problem = check(item)
    if (problem) return problem
  }
  return null
}

/** A closed field's value: a string in its set (counted against the budget), else its reason. */
function closedFieldProblem(closed, item, budget) {
  if (typeof item !== 'string' || !closed.values().has(item)) return closed.reason
  return ++budget.entries > MAX_ENTRIES ? 'too_many_entries' : null
}

/**
 * The API request record names each request by its OpenAPI path template, and 13 of the 87
 * templates (the notification preferences every iOS sign-in requests among them) are 40 or more
 * token characters long, the generic token rule's bound. So that record's `route` fields are
 * checked against the contract itself: each must be a contract template with no leading slash, or
 * `unknown`.
 */
let contractRoutes = null
const knownRoutes = () =>
  (contractRoutes ??= new Set([
    UNKNOWN_ROUTE,
    ...contractRouteTemplates().map((template) => template.slice(1)),
  ]))

/**
 * The flow timing receipt and the flow progress record name each flow by its repository path
 * (`maestro/story68/community-draft-background-ios.yaml`), which can exceed the generic token
 * rule's bound. Their `flow` fields are checked against the repository's Maestro flow files.
 */
const REPOSITORY = fileURLToPath(new URL('../../', import.meta.url))
export function maestroFlowPaths(root = REPOSITORY) {
  const flows = new Set()
  const walk = (relative) => {
    for (const entry of fs.readdirSync(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const child = `${relative}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else if (entry.isFile() && entry.name.endsWith('.yaml')) flows.add(child)
    }
  }
  walk('maestro')
  return flows
}
let repositoryFlows = null
const knownFlows = () => (repositoryFlows ??= maestroFlowPaths())

const FLOW_FIELDS = { flow: { values: knownFlows, reason: 'flow_not_in_repository' } }
/** Per record, the keys whose values are closed identifiers rather than free strings. */
const CLOSED_FIELDS = {
  [API_REQUESTS_FILE]: {
    route: { values: knownRoutes, reason: 'route_not_in_contract' },
  },
  'native-ios-flow-command-timings.json': FLOW_FIELDS,
  'native-ios-flow-progress.json': FLOW_FIELDS,
}

/**
 * Reads each listed record from `directory`. Returns the records that are closed and, for each
 * record that exists but is not, its name and reason.
 */
export function selectPublicDiagnostics(directory) {
  const published = new Map()
  const omitted = []
  for (const name of PUBLIC_DIAGNOSTIC_FILES) {
    const file = path.join(directory, name)
    if (!fs.existsSync(file)) continue
    if (fs.statSync(file).size > MAX_BYTES) {
      omitted.push({ name, reason: 'file_too_large' })
      continue
    }
    let value
    try {
      value = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      omitted.push({ name, reason: 'not_json' })
      continue
    }
    const problem = closedValueProblem(
      value,
      0,
      { entries: 0 },
      CLOSED_FIELDS[name] ?? {}
    )
    if (problem) omitted.push({ name, reason: problem })
    else published.set(name, value)
  }
  return { published, omitted }
}
