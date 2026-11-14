import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { evaluateApprovedCondition, matrixRows } from './workflow-step-shadowing.mjs'
import nodeTestGateReporter from './node-test-gate-reporter.mjs'
import {
  assertNodeTestGate,
  backgroundDirectory,
  backgroundSuites,
  collectBackgroundSuites,
  coverageProblems,
  discoverTestFiles,
  gatedSuite,
  assertVitestReport,
  loadManifest,
  localPlan,
  localPreflight,
  resolveSuite,
  runGatesTestFile,
  runNodeTestGate,
  startBackgroundSuites,
  summarizeNodeTestEvents,
} from './node-test-gate.mjs'
import { killOwnedGroup } from '../lib/owned-process.mjs'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

const sources = {
  'passing.test.mjs': `import { test } from 'node:test'
test('one', () => {})
test('two', () => {})
`,
  'grouped.test.mjs': `import { describe, test } from 'node:test'
describe('group', () => { test('three', () => {}) })
`,
  'empty.test.mjs': '// registers no test\n',
  'skipped.test.mjs': `import { test } from 'node:test'
test('kept', () => {})
test('skipped', { skip: true }, () => {})
`,
  'skipped-suite.test.mjs': `import { describe, test } from 'node:test'
test('kept', () => {})
describe.skip('dropped', () => { test('inner', () => {}) })
`,
  'todo.test.mjs': `import { test } from 'node:test'
test('kept', () => {})
test('later', { todo: true }, () => {})
`,
  'failing.test.mjs': `import { test } from 'node:test'
test('kept', () => {})
test('broken', () => { throw new Error('broken') })
`,
  'crashing.test.mjs': "throw new Error('load failure')\n",
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// Temporary roots a test keeps for its whole describe block; the file removes them at its end.
const scratchRoots = []
function scratchRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  scratchRoots.push(root)
  return root
}
after(() => {
  for (const root of scratchRoots) fs.rmSync(root, { recursive: true, force: true })
})

function temporary(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'node-test-gate-fixture-'))
  const remove = () => fs.rmSync(directory, { recursive: true, force: true })
  let result
  try {
    result = run(directory)
  } catch (error) {
    remove()
    throw error
  }
  // An async body keeps its directory until it settles.
  if (typeof result?.then === 'function') return result.finally(remove)
  remove()
  return result
}

function write(directory, files) {
  for (const [name, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true })
    fs.writeFileSync(path.join(directory, name), source)
  }
}

const withFixtures = (run) =>
  temporary((directory) => {
    write(directory, sources)
    return run(directory)
  })

const gate = (directory, files) =>
  runNodeTestGate({ cwd: directory, files, stdio: 'ignore' })

describe('node-test-gate run', () => {
  test('passes when every file reports a passing test, with per-file counts', () =>
    withFixtures((directory) => {
      assert.deepEqual(gate(directory, ['passing.test.mjs', 'grouped.test.mjs']), {
        passed: 3,
        failed: 0,
        skipped: 0,
        todo: 0,
        perFile: { 'passing.test.mjs': 2, 'grouped.test.mjs': 1 },
      })
    }))

  test('a file that registers zero tests fails beside a passing file', () =>
    withFixtures((directory) => {
      assert.throws(
        () => gate(directory, ['passing.test.mjs', 'empty.test.mjs']),
        /node_test_gate_failed: empty\.test\.mjs reported no passing test$/
      )
    }))

  test('a skipped test fails although node --test exits 0', () =>
    withFixtures((directory) => {
      assert.throws(
        () => gate(directory, ['skipped.test.mjs']),
        /node_test_gate_failed: 1 skipped$/
      )
    }))

  test('a skipped suite fails', () =>
    withFixtures((directory) => {
      assert.throws(
        () => gate(directory, ['skipped-suite.test.mjs']),
        /node_test_gate_failed: .*skipped/
      )
    }))

  test('a todo test fails although node --test exits 0', () =>
    withFixtures((directory) => {
      assert.throws(
        () => gate(directory, ['todo.test.mjs']),
        /node_test_gate_failed: 1 todo$/
      )
    }))

  test('a failing test fails with the runner status and the failure count', () =>
    withFixtures((directory) => {
      assert.throws(
        () => gate(directory, ['failing.test.mjs']),
        /node_test_gate_failed: node --test exited 1; 1 failed$/
      )
    }))

  test('a file that throws while loading fails and reports no passing test', () =>
    withFixtures((directory) => {
      assert.throws(
        () => gate(directory, ['passing.test.mjs', 'crashing.test.mjs']),
        /node --test exited 1; 1 failed; crashing\.test\.mjs reported no passing test$/
      )
    }))

  test('an empty suite fails before running node --test', () => {
    assert.throws(
      () => runNodeTestGate({ files: [], spawn: () => assert.fail('must not run') }),
      /node_test_gate_failed: the suite has no file/
    )
  })
})

/**
 * A pid these tests may signal as a group: a positive integer that is neither init nor this
 * process, so a group signal can never become kill(-1) (every process of the user) or reach the
 * test runner. Process groups are POSIX; the detached background runs need them.
 */
function checkedGroup(pid) {
  if (process.platform === 'win32')
    throw new Error('node-test-gate background tests need POSIX process groups')
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid)
    throw new Error(`not a background process group: ${pid}`)
  return pid
}

/**
 * Live (non-zombie) members of the group led by `pid`. macOS answers a group signal with EPERM
 * while the group holds only a zombie its parent has not reaped yet, so that case is read here.
 */
function liveMembers(pid) {
  const listed = spawnSync('ps', ['-A', '-o', 'pid=,pgid=,stat='], { encoding: 'utf8' })
  if (listed.status !== 0) throw new Error(`ps failed: ${listed.stderr}`)
  return listed.stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([, pgid, stat]) => Number(pgid) === pid && stat && !stat.startsWith('Z'))
    .map(([member]) => Number(member))
}

