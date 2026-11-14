// A Node script a workflow runs before its job installs dependencies may load only Node's built-in
// modules and repository files (d2178e15, a5aaf9b6: yaml in the coverage merge job). The cases
// below are the Antigravity r11 probes: each false negative and false positive it found.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'

import {
  RUNTIME_PROBES,
  nodeLoads,
  packageImports,
  specifiers,
  stepsWithInstallState,
  workflowProblems,
} from './workflow-node-deps.mjs'

const repo = process.cwd()

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-node-deps-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), body)
  }
  return root
}

const job = (steps, extra = '') =>
  `name: w\non: pull_request\n${extra}jobs:\n  merge:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`
const yamlScript = "import { parse } from 'yaml'\n"
const problems = (root) =>
  workflowProblems(root, path.join(root, '.github/workflows/w.yml')).map(
    ({ file, specifier }) => `${file}:${specifier}`
  )

describe('workflow node scripts before the install', () => {
  test('no workflow loads a package before its job installs', () => {
    const found = fs
      .readdirSync(path.join(repo, '.github/workflows'))
      .filter((name) => /\.ya?ml$/.test(name))
      .flatMap((name) =>
        workflowProblems(repo, path.join(repo, '.github/workflows', name))
      )
      .map((p) => `${p.workflow} ${p.job} "${p.step}": ${p.file} loads ${p.specifier}`)
    assert.deepEqual(found, [])
  })

  test('each runtime probe exists and names why it cannot fail a job', () => {
    for (const [file, reason] of Object.entries(RUNTIME_PROBES)) {
      assert.ok(fs.existsSync(path.join(repo, file)), file)
      assert.ok(reason.length > 20, file)
    }
  })

  test('a package loaded through a relative import is named, with the importing file', (t) => {
    const root = fixture(t, {
      'scripts/a.test.mjs': "import { x } from './lib/b.mjs'\nimport fs from 'node:fs'\n",
      'scripts/lib/b.mjs': `${yamlScript}export const x = 1\n`,
      '.github/workflows/w.yml': job('      - run: node --test scripts/a.test.mjs\n'),
    })
    assert.deepEqual(problems(root), ['scripts/lib/b.mjs:yaml'])
  })
})

describe('what counts as the install', () => {
  const cases = {
    'npm ci': ['      - run: npm ci\n', []],
    'npm install': ['      - run: npm install\n', []],
    'the repo install script': [
      '      - run: bash scripts/ci/install-dependencies.sh\n',
      [],
    ],
    'an install action': ['      - uses: ./.github/actions/install\n', []],
    'a node_modules cache restore, which can miss': [
      '      - uses: actions/cache/restore@v4\n        with:\n          path: node_modules\n          key: k\n',
      ['scripts/a.mjs:yaml'],
    ],
    'a conditional npm ci': [
      "      - if: steps.cache.outputs.cache-hit != 'true'\n        run: npm ci\n",
      ['scripts/a.mjs:yaml'],
    ],
    'a global install': [
      '      - run: npm install --global eas-cli\n',
      ['scripts/a.mjs:yaml'],
    ],
    'a -g install': ['      - run: npm install -g eas-cli\n', ['scripts/a.mjs:yaml']],
    'a workspace install': [
      '      - run: npm ci --workspace api\n',
      ['scripts/a.mjs:yaml'],
    ],
    'npm ci only in a comment on line two': [
      '      - run: |\n          echo skip\n          # npm ci\n',
      ['scripts/a.mjs:yaml'],
    ],
    'setup-node with the npm cache': [
      '      - uses: actions/setup-node@v4\n        with:\n          cache: npm\n',
      ['scripts/a.mjs:yaml'],
    ],
  }
  for (const [name, [before, expected]] of Object.entries(cases))
    test(`${name} before the script: ${expected.length ? 'not installed' : 'installed'}`, (t) => {
      const root = fixture(t, {
        'scripts/a.mjs': yamlScript,
        'scripts/ci/install-dependencies.sh': 'npm ci\n',
        '.github/actions/install/action.yml':
          'runs:\n  using: composite\n  steps:\n    - run: npm ci\n      shell: bash\n',
        '.github/workflows/w.yml': job(`${before}      - run: node scripts/a.mjs\n`),
      })
      assert.deepEqual(problems(root), expected)
    })

  test('a script before the install step is named; a step that never runs is not checked', (t) => {
    const root = fixture(t, {
      'scripts/a.mjs': yamlScript,
      '.github/workflows/w.yml': job(
        '      - run: node scripts/a.mjs\n      - run: npm ci\n      - if: false\n        run: node scripts/a.mjs\n'
      ),
    })
    assert.deepEqual(problems(root), ['scripts/a.mjs:yaml'])
  })

  test('a local composite action runs its steps inline, and an install action installs after it', (t) => {
    const root = fixture(t, {
      'scripts/a.mjs': yamlScript,
      '.github/actions/node-dependencies/action.yml':
        "runs:\n  using: composite\n  steps:\n    - run: node scripts/a.mjs\n      shell: bash\n    - if: steps.x.outputs.y != 'true'\n      run: npm ci\n      shell: bash\n",
    })
    const steps = stepsWithInstallState(root, [
      { uses: './.github/actions/node-dependencies' },
      { run: 'node scripts/a.mjs' },
    ])
    assert.deepEqual(
      steps.map(({ installed }) => installed),
      [false, false, true]
    )
  })
})

