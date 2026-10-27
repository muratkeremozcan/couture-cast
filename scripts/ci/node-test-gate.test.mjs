import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import {
  assertNodeTestGate,
  gatedTestFiles,
  parseGateArgs,
  runNodeTestGate,
  summarizeNodeTestEvents,
} from './node-test-gate.mjs'

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

function withFixtures(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'node-test-gate-fixture-'))
  try {
    for (const [name, source] of Object.entries(sources))
      fs.writeFileSync(path.join(directory, name), source)
    return run(directory)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

const gate = (directory, files, minPass) =>
  runNodeTestGate({ cwd: directory, files, minPass, stdio: 'ignore' })

describe('node-test-gate run', () => {
  test('passes when every file registers tests and the pass count meets the minimum', () =>
    withFixtures((directory) => {
      assert.deepEqual(gate(directory, ['passing.test.mjs', 'grouped.test.mjs'], 3), {
        passed: 3,
        failed: 0,
        skipped: 0,
        todo: 0,
        filesWithoutTests: [],
      })
    }))

  test('a pass count below the minimum fails', () =>
    withFixtures((directory) => {
      assert.throws(
        () => gate(directory, ['passing.test.mjs'], 3),
        /node_test_gate_failed: 2 passed, expected at least 3$/
      )
    }))

  test('a listed file that registers zero tests fails even when the count is met', () =>
    withFixtures((directory) => {
      assert.throws(
        () => gate(directory, ['passing.test.mjs', 'empty.test.mjs'], 2),
        /node_test_gate_failed: empty\.test\.mjs registered no test$/
      )
    }))

  test('a skipped test fails although node --test exits 0', () =>
    withFixtures((directory) => {
      assert.throws(
        () => gate(directory, ['skipped.test.mjs'], 1),
        /node_test_gate_failed: 1 skipped$/
      )
    }))

  test('a skipped suite fails', () =>
    withFixtures((directory) => {
      assert.throws(
        () => gate(directory, ['skipped-suite.test.mjs'], 1),
        /node_test_gate_failed: .*skipped/
      )
    }))

  test('a todo test fails although node --test exits 0', () =>
    withFixtures((directory) => {
      assert.throws(
        () => gate(directory, ['todo.test.mjs'], 1),
        /node_test_gate_failed: 1 todo$/
      )
    }))

  test('a failing test fails with the runner status and the failure count', () =>
    withFixtures((directory) => {
      assert.throws(
        () => gate(directory, ['failing.test.mjs'], 1),
        /node_test_gate_failed: node --test exited 1; 1 failed$/
      )
    }))

  test('a file that throws while loading fails and registers no test', () =>
    withFixtures((directory) => {
      assert.throws(
        () => gate(directory, ['passing.test.mjs', 'crashing.test.mjs'], 2),
        /node --test exited 1; 1 failed; crashing\.test\.mjs registered no test$/
      )
    }))
})

describe('node-test-gate arguments', () => {
  test('requires a positive minimum and at least one distinct file', () => {
    assert.deepEqual(parseGateArgs(['--min-pass', '4', 'a.test.mjs', 'b.test.mjs']), {
      minPass: 4,
      files: ['a.test.mjs', 'b.test.mjs'],
    })
    for (const [argv, code] of [
      [['a.test.mjs'], /node_test_gate_min_pass_required/],
      [['--min-pass', '0', 'a.test.mjs'], /node_test_gate_min_pass_required/],
      [['--min-pass', 'many', 'a.test.mjs'], /node_test_gate_min_pass_required/],
      [['--min-pass', '1'], /node_test_gate_files_required/],
      [['--min-pass', '1', 'a.test.mjs', 'a.test.mjs'], /node_test_gate_duplicate_file/],
      [['--min-pass', '1', '--watch', 'a.test.mjs'], /node_test_gate_unknown_option/],
    ])
      assert.throws(() => parseGateArgs(argv), code)
  })

  test('workflow lines expose their gated files only for a valid gate invocation', () => {
    assert.deepEqual(
      gatedTestFiles(
        '  node scripts/ci/node-test-gate.mjs --min-pass 2 a.test.mjs b.test.mjs'
      ),
      ['a.test.mjs', 'b.test.mjs']
    )
    assert.equal(gatedTestFiles('node --test a.test.mjs'), null)
    assert.equal(gatedTestFiles('node scripts/ci/node-test-gate.mjs a.test.mjs'), null)
  })
})

describe('node-test-gate summary', () => {
  const event = (overrides) => ({
    outcome: 'pass',
    kind: 'test',
    name: 'case',
    file: '/repo/a.test.mjs',
    entryFile: '/repo/a.test.mjs',
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
          event({ file: '/repo/b.test.mjs', entryFile: null }),
        ],
        ['a.test.mjs', 'b.test.mjs'],
        '/repo'
      ),
      { passed: 1, failed: 0, skipped: 0, todo: 0, filesWithoutTests: ['b.test.mjs'] }
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
      filesWithoutTests: [],
    })
    assert.throws(
      () => assertNodeTestGate(summary, { minPass: 1, status: 0 }),
      /node_test_gate_failed: 1 todo; 0 passed, expected at least 1$/
    )
  })
})