/** True while any process of the group led by `pid` is alive; ESRCH means it is gone. */
function groupAlive(pid) {
  try {
    process.kill(-checkedGroup(pid), 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    if (error.code === 'EPERM') return liveMembers(pid).length > 0
    throw error
  }
}

/**
 * Kills what is left of the group led by `pid`: only live members that are this suite's (the
 * background gate, its node --test runner and reporter, or a fixture file under the temp dir), so
 * a group id the OS gave to someone else after this one ended is never signalled (TEA, r32).
 */
function killGroup(pid) {
  killOwnedGroup(checkedGroup(pid), [
    'node-test-gate',
    os.tmpdir(),
    fs.realpathSync(os.tmpdir()),
  ])
}

/**
 * A suite file that blocks until its release file appears. The background run is detached, so
 * nothing kills it with the test that started it: it gives up when that test's temporary
 * directory is gone, when the owning process is gone (a gate killed mid-test runs no cleanup),
 * and after two minutes in any case, removing that directory itself when it gives up. Once it
 * has seen its owner alive from inside the wait loop, it writes `ready`.
 */
function blockedSource({ release, temp, owner, ready }) {
  if (!Number.isInteger(owner) || owner <= 1)
    throw new Error(`not an owner pid: ${owner}`)
  return `import fs from 'node:fs'
import { test } from 'node:test'
const ownerAlive = () => {
  try {
    process.kill(${owner}, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}
const giveUp = (reason) => {
  fs.rmSync(${JSON.stringify(temp)}, { recursive: true, force: true })
  throw new Error(reason)
}
test('waits for its release', async () => {
  const deadline = Date.now() + 120_000
  while (!fs.existsSync(${JSON.stringify(release)})) {
    if (!fs.existsSync(${JSON.stringify(temp)})) throw new Error('released by cleanup')
    if (!ownerAlive()) giveUp('released: its owner is gone')
    if (Date.now() > deadline) giveUp('released: two minutes passed')
    if (!fs.existsSync(${JSON.stringify(ready)})) fs.writeFileSync(${JSON.stringify(ready)}, '')
    await new Promise((done) => setTimeout(done, 25))
  }
})
`
}

// Every background run these tests start leads its own process group. Each test settles its
// group when it ends and drops it once gone, so no ended pid waits here to be reused; a group
// still alive then stays listed, and the suite kills it and fails.
const backgroundGroups = new Set()
function trackStarted(suite, env) {
  const { pid } = JSON.parse(
    fs.readFileSync(path.join(backgroundDirectory(suite, env), 'started.json'), 'utf8')
  )
  backgroundGroups.add(checkedGroup(pid))
  return pid
}
async function settleGroup(pid) {
  for (let i = 0; i < 100 && groupAlive(pid); i++) await sleep(50)
  if (!groupAlive(pid)) backgroundGroups.delete(pid)
}

// The background form starts suites in one detached process and a later step collects
// them. Collect must apply the foreground pass rules and fail when a run is missing or
// never finished.
describe('node-test-gate background run', () => {
  after(() => {
    const survivors = [...backgroundGroups]
    for (const group of survivors) killGroup(group)
    assert.deepEqual(
      survivors,
      [],
      'a background suite outlived the tests that started it'
    )
  })

  const suitesOf = {
    good: ['passing.test.mjs', 'grouped.test.mjs'],
    empty: ['passing.test.mjs', 'empty.test.mjs'],
    skipped: ['skipped.test.mjs'],
    todo: ['todo.test.mjs'],
    failing: ['failing.test.mjs'],
    crashing: ['passing.test.mjs', 'crashing.test.mjs'],
  }
  const manifest = { suites: suitesOf }
  const background = (run) =>
    withFixtures((directory) =>
      temporary((temp) => run(directory, { ...process.env, RUNNER_TEMP: temp }))
    )
  const startAndCollect = async (directory, env, suites) => {
    startBackgroundSuites(suites, { root: directory, manifest, cwd: directory, env })
    const group = trackStarted(suites[0], env)
    const logs = []
    try {
      return {
        summaries: await collectBackgroundSuites(suites, {
          env,
          timeoutMs: 60_000,
          pollMs: 50,
          log: (line) => logs.push(line),
        }),
        logs,
      }
    } catch (error) {
      error.logs = logs
      throw error
    } finally {
      await settleGroup(group)
    }
  }

  test('writes under RUNNER_TEMP, falling back to the system temporary directory', () => {
    assert.equal(
      backgroundDirectory('good', { RUNNER_TEMP: '/runner/temp' }),
      path.join('/runner/temp', 'node-test-gate', 'good')
    )
    assert.equal(
      backgroundDirectory('good', {}),
      path.join(os.tmpdir(), 'node-test-gate', 'good')
    )
  })

  test('collect passes with the foreground summary and prints each suite log', () =>
    background(async (directory, env) => {
      const { summaries, logs } = await startAndCollect(directory, env, ['good'])
      assert.deepEqual(summaries.good, gate(directory, suitesOf.good))
      const printed = logs.join('\n')
      assert.match(printed, /one/)
      assert.match(printed, /three/)
      assert.match(printed, /suite good passed 3 tests in 2 files/)
      for (const name of ['events.jsonl', 'output.log', 'status.json'])
        assert.ok(fs.existsSync(path.join(backgroundDirectory('good', env), name)), name)
    }))

  for (const [suite, expected] of [
    ['empty', /node_test_gate_failed: empty\.test\.mjs reported no passing test$/m],
    ['skipped', /node_test_gate_failed: 1 skipped$/m],
    ['todo', /node_test_gate_failed: 1 todo$/m],
    ['failing', /node_test_gate_failed: node --test exited 1; 1 failed$/m],
    [
      'crashing',
      /node --test exited 1; 1 failed; crashing\.test\.mjs reported no passing test$/m,
    ],
  ])
    test(`collect fails a ${suite} suite with the foreground message`, () =>
      background(async (directory, env) => {
        await assert.rejects(startAndCollect(directory, env, [suite]), expected)
      }))

  test('one failing suite fails collect after every suite is reported', () =>
    background(async (directory, env) => {
      const error = await startAndCollect(directory, env, ['failing', 'good']).then(
        () => assert.fail('collect passed'),
        (caught) => caught
      )
      assert.match(error.message, /suite failing: node_test_gate_failed: .*1 failed/)
      assert.doesNotMatch(error.message, /suite good/)
      assert.match(error.logs.join('\n'), /suite good passed 3 tests/)
    }))

  test('collect fails a suite that no start step launched', () =>
    temporary(async (temp) => {
      await assert.rejects(
        collectBackgroundSuites(['good'], {
          env: { RUNNER_TEMP: temp },
          timeoutMs: 1000,
          pollMs: 10,
          log: () => undefined,
        }),
        /suite good: node_test_gate_failed: suite good was never started in the background \(no .*node-test-gate\/good\/started\.json\)/
      )
    }))

  test('collect fails a run that never finished within the bounded wait', () =>
    temporary(async (temp) => {
      const env = { RUNNER_TEMP: temp }
      fs.mkdirSync(backgroundDirectory('good', env), { recursive: true })
      fs.writeFileSync(
        path.join(backgroundDirectory('good', env), 'started.json'),
        JSON.stringify({ files: suitesOf.good, cwd: temp, pid: process.pid })
      )
      fs.writeFileSync(
        path.join(backgroundDirectory('good', env), 'output.log'),
        'DIAGNOSTIC_BEFORE_HANG\n'
      )
      const logs = []
      await assert.rejects(
        collectBackgroundSuites(['good'], {
          env,
          timeoutMs: 200,
          pollMs: 10,
          log: (line) => logs.push(line),
        }),
        /suite good: node_test_gate_failed: suite good did not finish within the collection's 0\.2 s/
      )
      // PR 216 review BA-04: how far the suite got is still reported.
      assert.ok(
        logs.some((line) => line.includes('DIAGNOSTIC_BEFORE_HANG')),
        logs.join('\n')
      )
    }))

  // PR 216 CodeRabbit: the worker runs suites in turn, so one hung suite must not give the
  // next a fresh wait; the whole collection shares one deadline inside the step's limit.
  test('every suite shares one collection deadline, and each one is still reported', () =>
    temporary(async (temp) => {
      const env = { RUNNER_TEMP: temp }
      for (const suite of ['good', 'todo']) {
        fs.mkdirSync(backgroundDirectory(suite, env), { recursive: true })
        fs.writeFileSync(
          path.join(backgroundDirectory(suite, env), 'started.json'),
          JSON.stringify({ pid: process.pid })
        )
      }
      const logs = []
      const began = Date.now()
      await assert.rejects(
        collectBackgroundSuites(['good', 'todo'], {
          env,
          timeoutMs: 1_000,
          pollMs: 10,
          log: (line) => logs.push(line),
        }),
        (error) =>
          /suite good: .*did not finish/.test(error.message) &&
          /suite todo: .*did not finish/.test(error.message)
      )
      // A wait per suite would take at least two seconds.
      assert.ok(Date.now() - began < 1_800, `collection took ${Date.now() - began} ms`)
    }))

  test('collect fails at once when the background process ended without a result', () =>
    temporary(async (temp) => {
      const env = { RUNNER_TEMP: temp }
      const ended = spawnSync(process.execPath, ['-e', ''])
      assert.equal(ended.status, 0)
      fs.mkdirSync(backgroundDirectory('good', env), { recursive: true })
      fs.writeFileSync(
        path.join(backgroundDirectory('good', env), 'started.json'),
        JSON.stringify({ files: suitesOf.good, cwd: temp, pid: ended.pid })
      )
      fs.writeFileSync(
        path.join(backgroundDirectory('good', env), 'output.log'),
        'DIAGNOSTIC_BEFORE_KILL\n'
      )
      const logs = []
      const began = Date.now()
      await assert.rejects(
        collectBackgroundSuites(['good'], {
          env,
          timeoutMs: 30_000,
          pollMs: 10,
          log: (line) => logs.push(line),
        }),
        /suite good: node_test_gate_failed: the background run of suite good ended without recording a result/
      )
      assert.ok(Date.now() - began < 10_000)
      assert.ok(
        logs.some((line) => line.includes('DIAGNOSTIC_BEFORE_KILL')),
        logs.join('\n')
      )
    }))

  // PR 216 review BA-03: the start command must return while its suites still run, or the
  // job waits for them before setting up the browsers and the overlap is lost. The suite
  // here blocks until the test releases it, so no timing threshold decides the result.
  test('the starting process exits while its suite is still running, and a later process collects it', () =>
    temporary(async (temp) => {
      const directory = path.join(temp, 'repo')
      fs.mkdirSync(directory)
      const release = path.join(temp, 'release')
      fs.writeFileSync(
        path.join(directory, 'blocked.test.mjs'),
        blockedSource({
          release,
          temp,
          owner: process.pid,
          ready: path.join(temp, 'ready'),
        })
      )
      const env = { ...process.env, RUNNER_TEMP: path.join(temp, 'runner') }
      const starter = `import { startBackgroundSuites } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'scripts/ci/node-test-gate.mjs')).href)}
startBackgroundSuites(['blocked'], { root: ${JSON.stringify(directory)}, manifest: { suites: { blocked: ['blocked.test.mjs'] } }, cwd: ${JSON.stringify(directory)}, env: process.env })
`
      const started = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', starter],
        {
          env,
          encoding: 'utf8',
          timeout: 30_000,
        }
      )
      assert.equal(
        started.error,
        undefined,
        'the starting process did not exit on its own'
      )
      assert.equal(started.status, 0, started.stderr)
      const group = trackStarted('blocked', env)
      try {
        assert.equal(
          fs.existsSync(path.join(backgroundDirectory('blocked', env), 'status.json')),
          false,
          'the suite finished before the starting process exited'
        )
        fs.writeFileSync(release, '')
        const logs = []
        const summaries = await collectBackgroundSuites(['blocked'], {
          env,
          timeoutMs: 60_000,
          pollMs: 25,
          log: (line) => logs.push(line),
        })
        assert.equal(summaries.blocked.passed, 1)
      } finally {
        await settleGroup(group)
      }
    }))

  // A gate killed mid-test runs no cleanup: 15 h after one, its blocked suite was still waiting
  // (PPID 1). The fixture must end with the process that started it, not with its directory,
  // and take that directory with it. The owner dies only once the suite is inside its wait loop.
  test('a blocked background suite ends when the process that started it dies', () =>
    temporary(async (temp) => {
      const directory = path.join(temp, 'repo')
      fs.mkdirSync(directory)
      const scratch = path.join(temp, 'scratch')
      fs.mkdirSync(scratch)
      const ready = path.join(temp, 'ready')
      const owner = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
      })
      let group
      try {
        fs.writeFileSync(
          path.join(directory, 'blocked.test.mjs'),
          blockedSource({
            release: path.join(temp, 'release'),
            temp: scratch,
            owner: owner.pid,
            ready,
          })
        )
        const env = { ...process.env, RUNNER_TEMP: path.join(temp, 'runner') }
        startBackgroundSuites(['blocked'], {
          root: directory,
          manifest: { suites: { blocked: ['blocked.test.mjs'] } },
          cwd: directory,
          env,
        })
        group = trackStarted('blocked', env)
        for (let i = 0; i < 400 && !fs.existsSync(ready); i++) await sleep(25)
        assert.equal(fs.existsSync(ready), true, 'the suite never entered its wait loop')
        owner.kill('SIGKILL')
        for (let i = 0; i < 200 && groupAlive(group); i++) await sleep(50)
        assert.equal(groupAlive(group), false, 'the background suite outlived its owner')
        assert.equal(fs.existsSync(scratch), false, 'the suite left its directory behind')
      } finally {
        owner.kill('SIGKILL')
        if (group) {
          killGroup(group)
          await settleGroup(group)
        }
      }
    }))

  test('start refuses an unknown suite before launching anything', () =>
    temporary((temp) => {
      assert.throws(
        () =>
          startBackgroundSuites(['absent'], {
            root: temp,
            manifest,
            env: { RUNNER_TEMP: temp },
            spawn: () => assert.fail('must not launch'),
          }),
        /node_test_gate_unknown_suite: absent/
      )
    }))

  test('a second start clears the earlier result of the suite', () =>
    background(async (directory, env) => {
      await startAndCollect(directory, env, ['good'])
      const launched = []
      startBackgroundSuites(['good'], {
        root: directory,
        manifest,
        cwd: directory,
        env,
        spawn: (...args) => {
          launched.push(args)
          return { pid: process.pid, unref: () => undefined }
        },
      })
      assert.equal(launched.length, 1)
      assert.equal(
        fs.existsSync(path.join(backgroundDirectory('good', env), 'status.json')),
        false
      )
    }))
})