describe('the node commands a run block executes', () => {
  const rel = (root, loads) => ({
    scripts: loads.scripts.map((file) => path.relative(root, file)).sort(),
    inline: loads.inline,
  })

  test('node --test files and globs, a node script with flags that take values, cd and defaults', (t) => {
    const root = fixture(t, {
      'scripts/ci/a.test.mjs': '',
      'scripts/ci/b.test.mjs': '',
      'scripts/c.mjs': '',
      'scripts/pre.mjs': '',
      'apps/x/d.mjs': '',
      'scripts/bin': '',
    })
    const loads = (run, cwd) => rel(root, nodeLoads(root, run, cwd))
    assert.deepEqual(loads('node --test scripts/ci/*.test.mjs').scripts, [
      'scripts/ci/a.test.mjs',
      'scripts/ci/b.test.mjs',
    ])
    assert.deepEqual(loads('set -e\nnode scripts/c.mjs --flag value | tee x').scripts, [
      'scripts/c.mjs',
    ])
    assert.deepEqual(
      loads('node --require ./scripts/pre.mjs -C production scripts/c.mjs'),
      {
        scripts: ['scripts/c.mjs', 'scripts/pre.mjs'],
        inline: [],
      }
    )
    assert.deepEqual(loads('node -r dotenv/config scripts/c.mjs'), {
      scripts: ['scripts/c.mjs'],
      inline: ['dotenv/config'],
    })
    assert.deepEqual(loads('cd apps/x && node d.mjs').scripts, ['apps/x/d.mjs'])
    assert.deepEqual(loads('node d.mjs', 'apps/x').scripts, ['apps/x/d.mjs'])
    assert.deepEqual(loads('FOO=1 node scripts/c.mjs').scripts, ['scripts/c.mjs'])
    // An extensionless script is still a script (r12).
    assert.deepEqual(loads('node scripts/bin').scripts, ['scripts/bin'])
  })

  test('node -e code is read for package loads; a variable path and prose are not commands', (t) => {
    const root = fixture(t, { 'scripts/c.mjs': '' })
    assert.deepEqual(nodeLoads(root, 'node -e "require(\'yaml\')"').inline, ['yaml'])
    assert.deepEqual(nodeLoads(root, 'node -e "require(\'node:fs\')"').inline, [])
    // A $ or an escaped backtick in the code belongs to the script, not to the shell (r12).
    assert.deepEqual(
      nodeLoads(
        root,
        'node -e "const a = 1; require(\'yaml\'); console.log(\\`ok \\$a\\`)"'
      ).inline,
      ['yaml']
    )
    assert.deepEqual(nodeLoads(root, 'node "$SCRIPT"').scripts, [])
    assert.deepEqual(nodeLoads(root, '# node scripts/c.mjs').scripts, [])
    assert.deepEqual(
      nodeLoads(root, 'echo "Run node scripts/c.mjs after the install"').scripts,
      []
    )
  })

  test('a heredoc fed to node is read as code, and its lines are no commands (r13)', (t) => {
    const root = fixture(t, { 'scripts/c.mjs': '' })
    const run = [
      "node --input-type=module <<'EOF'",
      "import 'yaml'",
      'node scripts/c.mjs',
      'EOF',
      'cat <<EOF',
      "import 'semver'",
      'EOF',
    ].join('\n')
    assert.deepEqual(nodeLoads(root, run), { scripts: [], inline: ['yaml'] })
  })

  test('<< in a comment or quotes opens no heredoc; any delimiter word closes one (r14)', (t) => {
    const root = fixture(t, { 'scripts/a.mjs': '' })
    const scripts = (run) =>
      nodeLoads(root, run).scripts.map((file) => path.relative(root, file))
    assert.deepEqual(scripts('# note <<EOF\nnode scripts/a.mjs'), ['scripts/a.mjs'])
    assert.deepEqual(scripts('echo "a <<EOF"\nnode scripts/a.mjs'), ['scripts/a.mjs'])
    assert.deepEqual(scripts('cat <<END-OF-MSG\nhello\nEND-OF-MSG\nnode scripts/a.mjs'), [
      'scripts/a.mjs',
    ])
    assert.deepEqual(scripts("cat <<-'X.1'\n\thello\n\tX.1\nnode scripts/a.mjs"), [
      'scripts/a.mjs',
    ])
    assert.deepEqual(scripts('cat <<< "here string"\nnode scripts/a.mjs'), [
      'scripts/a.mjs',
    ])
  })

  test('a relative import in a heredoc fed to node is followed (r14)', (t) => {
    const root = fixture(t, { 'scripts/a.mjs': yamlScript })
    const run = "node --input-type=module <<'EOF'\nimport './scripts/a.mjs'\nEOF"
    const loads = nodeLoads(root, run)
    assert.deepEqual(
      loads.scripts.map((file) => path.relative(root, file)),
      ['scripts/a.mjs']
    )
    assert.deepEqual(loads.inline, [])
  })

  test('npm run, npm test, npm --prefix and repository shell scripts are followed', (t) => {
    const root = fixture(t, {
      'package.json': JSON.stringify({
        scripts: { check: 'node scripts/c.mjs', test: 'bash scripts/t.sh' },
      }),
      'apps/web/package.json': JSON.stringify({
        name: 'web',
        scripts: { lint: 'node lint.mjs' },
      }),
      'apps/web/lint.mjs': '',
      'scripts/c.mjs': '',
      'scripts/t.sh': 'set -e\ncd scripts\nnode c.mjs\n',
    })
    const loads = (run) => rel(root, nodeLoads(root, run)).scripts
    assert.deepEqual(loads('npm run check'), ['scripts/c.mjs'])
    assert.deepEqual(loads('npm test'), ['scripts/c.mjs'])
    assert.deepEqual(loads('npm run lint --workspace web'), ['apps/web/lint.mjs'])
    assert.deepEqual(loads('npm --prefix apps/web run lint'), ['apps/web/lint.mjs'])
    assert.deepEqual(loads('bash scripts/t.sh'), ['scripts/c.mjs'])
  })

  test('a workflow-level working directory default applies', (t) => {
    const root = fixture(t, {
      'apps/x/d.mjs': yamlScript,
      '.github/workflows/w.yml': job(
        '      - run: node d.mjs\n',
        'defaults:\n  run:\n    working-directory: apps/x\n'
      ),
    })
    assert.deepEqual(problems(root), ['apps/x/d.mjs:yaml'])
  })
})

