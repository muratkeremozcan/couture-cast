import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { API_REQUESTS_FILE } from './native-api-requests.mjs'
import {
  recordIosCommandTimings,
  recordIosOpenerTapAttempts,
} from './native-ios-maestro-trace.mjs'
import {
  NEVER_PUBLISHED_DIAGNOSTICS,
  PUBLIC_DIAGNOSTIC_FILES,
  closedValueProblem,
  maestroFlowPaths,
  selectPublicDiagnostics,
} from './native-ios-public-diagnostics.mjs'

const directory = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-public-diag-'))
  for (const [name, value] of Object.entries(files))
    fs.writeFileSync(path.join(dir, name), JSON.stringify(value))
  return dir
}

describe('closed values for public iOS diagnostics', () => {
  test('numbers, booleans, null, plain names and nested records are closed', () => {
    assert.equal(
      closedValueProblem({
        flow: 'maestro/story65/signin-verify.yaml',
        ms: [81167, 3.5],
        passed: true,
        next: null,
        phase: { name: 'request_completed', status: 200 },
      }),
      null
    )
  })

  for (const [title, value, reason] of [
    [
      'a device identifier',
      { device: '8F3C6A1E-1B2D-4C5E-9A7B-0123456789AB' },
      'identifier_in_string',
    ],
    ['a local path', { file: '/Users/runner/work/app/data.json' }, 'path_in_string'],
    ['a home relative path', { file: '~/Library/Keys' }, 'path_in_string'],
    ['a temp path inside text', { note: 'wrote /tmp/cc68-metro.log' }, 'path_in_string'],
    [
      'a JWT',
      { token: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl' },
      'secret_shaped_string',
    ],
    ['a key name in text', { text: 'service_role key' }, 'secret_shaped_string'],
    ['a long opaque token', { value: 'a'.repeat(45) }, 'token_shaped_string'],
    ['an email', { who: 'someone@example.org' }, 'email_in_string'],
    ['a long string', { text: 'x '.repeat(120) }, 'string_too_long'],
    ['a control character', { text: 'a\u0000b' }, 'non_printable_string'],
    [
      'a key that is a device id',
      { '8F3C6A1E-1B2D-4C5E-9A7B-0123456789AB': 1 },
      'unsafe_key',
    ],
    ['a key with a path', { '/tmp/x': 1 }, 'unsafe_key'],
    ['a non finite number', { n: Number.POSITIVE_INFINITY }, 'non_finite_number'],
  ])
    test(`${title} is not closed`, () => {
      assert.equal(closedValueProblem(value), reason)
    })

  test('a record nested too deeply or with too many entries is not closed', () => {
    let deep = 1
    for (let n = 0; n < 12; n++) deep = { next: deep }
    assert.equal(closedValueProblem(deep), 'too_deep')
    assert.equal(
      closedValueProblem(Array.from({ length: 20_001 }, () => 1)),
      'too_many_entries'
    )
  })
})

describe('selecting public iOS diagnostics', () => {
  test('closed records are published and others are named with a reason, never copied', () => {
    const dir = directory({
      'native-ios-flow-progress.json': {
        flows: [{ flow: 'maestro/story68/open-outfit.yaml', ms: 10 }],
      },
      'native-ios-log-counts.json': { udid: '8F3C6A1E-1B2D-4C5E-9A7B-0123456789AB' },
      'native-ios-preflight.json': { path: '/Users/runner/x' },
    })
    const { published, omitted } = selectPublicDiagnostics(dir)
    assert.deepEqual([...published.keys()], ['native-ios-flow-progress.json'])
    assert.deepEqual(omitted, [
      { name: 'native-ios-preflight.json', reason: 'path_in_string' },
      { name: 'native-ios-log-counts.json', reason: 'identifier_in_string' },
    ])
    assert.doesNotMatch(JSON.stringify(omitted), /Users|8F3C/)
  })

  test('private and device records are never read, even when they look harmless', () => {
    const dir = directory(
      Object.fromEntries(NEVER_PUBLISHED_DIAGNOSTICS.map((name) => [name, { ok: 1 }]))
    )
    const { published, omitted } = selectPublicDiagnostics(dir)
    assert.equal(published.size, 0)
    assert.deepEqual(omitted, [])
    for (const name of NEVER_PUBLISHED_DIAGNOSTICS)
      assert.equal(PUBLIC_DIAGNOSTIC_FILES.includes(name), false, name)
  })

  test('an unreadable record is omitted as not json', () => {
    const dir = directory({})
    fs.writeFileSync(path.join(dir, 'native-ios-crashes.json'), '{nope')
    assert.deepEqual(selectPublicDiagnostics(dir).omitted, [
      { name: 'native-ios-crashes.json', reason: 'not_json' },
    ])
  })
})

describe('closed flow identifiers in the timing and progress records', () => {
  // Codex review 7: iOS shard 1 records maestro/story68/community-draft-background-ios.yaml, whose
  // path runs 46 token characters before `.yaml`. The generic token rule dropped the whole timing
  // receipt, the opener tap attempts of every passing flow with it.
  const longFlow = 'maestro/story68/community-draft-background-ios.yaml'
  const receiptDirectory = (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-public-diag-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    return dir
  }
  const tap = (time) =>
    `${time} [ INFO] maestro.cli.runner.MaestroCommandRunner.runCommands$lambda$1: Tap on id: outfit-share-card-open RUNNING`
  const quiet = () => undefined

  test('a receipt the real writers produce, long flow paths included, is published whole', (t) => {
    const dir = receiptDirectory(t)
    for (const flow of [
      'maestro/story68/preparing-cancel.yaml',
      longFlow,
      'maestro/story68/open-outfit.yaml',
    ])
      recordIosCommandTimings({
        platform: 'ios',
        flow,
        output: dir,
        directory: dir,
        log: quiet,
      })
    recordIosOpenerTapAttempts({
      platform: 'ios',
      flow: 'maestro/story68/open-outfit.yaml',
      outcome: 'passed',
      progressLog: [tap('10:00:01.000'), tap('10:00:11.000')].join('\n'),
      directory: dir,
      log: quiet,
    })
    recordIosOpenerTapAttempts({
      platform: 'ios',
      flow: longFlow,
      outcome: 'failed',
      progressLog: tap('10:00:01.000'),
      directory: dir,
      log: quiet,
    })
    fs.writeFileSync(
      path.join(dir, 'native-ios-flow-progress.json'),
      JSON.stringify({
        version: 1,
        failedFlows: [{ flow: longFlow, hierarchySource: 'failed-step' }],
      })
    )
    const { published, omitted } = selectPublicDiagnostics(dir)
    assert.deepEqual(omitted, [])
    const receipt = published.get('native-ios-flow-command-timings.json')
    assert.deepEqual(
      receipt.flows.map(({ flow }) => flow),
      [
        'maestro/story68/preparing-cancel.yaml',
        longFlow,
        'maestro/story68/open-outfit.yaml',
      ]
    )
    assert.deepEqual(receipt.openerTapAttempts, [
      { flow: 'maestro/story68/open-outfit.yaml', outcome: 'passed', attempts: 2 },
      { flow: longFlow, outcome: 'failed', attempts: 1 },
    ])
    assert.equal(
      published.get('native-ios-flow-progress.json').failedFlows[0].flow,
      longFlow
    )
  })

  test('a flow the repository does not hold is omitted, and other strings keep the generic rules', (t) => {
    const dir = receiptDirectory(t)
    const write = (name, value) =>
      fs.writeFileSync(path.join(dir, name), JSON.stringify(value))
    write('native-ios-flow-command-timings.json', {
      version: 1,
      flows: [{ flow: 'maestro/story68/quietlowercasecanary.yaml', commands: [] }],
    })
    write('native-ios-flow-progress.json', {
      version: 1,
      failedFlows: [{ flow: 'maestro/story68/open-outfit.yaml', note: 'b'.repeat(45) }],
    })
    const { published, omitted } = selectPublicDiagnostics(dir)
    assert.equal(published.size, 0)
    assert.deepEqual(omitted, [
      { name: 'native-ios-flow-command-timings.json', reason: 'flow_not_in_repository' },
      { name: 'native-ios-flow-progress.json', reason: 'token_shaped_string' },
    ])
    assert.doesNotMatch(JSON.stringify(omitted), /canary/)
  })

  test('a flow field is closed only in the records that name flows', () => {
    // Outside those records a long flow path still meets the generic token rule.
    assert.equal(closedValueProblem({ flow: longFlow }), 'token_shaped_string')
    assert.ok(maestroFlowPaths().has(longFlow))
  })
})

describe('budgets during the closed-field walk', () => {
  // Codex review 7: the API record's route walk ran before the depth and entry limits, so a deep
  // malformed record could throw and abort the whole selection.
  test('a deeply nested API record is omitted alone, and the other records still publish', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-public-diag-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    const deep = `${'{"next":'.repeat(50_000)}{"route":"unknown"}${'}'.repeat(50_000)}`
    fs.writeFileSync(path.join(dir, API_REQUESTS_FILE), deep)
    fs.writeFileSync(
      path.join(dir, 'native-ios-preflight.json'),
      JSON.stringify({ ok: true })
    )
    const { published, omitted } = selectPublicDiagnostics(dir)
    assert.deepEqual([...published.keys()], ['native-ios-preflight.json'])
    assert.deepEqual(omitted, [{ name: API_REQUESTS_FILE, reason: 'too_deep' }])
  })

  test('closed fields count against the entry budget', () => {
    const routes = Array.from({ length: 20_001 }, () => ({ route: 'unknown' }))
    const fields = {
      route: { values: () => new Set(['unknown']), reason: 'route_not_in_contract' },
    }
    assert.equal(
      closedValueProblem(routes, 0, { entries: 0 }, fields),
      'too_many_entries'
    )
  })
})
