import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { parse } from 'yaml'
import {
  waitForOwnedWeb,
  probeOwnedWebRoot,
  assertWebStartupEvidence,
} from './wait-web.mjs'

const facts = () => ({
  freeMemoryBytes: 10,
  totalMemoryBytes: 20,
  freeDiskBytes: 30,
  load1: 1.5,
})
function fixture(statuses, log = '') {
  let calls = 0,
    delays = 0
  return {
    options: {
      probe: async () => {
        const httpStatus = statuses[calls++]
        return { httpStatus, exitCode: httpStatus === 200 ? 0 : 22, durationMs: 1 }
      },
      delay: async () => {
        delays++
      },
      readLog: () => log,
      resources: facts,
    },
    calls: () => calls,
    delays: () => delays,
  }
}
test('first successful root still requires the separate successful verification request', async () => {
  const f = fixture([503, 200, 200])
  const value = await waitForOwnedWeb(f.options)
  assert.equal(value.passed, true)
  assert.equal(f.calls(), 3)
  assert.equal(f.delays(), 1)
  assert.deepEqual(
    value.probes.map((row) => row.phase),
    ['wait', 'wait', 'verify']
  )
})
test('a controlled 200 then 500 stays failed with no third request or retry-to-green', async () => {
  const f = fixture([200, 500, 200])
  const value = await waitForOwnedWeb(f.options)
  assert.equal(value.passed, false)
  assert.equal(f.calls(), 2)
  assert.equal(f.delays(), 0)
  assert.equal(value.probes.at(-1).exitCode, 22)
})
test('the existing 90-attempt wait and final request retain their exact semantics', async () => {
  const f = fixture([...Array(90).fill(503), 200])
  const value = await waitForOwnedWeb(f.options)
  assert.equal(value.passed, true)
  assert.equal(f.calls(), 91)
  assert.equal(f.delays(), 90)
})
test('closed log signatures and reviewed Next framework positions retain no raw error content', async () => {
  const secret = 'member@example.test token=private-signed-url'
  const f = fixture(
    [200, 500],
    `Error: Cannot find module '${secret}' MODULE_NOT_FOUND ENOENT\n at x (/home/private/node_modules/next/dist/server/require.js:12:9)\n at x (/home/private/custom-secret.js:3:4)`
  )
  const value = await waitForOwnedWeb(f.options)
  assert.deepEqual(value.logSignals, ['missing_module', 'missing_file'])
  assert.deepEqual(value.frameworkFrames, [
    { file: 'server/require.js', line: 12, column: 9 },
  ])
  assert.equal(JSON.stringify(value).includes(secret), false)
  assert.equal(JSON.stringify(value).includes('/home/private'), false)
})
test('actual HTTP curl 200 then 500 records both statuses and keeps the failed response body private', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-web-startup-'))
  let calls = 0
  const server = http.createServer((request, response) => {
    response.writeHead(++calls === 1 ? 200 : 500, { 'content-type': 'text/html' })
    response.end('<h1>private.member@example.test</h1>')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const value = await waitForOwnedWeb({
      probe: (phase, index) =>
        probeOwnedWebRoot(
          `http://127.0.0.1:${server.address().port}/`,
          directory,
          `${phase}-${index}`
        ),
      delay: async () => assert.fail('a final failure must not retry'),
      readLog: () => '',
      resources: facts,
    })
    assert.equal(value.passed, false)
    assert.equal(calls, 2)
    assert.deepEqual(
      value.probes.map((row) => row.httpStatus),
      [200, 500]
    )
    assert.equal(value.probes.at(-1).exitCode, 22)
    assert.ok(
      fs
        .readFileSync(path.join(directory, 'verify-1-body.html'), 'utf8')
        .includes('private.member')
    )
    assert.equal(JSON.stringify(value).includes('private.member'), false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
test('probe refuses remote origins, credentials and unreviewed capture filenames before curl', async () => {
  for (const [url, name] of [
    ['https://example.test/', 'wait-0'],
    ['http://user@127.0.0.1/', 'wait-0'],
    ['http://127.0.0.1/?token=x', 'wait-0'],
    ['http://127.0.0.1/', '../private'],
  ])
    await assert.rejects(
      probeOwnedWebRoot(url, '/unused', name),
      /owned_web_startup_origin_required/
    )
})
test('an unavailable startup log remains explicitly unavailable', async () => {
  const f = fixture([200, 500])
  const value = await waitForOwnedWeb({ ...f.options, readLog: () => null })
  assert.equal(value.logCaptured, false)
  assert.deepEqual(value.logSignals, [])
  assert.deepEqual(value.frameworkFrames, [])
})
test('evidence rejects unknown fields, private strings, invalid positions and invented passing results', async () => {
  const value = await waitForOwnedWeb(fixture([200, 500]).options)
  for (const mutate of [
    (copy) => {
      copy.secret = 'private'
    },
    (copy) => {
      copy.passed = true
    },
    (copy) => {
      copy.logSignals = ['member@example.test']
    },
    (copy) => {
      copy.frameworkFrames = [{ file: 'private.js', line: 1, column: 1 }]
    },
    (copy) => {
      copy.resources.after.freeDiskBytes = -1
    },
    (copy) => {
      copy.probes.at(-1).httpStatus = 'private'
    },
    (copy) => {
      copy.probes[0].extra = 'private'
    },
  ]) {
    const copy = structuredClone(value)
    mutate(copy)
    assert.throws(
      () => assertWebStartupEvidence(copy),
      /^Error: invalid_web_startup_evidence$/
    )
  }
})
test('public artifact retains closed startup evidence while omitting log, body and headers; poison fails before copy', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-web-evidence-'))
  const value = await waitForOwnedWeb(fixture([200, 500]).options)
  const file = path.join(directory, 'web-startup.json')
  fs.writeFileSync(file, JSON.stringify(value))
  fs.writeFileSync(path.join(directory, 'web-startup-private.log'), 'private')
  fs.mkdirSync(path.join(directory, 'web-startup-private'))
  fs.writeFileSync(path.join(directory, 'web-startup-private/body.html'), 'private')
  const run = () =>
    spawnSync(process.execPath, ['scripts/e2e-share-card/public-evidence.mjs'], {
      env: { ...process.env, CC68_HARNESS_DIR: directory, CC68_CI_PLATFORM: undefined },
      encoding: 'utf8',
    })
  try {
    assert.equal(run().status, 0)
    const output = path.join(directory, 'public-evidence')
    assert.deepEqual(fs.readdirSync(output), ['web-startup.json'])
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(output, 'web-startup.json'))),
      value
    )
    fs.writeFileSync(file, JSON.stringify({ ...value, secret: 'member@example.test' }))
    const rejected = run()
    assert.notEqual(rejected.status, 0)
    assert.equal(rejected.stderr.includes('member@example.test'), false)
    assert.deepEqual(fs.readdirSync(output), [])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
test('mandatory API36 CI waits through the instrumented wrapper and registers its controls', () => {
  const workflow = parse(
    fs.readFileSync('.github/workflows/pr-share-card-native.yml', 'utf8')
  )
  const steps = workflow.jobs['original-resource'].steps
  const step = steps.find(
    (row) => row.name === 'Genuine browser share-card acceptance matrix'
  )
  assert.ok(step.run.includes('web-startup-private.log'))
  assert.ok(step.run.includes('node scripts/e2e-share-card/wait-web.mjs'))
  assert.equal(step.run.includes('for attempt'), false)
  assert.ok(step.run.indexOf('wait-web.mjs') < step.run.indexOf('npx playwright test'))
  assert.ok(
    steps.some((row) => row.run?.includes('scripts/e2e-share-card/wait-web.test.mjs'))
  )
})
