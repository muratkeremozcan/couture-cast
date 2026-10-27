import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import {
  waitForOwnedWeb,
  probeOwnedWebRoot,
  assertWebStartupEvidence,
  readStartupLog,
} from './wait-web.mjs'
import { summarizeStartupFailure } from './web-startup-failure.mjs'

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

describe('waitForOwnedWeb', () => {
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

  test('an unavailable startup log remains explicitly unavailable', async () => {
    const f = fixture([200, 500])
    const value = await waitForOwnedWeb({ ...f.options, readLog: () => null })
    assert.equal(value.logCaptured, false)
    assert.deepEqual(value.logSignals, [])
    assert.deepEqual(value.frameworkFrames, [])
  })
})

describe('probeOwnedWebRoot', () => {
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
})

describe('readStartupLog', () => {
  test('failed response capture waits for the corresponding delayed Next stderr tail', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-web-log-flush-'))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    const log = path.join(directory, 'web-startup-private.log')
    fs.writeFileSync(log, 'GET / 200\n')
    const f = fixture([200, 500])
    let flushes = 0
    // The injected flush stands in for Next writing its stderr after the response.
    const flush = async () => {
      flushes++
      fs.appendFileSync(log, 'TypeError: controlled delayed render error\n')
    }
    const value = await waitForOwnedWeb({
      ...f.options,
      readLog: (options) => readStartupLog(directory, { ...options, flush }),
    })
    assert.equal(flushes, 1)
    assert.ok(
      value.failureDetails.logTail.includes('TypeError: controlled delayed render error')
    )
    assert.equal(f.calls(), 2)
    assert.equal(value.probes.at(-1).exitCode, 22)
  })

  test('a passing startup reads the log without waiting for a stderr flush', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-web-log-pass-'))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    fs.writeFileSync(path.join(directory, 'web-startup-private.log'), 'GET / 200\n')
    const flush = () => assert.fail('a passing startup must not wait for a flush')
    assert.equal(await readStartupLog(directory, { failed: false, flush }), 'GET / 200\n')
  })
})