describe('node-test-gate summary', () => {
  const event = (overrides) => ({
    outcome: 'pass',
    kind: 'test',
    name: 'case',
    nesting: 0,
    file: '/repo/a.test.mjs',
    skip: false,
    todo: false,
    ...overrides,
  })

  test('counts only real tests, never suites or the runner file wrapper', () => {
    assert.deepEqual(
      summarizeNodeTestEvents(
        [
          event({}),
          event({ kind: 'suite' }),
          event({ name: 'b.test.mjs', file: '/repo/b.test.mjs' }),
        ],
        ['a.test.mjs', 'b.test.mjs'],
        '/repo'
      ),
      {
        passed: 1,
        failed: 0,
        skipped: 0,
        todo: 0,
        perFile: { 'a.test.mjs': 1, 'b.test.mjs': 0 },
      }
    )
  })

  test('a failing todo test counts as todo, never as a pass', () => {
    const summary = summarizeNodeTestEvents(
      [event({ outcome: 'fail', todo: true })],
      ['a.test.mjs'],
      '/repo'
    )
    assert.deepEqual(summary, {
      passed: 0,
      failed: 0,
      skipped: 0,
      todo: 1,
      perFile: { 'a.test.mjs': 0 },
    })
    assert.throws(
      () => assertNodeTestGate(summary, { status: 0 }),
      /node_test_gate_failed: 1 todo; a\.test\.mjs reported no passing test$/
    )
  })
})

// Raw node:test events recorded from a one-test file, an empty file, a file that throws
// while loading and a suite with skipped and todo children. Node 24.19 omits
// entryFile, which 24.22 adds to every child-process event.
function recordedEvents(version) {
  const child = (data) =>
    version === '24.22' ? { ...data, entryFile: data.file } : { ...data }
  return [
    [
      'test:pass',
      child({ name: 'one', nesting: 0, file: '/repo/one.test.mjs', line: 2 }),
    ],
    [
      'test:pass',
      { name: 'empty.test.mjs', nesting: 0, file: '/repo/empty.test.mjs', line: 1 },
    ],
    [
      'test:fail',
      { name: 'crash.test.mjs', nesting: 0, file: '/repo/crash.test.mjs', line: 1 },
    ],
    ['test:pass', child({ name: 'ok', nesting: 1, file: '/repo/a.test.mjs', line: 2 })],
    [
      'test:pass',
      child({ name: 'sk', nesting: 1, file: '/repo/a.test.mjs', skip: true }),
    ],
    [
      'test:pass',
      child({ name: 'td', nesting: 1, file: '/repo/a.test.mjs', todo: true }),
    ],
    ['test:pass', child({ name: 'g', nesting: 0, file: '/repo/a.test.mjs' }), 'suite'],
  ].map(([type, data, kind = 'test']) => ({
    type,
    data: { column: 1, ...data, details: { type: kind } },
  }))
}

