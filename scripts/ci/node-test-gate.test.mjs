import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { matrixRows } from './workflow-step-shadowing.mjs'
import nodeTestGateReporter from './node-test-gate-reporter.mjs'
import {
  assertNodeTestGate,
  coverageProblems,
  discoverTestFiles,
  gatedSuite,
  loadManifest,
  resolveSuite,
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

function temporary(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'node-test-gate-fixture-'))
  try {
    return run(directory)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
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