describe('summarizeStartupFailure', () => {
  test('a 500 exposes the Next error digest, class and message with a redacted log tail', async () => {
    const secret = 'private-token-value-0123456789'
    const log = `TypeError: controlled render failure ${secret}\n    at render (/owned/node_modules/next/dist/server/base-server.js:9:2)`
    const f = fixture([200, 500], log)
    const value = await waitForOwnedWeb({
      ...f.options,
      readBody: () =>
        `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
          err: {
            name: 'TypeError',
            message: `controlled render failure ${secret}`,
            digest: '123456789',
          },
        })}</script>`,
      secrets: [secret],
    })
    assert.equal(value.failureDetails?.nextDigest, '123456789')
    assert.deepEqual(value.failureDetails.errors, [
      { name: 'TypeError', message: 'controlled render failure [redacted]' },
    ])
    assert.ok(value.failureDetails.logTail.some((line) => line.includes('[redacted]')))
    assert.equal(JSON.stringify(value).includes(secret), false)
  })

  test('error details allow only diagnostic fields and remove credentials, URLs, email and paths', async () => {
    const token = 'private-key-value-0123456789'
    const value = summarizeStartupFailure({
      body: `<script id="__NEXT_DATA__">${JSON.stringify({
        err: {
          name: 'ReferenceError',
          message: `missing render value ${token} https://private.test/?signature=secret user@example.test`,
          digest: '987654321',
          props: { private: token },
        },
        props: { private: token },
      })}</script>`,
      log: `unreviewed private line ${token}\nTypeError: failure token=hidden /home/private/file.js\n    at render (/home/private/file.js:2:3)`,
      secrets: [token],
    })
    const serialized = JSON.stringify(value)
    for (const secret of [
      token,
      'private.test',
      'signature=secret',
      'user@example.test',
      '/home/private',
      'token=hidden',
    ])
      assert.equal(serialized.includes(secret), false)
    assert.equal(value.nextDigest, '987654321')
    assert.equal(value.logTail.length, 2)
    assert.equal(value.errors[0].name, 'ReferenceError')
    const f = await waitForOwnedWeb(fixture([200, 500]).options)
    for (const details of [
      { ...value, body: 'raw private response' },
      { ...value, logTail: ['unreviewed line'] },
      { ...value, errors: [{ name: 'Error', message: 'user@example.test' }] },
      { ...value, errors: [{ name: 'Error', message: token, secret: token }] },
    ])
      assert.throws(
        () => assertWebStartupEvidence({ ...f, failureDetails: details }),
        /invalid_web_startup_failure_details/
      )
  })

  test('an App Router 500 exposes the Flight error row and the recompilation timeline', () => {
    const token = 'private-flight-value-0123456789'
    // Shape copied from a controlled Next 15.5 dev 500: the error row spans two pushes.
    const row = `2c:E${JSON.stringify({
      digest: '3303912371',
      name: 'TypeError',
      message: `controlled second render failure ${token}`,
      stack: [['Home', 'webpack-internal:///(rsc)/./src/app/page.tsx', 16, 35]],
    })}\n`
    const push = (text) =>
      `<script>self.__next_f.push([1,${JSON.stringify(text)}])</script>`
    const value = summarizeStartupFailure({
      body: `<html>${push('1:"$Sreact.fragment"\n' + row.slice(0, 40))}${push(row.slice(40))}</html>`,
      log: [
        ' ✓ Compiled / in 2.3s (1233 modules)',
        ' GET / 200 in 2560ms',
        ' ○ Compiling / ...',
        ` ⨯ TypeError: controlled second render failure ${token}`,
        '    at Home (src/app/page.tsx:16:35)',
        "> 16 |   if (renders > 1) throw new TypeError('private source line')",
        "  digest: '3303912371'",
        ' GET / 500 in 3965ms',
      ].join('\n'),
      secrets: [token],
    })
    assert.equal(value.nextDigest, '3303912371')
    assert.deepEqual(value.errors, [
      { name: 'TypeError', message: 'controlled second render failure [redacted]' },
    ])
    assert.ok(value.logTail.includes(' ○ Compiling / ...'))
    assert.ok(value.logTail.includes('    at Home (src/app/page.tsx:16:35)'))
    assert.equal(
      value.logTail.some((line) => line.includes('private source line')),
      false
    )
    assert.equal(JSON.stringify(value).includes('webpack-internal'), false)
    assert.equal(JSON.stringify(value).includes(token), false)
  })

  test('a failed App Router shell template supplies the decoded digest and message', () => {
    const value = summarizeStartupFailure({
      body: '<template data-next-error-message="Can&#x27;t render &quot;Home&quot;" data-next-error-digest="NEXT_SHELL_1" data-next-error-stack=""></template>',
      log: '',
    })
    assert.equal(value.nextDigest, 'NEXT_SHELL_1')
    assert.deepEqual(value.errors, [{ name: 'Error', message: 'Can\'t render "Home"' }])
  })

  test('control characters inside secrets cannot rejoin them after redaction or lose the summary', () => {
    const jwt = 'eyJ\u0001hdr.payload.signature'
    const url = 'https\u0002://private.test/signed?token=1'
    const secret = 'owned\u0003-secret-value'
    const value = summarizeStartupFailure({
      body: `<script>self.__next_f.push([1,${JSON.stringify(
        `2c:E${JSON.stringify({ digest: '77', name: 'TypeError', message: `bad ${jwt} ${url}` })}\n`
      )}])</script>`,
      log: ` ⨯ TypeError: bad ${jwt} ${url} ${secret}\n    at Home (src/app/page.tsx:1:2)`,
      secrets: [secret],
    })
    const serialized = JSON.stringify(value)
    for (const leaked of ['eyJhdr', 'payload.signature', 'private.test', 'owned-secret'])
      assert.equal(serialized.includes(leaked), false)
    assert.equal(value.nextDigest, '77')
    assert.equal(value.errors[0].name, 'TypeError')
    assert.ok(value.logTail.includes('    at Home (src/app/page.tsx:1:2)'))
  })
})

describe('web startup evidence schema', () => {
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
})

describe('web startup CI wiring', () => {
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
})