async function replay(events) {
  async function* source() {
    yield* events
  }
  const lines = []
  for await (const line of nodeTestGateReporter(source())) lines.push(JSON.parse(line))
  return lines
}

describe('node-test-gate attribution across Node 24 releases', () => {
  for (const version of ['24.19', '24.22'])
    test(`recorded ${version} events attribute passes and never count the empty-file wrapper`, async () => {
      const files = ['one.test.mjs', 'empty.test.mjs', 'crash.test.mjs', 'a.test.mjs']
      const summary = summarizeNodeTestEvents(
        await replay(recordedEvents(version)),
        files,
        '/repo'
      )
      assert.deepEqual(summary, {
        passed: 2,
        failed: 1,
        skipped: 1,
        todo: 1,
        perFile: {
          'one.test.mjs': 1,
          'empty.test.mjs': 0,
          'crash.test.mjs': 0,
          'a.test.mjs': 1,
        },
      })
      assert.throws(
        () => assertNodeTestGate(summary, { status: 1 }),
        /empty\.test\.mjs reported no passing test; crash\.test\.mjs reported no passing test$/
      )
    })

  // TEA, 2026-11-13: a gate run once ended with no summary; a runner killed by a signal is named.
  test('a runner killed by a signal is reported with its signal', () => {
    assert.throws(
      () =>
        assertNodeTestGate(
          { passed: 1, failed: 0, skipped: 0, todo: 0, perFile: { 'a.test.mjs': 1 } },
          { status: null, signal: 'SIGKILL' }
        ),
      /^Error: node_test_gate_failed: node --test exited by SIGKILL$/
    )
  })

  test('a test named like another path still counts; only a file named after itself is a wrapper', async () => {
    const [event] = await replay([
      {
        type: 'test:pass',
        data: {
          name: 'one.test.mjs',
          nesting: 0,
          file: '/repo/a.test.mjs',
          details: { type: 'test' },
        },
      },
    ])
    assert.equal(
      summarizeNodeTestEvents([event], ['a.test.mjs'], '/repo').perFile['a.test.mjs'],
      1
    )
  })

  test('events without the attribution fields fail closed', async () => {
    for (const missing of ['name', 'file', 'nesting']) {
      const [raw] = recordedEvents('24.19')
      delete raw.data[missing]
      const events = await replay([raw])
      assert.throws(
        () => summarizeNodeTestEvents(events, ['one.test.mjs'], '/repo'),
        /node_test_gate_failed: a test event lacks the name, file or nesting that attribution needs/,
        missing
      )
    }
  })
})

const fixtureManifest = {
  discoverRoot: 'scripts',
  discoverPattern: '\\.(test|spec)\\.mjs$',
  workflow: 'workflow.yml',
  vitest: ['scripts/lib/vitest-only.test.mjs'],
  suites: {
    pinned: ['scripts/ci/early.test.mjs'],
    outside: ['apps/plugin.test.js'],
    default: 'discover',
  },
  conditionNeeds: { pinned: [], outside: [], default: ['setup'], vitest: [] },
}
const fixtureTree = {
  'scripts/ci/early.test.mjs': '',
  'scripts/lib/a.test.mjs': '',
  'scripts/lib/b.spec.mjs': '',
  'scripts/lib/vitest-only.test.mjs': '',
  'scripts/lib/helper.mjs': '',
  'scripts/deep/nested/c.test.mjs': '',
  'scripts/lib/node_modules/vendored.test.mjs': '',
  'apps/plugin.test.js': '',
}
const fixtureWorkflow = [
  'jobs:',
  '  first:',
  '    strategy:',
  '      matrix:',
  '        platform: [android]',
  '        include:',
  '          - platform: ios',
  '    steps:',
  '      - run: node scripts/ci/node-test-gate.mjs pinned',
  '      - run: |',
  '          node scripts/ci/node-test-gate.mjs outside',
  '          node scripts/ci/node-test-gate.mjs default',
  '  second:',
  '    steps:',
  '      - run: npx vitest run scripts/lib/vitest-only.test.mjs --reporter=json',
].join('\n')

