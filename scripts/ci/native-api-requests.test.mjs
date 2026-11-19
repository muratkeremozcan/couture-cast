// Learning path Step 58: Production status and nightly health.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-58-production-status-and-nightly-health
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'
import {
  API_CHILD_LOG,
  API_REQUESTS_FILE,
  APP_REQUEST_DEADLINE_MS,
  UNKNOWN_ROUTE,
  apiRequestRecord,
  contractRouteTemplates,
  routeOf,
  writeApiRequestEvidence,
} from './native-api-requests.mjs'
import {
  PUBLIC_DIAGNOSTIC_FILES,
  closedValueProblem,
  selectPublicDiagnostics,
} from './native-ios-public-diagnostics.mjs'

// Nightly run 44298434117, iOS live font scale (community): the restore read showed "We could not
// load the community feed." and the API log, private, was the only witness. The leg now publishes
// a closed record of it: routes, statuses, durations, unanswered requests and service exits.
const userId = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b'
const requestId = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const secret = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signature-value'
const line = (fields) =>
  JSON.stringify({
    level: 30,
    timestamp: '2026-11-18T13:30:00.000Z',
    service: 'api',
    ...fields,
  })
const feed = '/api/v1/community/feed?mode=auto&limit=12'
// A benign lowercase value that passes every generic secret, path and token filter: only the
// contract-template projection keeps it out of the record.
const canary = 'quietlowercasecanary'

function apiLog() {
  return [
    'Nest application successfully started',
    line({ message: 'request_received', requestId: 'r1', method: 'GET', path: feed }),
    line({
      message: 'request_completed',
      requestId: 'r1',
      method: 'GET',
      path: feed,
      statusCode: 200,
      durationMs: 812.4,
      userId,
      timestamp: '2026-11-18T13:30:00.900Z',
    }),
    // The refresh that timed out on the device: the API answered after the app gave up.
    line({ message: 'request_received', requestId: 'r2', method: 'GET', path: feed }),
    line({
      message: 'request_completed',
      requestId: 'r2',
      method: 'GET',
      path: feed,
      statusCode: 200,
      durationMs: APP_REQUEST_DEADLINE_MS + 2400,
      userId,
      timestamp: '2026-11-18T13:30:17.400Z',
    }),
    line({ message: 'request_received', requestId: 'r3', method: 'GET', path: feed }),
    line({
      message: 'request_failed',
      requestId: 'r3',
      method: 'GET',
      path: feed,
      statusCode: 500,
      durationMs: 40,
      error: { type: 'Error', message: secret },
      userId,
    }),
    // A request the API never answered.
    line({
      message: 'request_received',
      requestId,
      method: 'GET',
      path: `/api/v1/community/posts/${userId}?token=${secret}`,
    }),
    line({ level: 50, message: `database error for ${userId}: ${secret}` }),
  ].join('\n')
}

test('a request path becomes its contract template, with no leading slash and no request value', () => {
  assert.equal(routeOf(feed), 'api/v1/community/feed')
  assert.equal(
    routeOf(`/api/v1/community/posts/${userId}`),
    'api/v1/community/posts/{postId}'
  )
  assert.equal(
    routeOf(`/api/v1/community/posts/${canary}/comments`),
    'api/v1/community/posts/{postId}/comments'
  )
  // A lowercase value in a parameter position is masked like any other.
  assert.equal(routeOf(`/api/v1/locations/${canary}`), 'api/v1/locations/{locationId}')
  // A static segment outranks a parameter.
  assert.equal(
    routeOf('/api/v1/community/posts/allocate'),
    'api/v1/community/posts/allocate'
  )
  // A path the contract does not name keeps none of its segments.
  assert.equal(routeOf(`/api/v1/${canary}`), UNKNOWN_ROUTE)
  assert.equal(routeOf(`/api/v1/community/feed/${canary}`), UNKNOWN_ROUTE)
  assert.equal(routeOf('/api/v1/community/posts//comments'), UNKNOWN_ROUTE)
  assert.equal(routeOf('api/v1/feed'), null)
  assert.equal(routeOf(undefined), null)
})

test('every contract template, filled with a lowercase value, comes back as itself', () => {
  const templates = contractRouteTemplates()
  // The table is the canonical contract itself, so it cannot drift from it; the incident's
  // route and a parameterized community route must be in it.
  assert.ok(templates.includes('/api/v1/community/feed'))
  assert.ok(templates.includes('/api/v1/community/posts/{postId}'))
  for (const template of templates) {
    const filled = template.replace(/\{[^}]+\}/g, canary)
    assert.equal(routeOf(filled, templates), template.slice(1), template)
  }
})

test('the record counts answers, failures, slow and unanswered requests and carries no log text', () => {
  const record = apiRequestRecord(apiLog())
  assert.deepEqual(record.routes, [
    {
      route: 'api/v1/community/feed',
      method: 'GET',
      completed: { 200: 2 },
      failed: { 500: 1 },
      unanswered: 0,
      overDeadline: 1,
      slowestMs: APP_REQUEST_DEADLINE_MS + 2400,
    },
    {
      route: 'api/v1/community/posts/{postId}',
      method: 'GET',
      completed: {},
      failed: {},
      unanswered: 1,
      overDeadline: 0,
      slowestMs: null,
    },
  ])
  assert.equal(record.lines, 9)
  assert.equal(record.otherLines, 2)
  assert.deepEqual(record.recent[1], {
    at: 0.9,
    route: 'api/v1/community/feed',
    method: 'GET',
    phase: 'completed',
    status: 200,
    ms: 812,
  })
  const text = JSON.stringify(record)
  for (const leak of [userId, requestId, secret, 'token', 'database', 'mode=auto'])
    assert.equal(text.includes(leak), false, leak)
  assert.equal(closedValueProblem(record), null)
})