describe('the modules a source file loads', () => {
  test('import, export-from, import(), require, require.resolve and createRequire, in order', () => {
    assert.deepEqual(
      specifiers(
        [
          "import a from 'node:fs'",
          "import b from 'path'",
          "export { c } from './c.mjs'",
          "const d = await import('yaml')",
          "const e = require('@scope/pkg')",
          "import '../side.mjs'",
          'const r = createRequire(import.meta.url)',
          "const f = r('semver')",
          "r.resolve('tar')",
          "createRequire(import.meta.url)('chalk')",
          "require.resolve('debug')",
        ].join('\n')
      ),
      [
        'node:fs',
        'path',
        './c.mjs',
        'yaml',
        '@scope/pkg',
        '../side.mjs',
        'semver',
        'tar',
        'chalk',
        'debug',
      ]
    )
  })

  test('text inside strings, templates, comments and regexes is no load', () => {
    const source = [
      'const a = "require(\'@scope/pkg\')"',
      'const b = `',
      "import 'yaml'",
      '`',
      '/*',
      'import "yaml"',
      '*/',
      "// import x from 'yaml'",
      'const re = /import [\'"]yaml[\'"]/',
      "const c = `${require('node:path').sep}`",
    ].join('\n')
    assert.deepEqual(specifiers(source), ['node:path'])
  })

  test('division, statement regexes, nested calls, reassignment and import.meta.resolve (r12)', () => {
    const loads = (lines) => specifiers(lines.join('\n'))
    assert.deepEqual(
      loads(['let x = 1', "const r = x++ / 2; const y = require('yaml') / 2"]),
      ['yaml']
    )
    assert.deepEqual(loads(["if (x) /a'b/.test(s); const y = require('yaml')"]), ['yaml'])
    assert.deepEqual(loads(['if (x) /`/.test(s)', "import 'yaml'"]), ['yaml'])
    assert.deepEqual(
      loads(["createRequire(fs.realpathSync(path.join('.', 'package.json')))('yaml')"]),
      ['yaml']
    )
    assert.deepEqual(
      loads(['let r', 'r = createRequire(import.meta.url)', "r('yaml')"]),
      ['yaml']
    )
    assert.deepEqual(
      loads(['const r = module.createRequire(import.meta.url)', "r('semver')"]),
      ['semver']
    )
    assert.deepEqual(loads(["import.meta.resolve('yaml')"]), ['yaml'])
    assert.deepEqual(loads(['const u = String.raw`import "yaml"`']), [])
  })

  test('createRequire under an alias, destructured, or read from a namespace (r13)', () => {
    const loads = (lines) => specifiers(lines.join('\n'))
    assert.deepEqual(
      loads([
        "import { createRequire as cr } from 'node:module'",
        "cr(import.meta.url)('yaml')",
      ]),
      ['node:module', 'yaml']
    )
    assert.deepEqual(
      loads([
        'const { createRequire: make } = mod',
        'const r = make(import.meta.url)',
        "r('semver')",
      ]),
      ['semver']
    )
    assert.deepEqual(
      loads(['const make = mod.createRequire', "make(import.meta.url).resolve('tar')"]),
      ['tar']
    )
  })

  test('relative .cjs files and index files are followed to the package they load', (t) => {
    const root = fixture(t, {
      'a.mjs': "import './b'\nimport './dir'\n",
      'b.cjs': "const p = require('@scope/pkg')\n",
      'dir/index.js': yamlScript,
    })
    assert.deepEqual(
      packageImports(path.join(root, 'a.mjs'))
        .map(({ file, specifier }) => `${path.relative(root, file)}:${specifier}`)
        .sort(),
      ['b.cjs:@scope/pkg', 'dir/index.js:yaml']
    )
  })

  test('a runtime probe may load packages itself, but not through a file it imports', (t) => {
    const root = fixture(t, {
      'scripts/probe.mjs':
        "import './helper.mjs'\nconst r = createRequire(import.meta.url)\nr('sharp')\n",
      'scripts/helper.mjs': yamlScript,
    })
    const exempt = { 'scripts/probe.mjs': 'probes sharp in try/catch' }
    assert.deepEqual(
      packageImports(path.join(root, 'scripts/probe.mjs'), { root, exempt }).map(
        ({ specifier }) => specifier
      ),
      ['yaml']
    )
  })
})