describe('node-test-gate discovery and coverage', () => {
  test('the default suite discovers every unclaimed test file, nested ones included', () =>
    temporary((root) => {
      write(root, fixtureTree)
      assert.deepEqual(discoverTestFiles(root, fixtureManifest), [
        'scripts/ci/early.test.mjs',
        'scripts/deep/nested/c.test.mjs',
        'scripts/lib/a.test.mjs',
        'scripts/lib/b.spec.mjs',
        'scripts/lib/vitest-only.test.mjs',
      ])
      assert.deepEqual(resolveSuite('default', { root, manifest: fixtureManifest }), [
        'scripts/deep/nested/c.test.mjs',
        'scripts/lib/a.test.mjs',
        'scripts/lib/b.spec.mjs',
      ])
      assert.deepEqual(resolveSuite('pinned', { root, manifest: fixtureManifest }), [
        'scripts/ci/early.test.mjs',
      ])
      assert.throws(
        () => resolveSuite('absent', { root, manifest: fixtureManifest }),
        /node_test_gate_unknown_suite: absent/
      )
    }))

  test('a newly added or split test file joins the default suite with no manifest or workflow edit', () =>
    temporary((root) => {
      write(root, fixtureTree)
      const before = resolveSuite('default', { root, manifest: fixtureManifest })
      write(root, { 'scripts/lib/a-split.test.mjs': '' })
      assert.deepEqual(resolveSuite('default', { root, manifest: fixtureManifest }), [
        ...before.slice(0, 1),
        'scripts/lib/a-split.test.mjs',
        ...before.slice(1),
      ])
      assert.deepEqual(
        coverageProblems({ root, manifest: fixtureManifest, workflow: fixtureWorkflow }),
        []
      )
    }))

  test('coverage fails for a missing listed file, a duplicate claim or an empty pinned suite', () =>
    temporary((root) => {
      write(root, fixtureTree)
      const check = (manifest) =>
        coverageProblems({ root, manifest, workflow: fixtureWorkflow })
      assert.deepEqual(
        check({
          ...fixtureManifest,
          suites: { ...fixtureManifest.suites, pinned: ['scripts/ci/gone.test.mjs'] },
        }),
        ['scripts/ci/gone.test.mjs is missing']
      )
      assert.deepEqual(
        check({
          ...fixtureManifest,
          vitest: [...fixtureManifest.vitest, 'scripts/ci/early.test.mjs'],
        }),
        [
          'scripts/ci/early.test.mjs is listed more than once',
          'scripts/ci/early.test.mjs runs in no vitest step',
        ]
      )
      assert.deepEqual(
        check({ ...fixtureManifest, suites: { ...fixtureManifest.suites, pinned: [] } }),
        ['suite pinned lists no file']
      )
      assert.deepEqual(
        check({
          ...fixtureManifest,
          suites: { ...fixtureManifest.suites, second: 'discover' },
        }),
        [
          'exactly one discovering suite required, found 2',
          'suite second runs in no workflow step',
        ]
      )
    }))

  test('coverage fails when a suite or vitest file leaves the workflow or a bare node --test returns', () =>
    temporary((root) => {
      write(root, fixtureTree)
      const check = (workflow) =>
        coverageProblems({ root, manifest: fixtureManifest, workflow })
      assert.deepEqual(
        check(fixtureWorkflow.replace('node-test-gate.mjs pinned', 'node-test-gate.mjs')),
        ['suite pinned runs in no workflow step']
      )
      assert.deepEqual(
        check(
          `${fixtureWorkflow}\n      - run: node scripts/ci/node-test-gate.mjs renamed`
        ),
        ['workflow runs unknown suite renamed']
      )
      assert.deepEqual(
        check(`${fixtureWorkflow}\n      - run: node --test scripts/lib/a.test.mjs`),
        ['ungated node --test step: node --test scripts/lib/a.test.mjs']
      )
      assert.deepEqual(
        check(fixtureWorkflow.replace('scripts/lib/vitest-only.test.mjs', 'other')),
        ['scripts/lib/vitest-only.test.mjs runs in no vitest step']
      )
    }))

  test('a gate or vitest step whose condition can skip it fails coverage', () =>
    temporary((root) => {
      write(root, fixtureTree)
      const conditioned = (
        condition,
        run = 'node scripts/ci/node-test-gate.mjs default'
      ) =>
        fixtureWorkflow.replace(
          '      - run: |\n          node scripts/ci/node-test-gate.mjs outside\n          node scripts/ci/node-test-gate.mjs default',
          [
            '      - run: node scripts/ci/node-test-gate.mjs outside',
            '      - id: setup',
            '        run: echo setup',
            '      - name: default suite',
            `        if: ${condition}`,
            `        run: ${run}`,
          ].join('\n')
        )
      const check = (workflow) =>
        coverageProblems({ root, manifest: fixtureManifest, workflow })
      for (const condition of ['false', "github.event_name == 'push'", 'always()'])
        assert.deepEqual(check(conditioned(condition)), [
          `step default suite can be skipped by its condition: ${JSON.stringify(
            condition === 'false' ? false : condition
          )}`,
        ])
      for (const condition of [
        '${{ !cancelled() }}',
        "${{ !cancelled() && steps.setup.outcome == 'success' }}",
        "${{ !cancelled() && ((matrix.platform == 'android' && steps.setup.outcome == 'success') || (matrix.platform == 'ios' && steps.setup.outcome == 'success')) }}",
      ])
        assert.deepEqual(check(conditioned(`"${condition}"`)), [], condition)
      // In the grammar, but narrower than the rows the unrestricted suite covers.
      for (const condition of [
        "${{ !cancelled() && matrix.platform == 'android' && steps.setup.outcome == 'success' }}",
        "matrix.platform == 'android'",
      ])
        assert.deepEqual(
          check(conditioned(`"${condition}"`)),
          ['step default suite skips matrix row platform=ios, which default must run on'],
          condition
        )
      const vitest = fixtureWorkflow.replace(
        '      - run: npx vitest run',
        "      - if: github.ref == 'refs/heads/main'\n        run: npx vitest run"
      )
      assert.equal(check(vitest).length, 1)
    }))

  test('an extra or-clause or a choice branch with no platform is outside the grammar', () =>
    temporary((root) => {
      write(root, fixtureTree)
      const choice =
        "((matrix.platform == 'android' && steps.setup.outcome == 'success') || (matrix.platform == 'ios' && steps.setup.outcome == 'success'))"
      const workflow = (condition) =>
        fixtureWorkflow.replace(
          '          node scripts/ci/node-test-gate.mjs default',
          ''
        ) +
        [
          '',
          '  third:',
          '    strategy:',
          '      matrix:',
          '        platform: [android, ios]',
          '    steps:',
          '      - id: setup',
          '        run: echo setup',
          '      - name: default suite',
          `        if: "${condition}"`,
          '        run: node scripts/ci/node-test-gate.mjs default',
        ].join('\n')
      const check = (condition) =>
        coverageProblems({
          root,
          manifest: fixtureManifest,
          workflow: workflow(condition),
        })
      assert.deepEqual(check(`\${{ !cancelled() && ${choice} }}`), [])
      for (const condition of [
        `\${{ !cancelled() && ${choice} || always() }}`,
        "${{ !cancelled() && steps.setup.outcome == 'success' || true }}",
        "${{ !cancelled() && ((matrix.platform == 'android' && steps.setup.outcome == 'success') || (steps.setup.outcome == 'success')) }}",
        "${{ !cancelled() && ((matrix.platform == 'android') || always()) }}",
        "${{ !cancelled() && matrix.platform == 'android' || matrix.platform == 'ios' }}",
      ])
        assert.deepEqual(
          check(condition),
          [
            `step default suite can be skipped by its condition: ${JSON.stringify(condition)}`,
          ],
          condition
        )
    }))

  test('a gate step must name real matrix rows and may not continue on error', () =>
    temporary((root) => {
      write(root, fixtureTree)
      const step = (lines) =>
        fixtureWorkflow.replace(
          '      - run: |\n          node scripts/ci/node-test-gate.mjs outside\n          node scripts/ci/node-test-gate.mjs default',
          [
            '      - run: node scripts/ci/node-test-gate.mjs outside',
            '      - name: default suite',
            ...lines,
            '        run: node scripts/ci/node-test-gate.mjs default',
          ].join('\n')
        )
      const check = (lines) =>
        coverageProblems({ root, manifest: fixtureManifest, workflow: step(lines) })
      assert.deepEqual(check(['        if: "matrix.platform == \'ios\'"']), [
        'step default suite skips matrix row platform=android, which default must run on',
      ])
      assert.deepEqual(check(['        if: "matrix.platform == \'androd\'"']), [
        'step default suite can be skipped by its condition: "matrix.platform == \'androd\'"',
        "step default suite: matrix.platform is never 'androd' in the job matrix",
      ])
      assert.deepEqual(
        check(['        if: "${{ !cancelled() && matrix.platfrom == \'android\' }}"']),
        [
          'step default suite can be skipped by its condition: "${{ !cancelled() && matrix.platfrom == \'android\' }}"',
          'step default suite: matrix.platfrom is not a key of the job matrix',
        ]
      )
      for (const [value, shown] of [
        ['true', 'true'],
        ['false', 'false'],
        ["${{ matrix.platform == 'ios' }}", '"${{ matrix.platform == \'ios\' }}"'],
      ])
        assert.deepEqual(check([`        continue-on-error: ${value}`]), [
          `step default suite sets continue-on-error (${shown}), which hides a gate failure`,
        ])
    }))

  test('a gate step runs on every matrix row its suites cover, honouring row restrictions', () =>
    temporary((root) => {
      write(root, fixtureTree)
      const workflow = (condition) =>
        fixtureWorkflow.replace(
          '      - run: |\n          node scripts/ci/node-test-gate.mjs outside\n          node scripts/ci/node-test-gate.mjs default',
          [
            '      - run: node scripts/ci/node-test-gate.mjs default',
            '      - name: outside suite',
            `        if: "${condition}"`,
            '        run: node scripts/ci/node-test-gate.mjs outside',
          ].join('\n')
        )
      const restricted = {
        ...fixtureManifest,
        rowRestrictions: { outside: { platform: ['android'] } },
      }
      const check = (manifest, condition) =>
        coverageProblems({ root, manifest, workflow: workflow(condition) })
      const android = "${{ !cancelled() && matrix.platform == 'android' }}"
      assert.deepEqual(check(fixtureManifest, android), [
        'step outside suite skips matrix row platform=ios, which outside must run on',
      ])
      assert.deepEqual(check(restricted, android), [])
      assert.deepEqual(check(restricted, '${{ !cancelled() }}'), [])
      assert.deepEqual(
        check(restricted, "${{ !cancelled() && matrix.platform == 'ios' }}"),
        [
          'step outside suite skips matrix row platform=android, which outside must run on',
        ]
      )
    }))

  test('matrix rows follow the product, include and exclude rules', () => {
    assert.deepEqual(matrixRows(undefined), [{}])
    assert.deepEqual(
      matrixRows({ include: [{ platform: 'android', api: 32 }, { platform: 'ios' }] }),
      [{ platform: 'android', api: 32 }, { platform: 'ios' }]
    )
    assert.deepEqual(
      matrixRows({
        platform: ['android', 'ios'],
        api: [32, 36],
        include: [{ platform: 'ios', runner: 'macos' }, { platform: 'web' }],
        exclude: [{ platform: 'ios', api: 32 }],
      }),
      [
        { platform: 'android', api: 32 },
        { platform: 'android', api: 36 },
        { platform: 'ios', api: 36, runner: 'macos' },
        { platform: 'web' },
      ]
    )
    assert.equal(matrixRows({ platform: '${{ fromJSON(inputs.platforms) }}' }), null)
  })

  test('a gate step may wait only on the steps its suites declare they need', () =>
    temporary((root) => {
      write(root, fixtureTree)
      const workflow = fixtureWorkflow.replace(
        '      - run: |\n          node scripts/ci/node-test-gate.mjs outside\n          node scripts/ci/node-test-gate.mjs default',
        [
          '      - id: setup',
          '        run: echo setup',
          '      - id: runtime',
          '        run: echo runtime',
          '      - name: bundled suites',
          "        if: ${{ !cancelled() && steps.setup.outcome == 'success' && steps.runtime.outcome == 'success' }}",
          '        run: |',
          '          node scripts/ci/node-test-gate.mjs outside',
          '          node scripts/ci/node-test-gate.mjs default',
        ].join('\n')
      )
      assert.deepEqual(coverageProblems({ root, manifest: fixtureManifest, workflow }), [
        'step bundled suites waits on steps.runtime, which outside and default does not need',
      ])
      const { conditionNeeds, ...undeclared } = fixtureManifest
      void conditionNeeds
      assert.ok(
        coverageProblems({
          root,
          manifest: undeclared,
          workflow: fixtureWorkflow,
        }).includes('suite default declares no conditionNeeds')
      )
    }))

  test('a node:test file outside the discovery pattern or the lists fails coverage', () =>
    temporary((root) => {
      write(root, fixtureTree)
      const check = () =>
        coverageProblems({ root, manifest: fixtureManifest, workflow: fixtureWorkflow })
      const nodeTest = "import { test } from 'node:test'\ntest('kept', () => {})\n"
      write(root, {
        'scripts/lib/helper.mjs': "export const helper = 'mentions node:test only'\n",
      })
      assert.deepEqual(check(), [])
      write(root, { 'scripts/lib/a-checks.mjs': nodeTest })
      assert.deepEqual(check(), [
        'scripts/lib/a-checks.mjs imports node:test but is neither discovered nor listed',
      ])
      fs.rmSync(path.join(root, 'scripts/lib/a-checks.mjs'))
      write(root, {
        'apps/other-plugin.test.js': "const { test } = require('node:test')\n",
      })
      assert.deepEqual(check(), [
        'apps/other-plugin.test.js imports node:test but is neither discovered nor listed',
      ])
      assert.deepEqual(
        coverageProblems({
          root,
          manifest: {
            ...fixtureManifest,
            runElsewhere: { 'apps/other-plugin.test.js': 'another workflow' },
          },
          workflow: fixtureWorkflow,
        }),
        []
      )
    }))

  describe('background start and collect pairs', () => {
    const paired = (steps, workflow = fixtureWorkflow) =>
      workflow.replace(
        '      - run: |\n          node scripts/ci/node-test-gate.mjs outside\n          node scripts/ci/node-test-gate.mjs default',
        steps.join('\n')
      )
    const setup = ['      - id: setup', '        run: echo setup']
    const runtime = ['      - id: runtime', '        run: echo runtime']
    const start = ({
      id = 'started',
      condition = "${{ !cancelled() && steps.setup.outcome == 'success' }}",
      suites = 'outside default',
    } = {}) => [
      `      - id: ${id}`,
      '        name: start suites',
      `        if: ${condition}`,
      `        run: node scripts/ci/node-test-gate.mjs --start ${suites}`,
    ]
    const collect = ({
      condition = "${{ !cancelled() && steps.started.outcome == 'success' }}",
      extra = [],
      suites = 'outside default',
    } = {}) => [
      '      - name: collect suites',
      `        if: ${condition}`,
      ...extra,
      `        run: node scripts/ci/node-test-gate.mjs --collect ${suites}`,
    ]
    const check = (steps, workflow) =>
      temporary((root) => {
        write(root, fixtureTree)
        return coverageProblems({
          root,
          manifest: fixtureManifest,
          workflow: paired(steps, workflow),
        }).sort()
      })

    test('a start step and a later collect step in the same job gate both suites', () => {
      assert.deepEqual(check([...setup, ...start(), ...runtime, ...collect()]), [])
    })

    test('a started suite that no later step of its job collects fails, and the reverse', () => {
      assert.deepEqual(check([...setup, ...start(), ...runtime]), [
        'suite default is started in the background, but no later step of job first collects it',
        'suite outside is started in the background, but no later step of job first collects it',
      ])
      assert.deepEqual(check([...setup, ...collect(), ...start()]), [
        'suite default is collected, but no earlier step of job first starts it',
        'suite default is started in the background, but no later step of job first collects it',
        'suite outside is collected, but no earlier step of job first starts it',
        'suite outside is started in the background, but no later step of job first collects it',
      ])
      assert.deepEqual(check([...setup, ...start(), ...collect({ suites: 'default' })]), [
        'suite outside is started in the background, but no later step of job first collects it',
      ])
    })

    test('a collect step in another job does not collect the suites', () => {
      const workflow = `${paired([...setup, ...start()])}\n${collect({ condition: '${{ !cancelled() }}' }).join('\n')}`
      assert.deepEqual(
        temporary((root) => {
          write(root, fixtureTree)
          return coverageProblems({ root, manifest: fixtureManifest, workflow }).sort()
        }),
        [
          'suite default is collected, but no earlier step of job second starts it',
          'suite default is started in the background, but no later step of job first collects it',
          'suite outside is collected, but no earlier step of job second starts it',
          'suite outside is started in the background, but no later step of job first collects it',
        ]
      )
    })

    // PR 216 review BA-02: a foreground suite in the same step brought its own needs into
    // the collect condition, and a collect step without a condition inherits success().
    // PR 216 CodeRabbit: bash -e stops at the first failing collect line, so the second
    // suite would never report.
    test('a collect step holds one collect command for all its suites', () => {
      const split = [
        '      - name: collect suites',
        "        if: ${{ !cancelled() && steps.started.outcome == 'success' }}",
        '        run: |',
        '          node scripts/ci/node-test-gate.mjs --collect outside',
        '          node scripts/ci/node-test-gate.mjs --collect default',
      ]
      assert.deepEqual(check([...setup, ...start(), ...runtime, ...split]), [
        'step collect suites has 2 collect commands; collect outside and default in one command so every suite reports before the step fails',
      ])
    })

    test('a collect step runs only collect lines and states !cancelled()', () => {
      const mixed = [
        '      - name: collect suites',
        "        if: ${{ !cancelled() && steps.started.outcome == 'success' }}",
        '        run: |',
        '          node scripts/ci/node-test-gate.mjs --collect outside',
        '          node scripts/ci/node-test-gate.mjs default',
      ]
      const startOutside = start({ suites: 'outside', condition: '${{ !cancelled() }}' })
      assert.deepEqual(check([...setup, ...startOutside, ...runtime, ...mixed]), [
        'step collect suites collects outside but also runs "node scripts/ci/node-test-gate.mjs default"; a collect step runs only collect lines',
      ])
      const unconditioned = [
        '      - name: collect suites',
        '        run: node scripts/ci/node-test-gate.mjs --collect outside default',
      ]
      assert.deepEqual(check([...setup, ...start(), ...runtime, ...unconditioned]), [
        'step collect suites collects outside and default without an explicit !cancelled() condition, so an unrelated failure skips it',
      ])
      assert.deepEqual(
        check([
          ...setup,
          ...start(),
          ...runtime,
          ...collect({ condition: "${{ steps.started.outcome == 'success' }}" }),
        ]),
        [
          'step collect suites collects outside and default without an explicit !cancelled() condition, so an unrelated failure skips it',
        ]
      )
    })

    // PR 216 delta review: the rule reads the parsed condition, so a quoted matrix value
    // that spells the function does not count.
    test('a collect condition that only quotes !cancelled() as a matrix value fails', () => {
      const quoted = [
        '      - name: collect suites',
        "        if: ${{ matrix.platform == '!cancelled()' }}",
        '        run: node scripts/ci/node-test-gate.mjs --collect outside default',
      ]
      assert.ok(
        check([...setup, ...start(), ...runtime, ...quoted]).includes(
          'step collect suites collects outside and default without an explicit !cancelled() condition, so an unrelated failure skips it'
        )
      )
    })

    test('the collect step may wait only on the step that started its suites', () => {
      assert.deepEqual(
        check([
          ...setup,
          ...start(),
          ...runtime,
          ...collect({
            condition:
              "${{ !cancelled() && steps.started.outcome == 'success' && steps.runtime.outcome == 'success' }}",
          }),
        ]),
        [
          'step collect suites waits on steps.runtime; a collect step may wait only on the step that started outside and default',
        ]
      )
      assert.deepEqual(
        check([
          ...setup,
          ...start(),
          ...collect({
            condition:
              "${{ !cancelled() && steps.started.outcome == 'success' && steps.setup.outcome == 'success' }}",
          }),
        ]),
        [
          'step collect suites waits on steps.setup; a collect step may wait only on the step that started outside and default',
        ]
      )
    })

    test("the start step keeps today's rule: it waits only on what its suites need", () => {
      assert.deepEqual(
        check([
          ...setup,
          ...runtime,
          ...start({
            condition:
              "${{ !cancelled() && steps.setup.outcome == 'success' && steps.runtime.outcome == 'success' }}",
          }),
          ...collect(),
        ]),
        [
          'step start suites waits on steps.runtime, which outside and default does not need',
        ]
      )
      assert.deepEqual(
        check([...setup, ...start({ condition: 'always()' }), ...collect()]),
        ['step start suites can be skipped by its condition: "always()"']
      )
    })

    test('the collect step may not be skippable, continue on error or drop a matrix row', () => {
      assert.deepEqual(
        check([...setup, ...start(), ...collect({ condition: 'always()' })]),
        [
          'step collect suites can be skipped by its condition: "always()"',
          'step collect suites collects outside and default without an explicit !cancelled() condition, so an unrelated failure skips it',
        ]
      )
      assert.deepEqual(
        check([
          ...setup,
          ...start(),
          ...collect({ extra: ['        continue-on-error: true'] }),
        ]),
        ['step collect suites sets continue-on-error (true), which hides a gate failure']
      )
      assert.deepEqual(
        check([
          ...setup,
          ...start(),
          ...collect({
            condition:
              "${{ !cancelled() && matrix.platform == 'android' && steps.started.outcome == 'success' }}",
          }),
        ]),
        [
          'step collect suites skips matrix row platform=ios, which outside and default must run on',
        ]
      )
    })

    test('a suite started twice in one job, or an unknown started suite, fails', () => {
      assert.deepEqual(
        check([
          ...setup,
          ...start(),
          ...start({ id: 'again', suites: 'default' }),
          ...collect(),
        ]),
        ['suite default is started more than once in job first']
      )
      assert.deepEqual(
        check([
          ...setup,
          ...start({ suites: 'outside default renamed' }),
          ...collect({ suites: 'outside default renamed' }),
        ]),
        ['workflow runs unknown suite renamed']
      )
    })

    test('start and collect lines parse apart from the foreground form', () => {
      assert.deepEqual(
        backgroundSuites('node scripts/ci/node-test-gate.mjs --start a b'),
        {
          mode: 'start',
          suites: ['a', 'b'],
        }
      )
      assert.deepEqual(
        backgroundSuites('  node scripts/ci/node-test-gate.mjs --collect a  '),
        { mode: 'collect', suites: ['a'] }
      )
      assert.equal(backgroundSuites('node scripts/ci/node-test-gate.mjs --start'), null)
      assert.equal(backgroundSuites('node scripts/ci/node-test-gate.mjs a'), null)
      assert.equal(gatedSuite('node scripts/ci/node-test-gate.mjs --start a'), null)
      // The collect step gates the files; the start step only launches them.
      assert.equal(
        runGatesTestFile(
          'node scripts/ci/node-test-gate.mjs --collect share-card-plugins native-harness',
          'scripts/ci/node-test-gate.test.mjs'
        ),
        true
      )
      assert.equal(
        runGatesTestFile(
          'node scripts/ci/node-test-gate.mjs --start share-card-plugins native-harness',
          'scripts/ci/node-test-gate.test.mjs'
        ),
        false
      )
    })
  })

  test('workflow lines name a suite only for a single-argument gate invocation', () => {
    assert.equal(
      gatedSuite('  node scripts/ci/node-test-gate.mjs native-harness'),
      'native-harness'
    )
    assert.equal(gatedSuite('node --test a.test.mjs'), null)
    assert.equal(gatedSuite('node scripts/ci/node-test-gate.mjs a b'), null)
  })

  test('the repository manifest and share-card workflow run every test file exactly once', () => {
    assert.deepEqual(coverageProblems(), [])
    const manifest = loadManifest()
    const assigned = Object.keys(manifest.suites).flatMap((name) => resolveSuite(name))
    assert.equal(new Set(assigned).size, assigned.length)
    assert.ok(assigned.includes('scripts/ci/node-test-gate.test.mjs'))
  })
})