// The real file split: `serve > /tmp/cc68-api.log` captures only the launcher, and the launcher
// writes the API child's request lines to api.log in the harness directory.
function ownedRuntime(t) {
  const services = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-services-'))
  const harness = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-harness-'))
  t.after(() => {
    fs.rmSync(services, { recursive: true, force: true })
    fs.rmSync(harness, { recursive: true, force: true })
  })
  fs.writeFileSync(
    path.join(services, 'cc68-api.log'),
    'weather double listening\nowned processes recorded\n'
  )
  fs.writeFileSync(path.join(services, 'cc68-auth.log'), `${secret}\nready\n`)
  fs.writeFileSync(path.join(services, 'cc68-metro.exit'), '137\n')
  return { services, harness }
}

test('the record reads the API child log in the harness directory, not the launcher log', (t) => {
  const { services, harness } = ownedRuntime(t)
  fs.writeFileSync(path.join(harness, API_CHILD_LOG), `${apiLog()}\n`)
  const record = writeApiRequestEvidence({
    harnessDirectory: harness,
    serviceDirectory: services,
  })
  assert.equal(record.apiLog, 'read')
  assert.equal(record.lines, 9)
  assert.deepEqual(
    record.routes.map(({ method, route }) => `${method} ${route}`),
    ['GET api/v1/community/feed', 'GET api/v1/community/posts/{postId}']
  )
  // Service status still comes from the wrapper files.
  assert.deepEqual(record.services, {
    auth: { logLines: 2, exited: false, exitStatus: null },
    api: { logLines: 2, exited: false, exitStatus: null },
    metro: { logLines: null, exited: true, exitStatus: 137 },
  })
})

test('a missing API child log reads as not measured, even when the launcher log has lines', (t) => {
  const { services, harness } = ownedRuntime(t)
  fs.writeFileSync(path.join(services, 'cc68-api.log'), `${apiLog()}\n`)
  const record = writeApiRequestEvidence({
    harnessDirectory: harness,
    serviceDirectory: services,
  })
  assert.equal(record.apiLog, 'missing')
  assert.equal(record.lines, 0)
  assert.deepEqual(record.routes, [])
})

test('the published record carries no request value, on a known route or an unknown one', (t) => {
  const { services, harness } = ownedRuntime(t)
  fs.writeFileSync(
    path.join(harness, API_CHILD_LOG),
    [
      apiLog(),
      line({
        message: 'request_received',
        requestId: 'r9',
        method: 'GET',
        path: `/api/v1/locations/${canary}`,
      }),
      line({
        message: 'request_completed',
        requestId: 'r10',
        method: 'GET',
        path: `/internal/${canary}/probe`,
        statusCode: 404,
        durationMs: 3,
      }),
    ].join('\n')
  )
  const record = writeApiRequestEvidence({
    harnessDirectory: harness,
    serviceDirectory: services,
  })
  assert.ok(PUBLIC_DIAGNOSTIC_FILES.includes(API_REQUESTS_FILE))
  const { published, omitted } = selectPublicDiagnostics(harness)
  assert.deepEqual(omitted, [])
  assert.deepEqual(published.get(API_REQUESTS_FILE), record)
  const text = JSON.stringify(published.get(API_REQUESTS_FILE))
  for (const leak of [canary, 'internal', 'probe', secret, userId])
    assert.equal(text.includes(leak), false, leak)
  assert.deepEqual(
    record.routes.map(({ method, route }) => `${method} ${route}`),
    [
      'GET api/v1/community/feed',
      'GET api/v1/community/posts/{postId}',
      'GET api/v1/locations/{locationId}',
      `GET ${UNKNOWN_ROUTE}`,
    ]
  )
})

test('every iOS live font leg and shard records it on failure after the service exit check and before selection', () => {
  const jobs = parse(
    fs.readFileSync(
      new URL('../../.github/workflows/ios-native-jobs.yml', import.meta.url),
      'utf8'
    )
  ).jobs
  const runs = (step) => String(step.run ?? '')
  for (const name of ['ios-live-font', 'ios-shard']) {
    const steps = jobs[name].steps
    const record = steps.findIndex((step) =>
      /^\s*node scripts\/ci\/native-api-requests\.mjs\s*$/m.test(runs(step))
    )
    assert.ok(record > -1, `${name} records the services' closed evidence`)
    assert.equal(steps[record].if, '${{ !cancelled() && failure() }}', name)
    // A service that exits after a passing proof fails the job only at the exit check, so the
    // record must come after it to run on that failure too.
    const exits = steps.findIndex(
      (step) => step.name === 'Report owned background service exits'
    )
    assert.ok(exits > -1, `${name} reports the owned service exits`)
    assert.ok(record > exits, `${name}: recorded after the service exit check`)
    const select = steps.findIndex((step) =>
      runs(step).includes('node scripts/e2e-share-card/public-evidence.mjs')
    )
    assert.ok(select > record, `${name}: selected after it is written`)
    const upload = steps.findIndex(
      (step) =>
        step.uses?.startsWith('actions/upload-artifact') &&
        step.with?.path?.endsWith('public-evidence/')
    )
    assert.ok(upload > select, `${name}: uploaded after it is selected`)
  }
})