// browser-acceptance runs the harness suites in the background from install on, so
// they overlap the browser, Supabase and runtime steps, and collects them before the
// bridge and the matrix compete for the CPU.
describe('browser-acceptance background harness suites', () => {
  const job = parse(fs.readFileSync('.github/workflows/pr-share-card-native.yml', 'utf8'))
    .jobs['browser-acceptance']
  const steps = job.steps
  const at = (predicate) => steps.findIndex(predicate)
  const suites = 'share-card-plugins native-harness'
  const start = at(
    (step) => step.run?.trim() === `node scripts/ci/node-test-gate.mjs --start ${suites}`
  )
  const collect = at(
    (step) =>
      step.run?.trim() === `node scripts/ci/node-test-gate.mjs --collect ${suites}`
  )
  const row = { platform: 'android', api: 36, suite: 'browser' }
  const runs = (step, outcomes) =>
    evaluateApprovedCondition(step.if, {
      matrix: job.strategy.matrix,
      row,
      outcomes,
    })

  test('the start step follows install directly and waits only on it', () => {
    assert.equal(start, at((step) => step.uses === './.github/actions/install') + 1)
    assert.equal(
      steps[start].if,
      "${{ !cancelled() && steps.install.outcome == 'success' }}"
    )
    assert.ok(steps[start].id)
  })

  test('the collect step follows the runtime and precedes the bridge and the matrix', () => {
    assert.ok(collect > at((step) => step.id === 'runtime'))
    assert.ok(collect < at((step) => step.run?.includes('bridge-a11y.mjs')))
    assert.ok(collect < at((step) => step.run?.includes('npx playwright test')))
    assert.equal(
      steps[collect].if,
      `\${{ !cancelled() && steps.${steps[start].id}.outcome == 'success' }}`
    )
  })

  test('a failed browser, Supabase or runtime step never skips the collect step', () => {
    const started = { install: 'success', [steps[start].id]: 'success' }
    for (const failed of [
      { browser_deps: 'failure' },
      { supabase: 'failure', runtime: 'skipped' },
      { runtime: 'failure' },
    ])
      assert.equal(runs(steps[collect], { ...started, ...failed }), true)
    assert.equal(runs(steps[collect], { install: 'success' }), false)
  })

  test('no foreground copy of the two suites remains in the job', () => {
    const lines = steps.flatMap((step) => (step.run ?? '').split('\n'))
    assert.deepEqual(
      lines.map(gatedSuite).filter((suite) => suites.split(' ').includes(suite)),
      []
    )
  })
})

// Local mode: a pre-push run of every suite must check each suite's declared setup first.
// Two suites once failed only on a local sweep that skipped it: story68-api-entry needs the
// API build (conditionNeeds runtime) and worklets-staging the Android prebuild.
describe('local mode', () => {
  const manifest = {
    suites: { plain: ['a.test.mjs'], native: ['b.test.mjs'], harness: 'discover' },
    vitest: ['c.test.mjs'],
    conditionNeeds: {
      plain: ['install'],
      native: ['prebuild'],
      harness: [],
      vitest: ['runtime'],
    },
  }
  const rootWith = (files) => {
    const root = scratchRoot('gate-local-')
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      fs.writeFileSync(path.join(root, file), '')
    }
    return root
  }

  test('names every suite whose setup is missing, with the command that provides it', () => {
    const plan = localPlan({
      root: rootWith(['node_modules/.package-lock.json']),
      manifest,
    })
    assert.deepEqual(
      plan.missing.map(({ suite, need }) => `${suite}:${need}`),
      ['native:prebuild', 'vitest:runtime']
    )
    assert.match(
      plan.missing.find(({ need }) => need === 'prebuild').how,
      /run-story68-native\.mjs prebuild --platform android/
    )
    assert.match(
      plan.missing.find(({ need }) => need === 'runtime').how,
      /npm run build --workspace api/
    )
  })

  test('is ready once every probe exists', () => {
    const plan = localPlan({
      root: rootWith([
        'node_modules/.package-lock.json',
        'apps/mobile/android/gradlew',
        'apps/api/dist/src/load-env.js',
      ]),
      manifest,
    })
    assert.deepEqual(plan.missing, [])
    assert.deepEqual(
      plan.suites.map(({ suite, runner }) => `${suite}:${runner}`),
      ['plain:node', 'native:node', 'harness:node', 'vitest:vitest']
    )
  })

  test('refuses a need it has no local probe for', () => {
    assert.throws(
      () =>
        localPlan({
          root: rootWith([]),
          manifest: {
            ...manifest,
            conditionNeeds: { ...manifest.conditionNeeds, plain: ['emulator'] },
          },
        }),
      /node_test_gate_local: suite plain needs emulator, which has no local probe/
    )
  })

  test('the real manifest declares only needs local mode can probe', () => {
    assert.doesNotThrow(() => localPlan({ manifest: loadManifest() }))
  })
})

describe('local mode preflight (PR 212 review)', () => {
  const manifest = {
    suites: { plain: ['a.test.mjs'] },
    vitest: [],
    conditionNeeds: { plain: ['install'], vitest: [] },
  }
  const rootWith = (files) => {
    const root = scratchRoot('gate-preflight-')
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      fs.writeFileSync(path.join(root, file), '')
    }
    return root
  }

  test('names a missing command a suite shells out to, before any suite starts', () => {
    const plan = localPlan({
      root: rootWith(['node_modules/.package-lock.json']),
      manifest,
      hasCommand: (name) => name !== 'jq',
    })
    assert.deepEqual(
      plan.missing.map(({ suite, need }) => `${suite}:${need}`),
      ['native-harness:jq']
    )
    assert.match(plan.missing[0].how, /jq/)
  })

  test('refuses a local run whose workflow no longer gates every suite', () => {
    const problems = localPreflight({
      root: rootWith(['node_modules/.package-lock.json']),
      manifest,
      hasCommand: () => true,
      coverage: () => ['suite plain has no gate step'],
    })
    assert.deepEqual(problems, ['suite plain has no gate step'])
  })

  test('a fresh checkout without node_modules gets the install instruction', () => {
    const root = scratchRoot('gate-fresh-')
    const copy = (file) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      fs.copyFileSync(path.join(repoRoot, file), path.join(root, file))
    }
    for (const file of [
      'scripts/ci/node-test-gate.mjs',
      'scripts/ci/node-test-gate-reporter.mjs',
      'scripts/ci/workflow-step-shadowing.mjs',
      'scripts/ci/node-test-suites.json',
    ])
      copy(file)
    const result = spawnSync(
      process.execPath,
      ['scripts/ci/node-test-gate.mjs', '--local'],
      {
        cwd: root,
        encoding: 'utf8',
      }
    )
    assert.notEqual(result.status, 0)
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/)
    assert.match(result.stderr, /needs install: npm ci/)
  })

  test('applies the CI rule to a vitest JSON report', () => {
    const report = (overrides) => ({
      numTotalTests: 3,
      numPassedTests: 3,
      numPendingTests: 0,
      numFailedTests: 0,
      numTodoTests: 0,
      ...overrides,
    })
    assert.doesNotThrow(() => assertVitestReport(report({})))
    assert.throws(
      () => assertVitestReport(report({ numTotalTests: 1, numPassedTests: 1 })),
      /Incomplete vitest suite execution/
    )
    assert.throws(() => assertVitestReport(report({ numPendingTests: 1 })), /Incomplete/)
  })
})

test('the local vitest rule matches the rule the share-card workflow applies to its report', () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/pr-share-card-native.yml'),
    'utf8'
  )
  const rules = workflow.match(
    /if \(report\.numTotalTests < 2 \|\| report\.numPassedTests !== report\.numTotalTests \|\|\s+report\.numPendingTests !== 0 \|\| report\.numFailedTests !== 0 \|\| report\.numTodoTests !== 0\)/g
  )
  assert.ok(
    rules && rules.length >= 1,
    'the workflow still checks the API entry report with the same rule'
  )
})

// Story 6.15: a suite the gate leaves to another runner must still run in CI. Each runElsewhere
// file is run by some workflow step, by its path or through the apps/mobile npm script that
// runs it, and the watchOS suite only with WATCHOS_REQUIRE_BUILD=1.
test('every suite the gate leaves to another runner runs in some workflow step', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'scripts/ci/node-test-suites.json'), 'utf8')
  )
  const scripts = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'apps/mobile/package.json'), 'utf8')
  ).scripts
  const workflowsDir = path.join(repoRoot, '.github/workflows')
  const steps = fs
    .readdirSync(workflowsDir)
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((file) =>
      Object.values(
        parse(fs.readFileSync(path.join(workflowsDir, file), 'utf8')).jobs ?? {}
      ).flatMap((job) => job.steps ?? [])
    )
  const unscheduled = []
  for (const file of Object.keys(manifest.runElsewhere)) {
    const relative = path.relative('apps/mobile', file)
    const runners = Object.entries(scripts)
      .filter(([name, command]) => name !== 'test' && command.includes(relative))
      .map(([name]) => name)
    const runs = steps.some(
      (step) =>
        String(step.run ?? '').includes(file) ||
        runners.some((name) =>
          new RegExp(`npm run ${name}(?![\\w:-])`).test(step.run ?? '')
        )
    )
    if (!runs) unscheduled.push(file)
  }
  assert.deepEqual(unscheduled, [])
})
