// The input map every Vercel build decision shares (scripts/vercel-build-inputs.mjs): which files
// each project builds from, the ignored build step that skips a production build of main whose
// inputs are unchanged, and the commits production E2E accepts from a project that skipped.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import {
  BUILD_SCRIPTS,
  buildDecision,
  equivalentCommits,
  inputsHashAt,
  isBuildInput,
  OUTSIDE_BUILDS,
  scriptInputs,
} from './vercel-build-inputs.mjs'
import { inputsHash } from './vercel-preview-inputs.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODULE = 'scripts/vercel-build-inputs.mjs'

/** The files a fixture repository starts with: two apps, shared code and scripts. */
const BASE_FILES = {
  'apps/web/src/page.tsx': 'web',
  'apps/web/vercel.json': '{}',
  'apps/api/src/main.ts': 'api',
  'apps/mobile/app/index.tsx': 'mobile',
  'packages/utils/src/index.ts': 'utils',
  'package.json': '{}',
  'package-lock.json': '{}',
  'supabase/config.toml': '[db]',
  'docs/guide.md': 'guide',
  'playwright/tests/flow.spec.ts': 'flow',
  'scripts/check-node-version.mjs': "import fs from 'node:fs'\n",
  'scripts/build-workspace-package.mjs': "import { spawn } from 'node:child_process'\n",
  'scripts/prisma-migrate-deploy.mjs':
    "import { connection } from './lib/connection.mjs'\nimport { local } from './local-db.mjs'\n",
  'scripts/lib/connection.mjs':
    "const ports = require('./ports.cjs')\nexport const connection = ports\n",
  'scripts/lib/ports.cjs': 'module.exports = 54322\n',
  'scripts/local-db.mjs': 'export const local = true\n',
  'scripts/ci/lanes.mjs': 'export const LANES = {}\n',
  'scripts/lib/report.mjs': 'export const report = 1\n',
  'scripts/run-e2e.mjs': 'export const run = 1\n',
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env })
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

const git = (cwd, ...args) => run('git', args, cwd)

function write(cwd, file, content) {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
  fs.writeFileSync(path.join(cwd, file), content)
}

/** Commits `files` (path to content, or null to delete) and returns the new commit. */
function commit(cwd, files, message = 'change') {
  for (const [file, content] of Object.entries(files)) {
    if (content === null) git(cwd, 'rm', '-q', '--', file)
    else {
      write(cwd, file, content)
      git(cwd, 'add', '--', file)
    }
  }
  git(cwd, 'commit', '-q', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

let template
let scratch
let fixture

function newRepository(dir) {
  fs.mkdirSync(dir)
  git(dir, 'init', '-q', '-b', 'main')
  for (const [key, value] of [
    ['user.email', 'fixture@example.com'],
    ['user.name', 'Fixture'],
    ['commit.gpgsign', 'false'],
    ['core.hooksPath', '/dev/null'],
    // No detached auto-maintenance writing into a fixture while the test removes it.
    ['gc.auto', '0'],
    ['maintenance.auto', 'false'],
  ])
    git(dir, 'config', key, value)
  return dir
}

// One base repository, copied for each test: creating it costs more than every check after it.
before(() => {
  template = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-build-inputs-template-'))
  commit(newRepository(path.join(template, 'repo')), BASE_FILES, 'base')
})

after(() => {
  fs.rmSync(template, { recursive: true, force: true, maxRetries: 5 })
})

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-build-inputs-test-'))
  fixture = path.join(scratch, 'repo')
  fs.cpSync(path.join(template, 'repo'), fixture, { recursive: true })
})

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5 })
})

const readFixture = (file) => {
  const full = path.join(fixture, file)
  return fs.existsSync(full) && fs.statSync(full).isFile()
    ? fs.readFileSync(full, 'utf8')
    : null
}

describe('the input map', () => {
  test('keeps the same paths outside every build as before scripts were split', () => {
    assert.deepEqual(OUTSIDE_BUILDS, [
      'apps/mobile',
      'docs',
      '_bmad-output',
      '.github',
      'playwright',
      'maestro',
      'k6',
      'pact',
    ])
    assert.deepEqual(BUILD_SCRIPTS, {
      web: ['scripts/check-node-version.mjs', 'scripts/build-workspace-package.mjs'],
      api: [
        'scripts/check-node-version.mjs',
        'scripts/build-workspace-package.mjs',
        'scripts/prisma-migrate-deploy.mjs',
      ],
    })
  })

  const cases = [
    ['apps/web/src/page.tsx', { web: true, api: false }],
    ['apps/web/vercel.json', { web: true, api: false }],
    ['apps/api/src/main.ts', { web: false, api: true }],
    ['apps/api/vercel.json', { web: false, api: true }],
    ['packages/utils/src/index.ts', { web: true, api: true }],
    ['package-lock.json', { web: true, api: true }],
    ['supabase/config.toml', { web: true, api: true }],
    ['new-runtime/input.json', { web: true, api: true }],
    // A sibling whose name only starts like an excluded directory stays an input.
    ['apps/web-next/page.tsx', { web: true, api: true }],
    ['scriptsx/tool.mjs', { web: true, api: true }],
    ['scripts/check-node-version.mjs', { web: true, api: true }],
    ['scripts/build-workspace-package.mjs', { web: true, api: true }],
    ['scripts/prisma-migrate-deploy.mjs', { web: false, api: true }],
    ['scripts/lib/connection.mjs', { web: false, api: true }],
    ['scripts/lib/ports.cjs', { web: false, api: true }],
    ['scripts/local-db.mjs', { web: false, api: true }],
    ['scripts/ci/lanes.mjs', { web: false, api: false }],
    ['scripts/lib/report.mjs', { web: false, api: false }],
    ['scripts/run-e2e.mjs', { web: false, api: false }],
    ['scripts/new-tool.mjs', { web: false, api: false }],
    ['apps/mobile/app/index.tsx', { web: false, api: false }],
    ['docs/guide.md', { web: false, api: false }],
    ['_bmad-output/notes.md', { web: false, api: false }],
    ['.github/workflows/pr-checks.yml', { web: false, api: false }],
    ['playwright/tests/flow.spec.ts', { web: false, api: false }],
    ['maestro/flow.yaml', { web: false, api: false }],
    ['k6/load.js', { web: false, api: false }],
    ['pact/contract.json', { web: false, api: false }],
  ]
  for (const [file, expected] of cases)
    test(`${file} is an input of ${JSON.stringify(expected)}`, () => {
      const actual = {}
      for (const project of /** @type {const} */ (['web', 'api']))
        actual[project] = isBuildInput(
          project,
          file,
          scriptInputs(BUILD_SCRIPTS[project], readFixture)
        )
      assert.deepEqual(actual, expected)
    })

  test('a script is an input when a build script reaches it by any relative reference', () => {
    const files = {
      'scripts/entry.mjs': [
        "import a from './a.mjs'",
        "import {\n  b,\n  c,\n} from './lib/b.mjs'",
        "export { d } from './d.mjs'",
        "await import('./e.mjs')",
        "const f = require('./f.cjs')",
        "import './side-effect.mjs'",
        "spawn('node', ['./spawned.mjs'])",
        "import outside from '../packages/utils/index.mjs'",
        "import fs from 'node:fs'",
        "import dotenv from 'dotenv'",
      ].join('\n'),
      'scripts/lib/b.mjs':
        "import { e } from '../e.mjs'\nimport { cycle } from '../entry.mjs'",
    }
    const found = scriptInputs(['scripts/entry.mjs'], (file) => files[file] ?? null)
    assert.deepEqual([...found].sort(), [
      'scripts/a.mjs',
      'scripts/d.mjs',
      'scripts/e.mjs',
      'scripts/entry.mjs',
      'scripts/f.cjs',
      'scripts/lib/b.mjs',
      'scripts/side-effect.mjs',
      'scripts/spawned.mjs',
    ])
  })

  test('this repository builds from these scripts', () => {
    const read = (file) => {
      const full = path.join(repoRoot, file)
      return fs.existsSync(full) && fs.statSync(full).isFile()
        ? fs.readFileSync(full, 'utf8')
        : null
    }
    const existing = (project) =>
      [...scriptInputs(BUILD_SCRIPTS[project], read)]
        .filter((file) => read(file) !== null)
        .sort()
    assert.deepEqual(existing('web'), [
      'scripts/build-workspace-package.mjs',
      'scripts/check-node-version.mjs',
    ])
    assert.deepEqual(existing('api'), [
      'scripts/build-workspace-package.mjs',
      'scripts/check-node-version.mjs',
      'scripts/lib/caller-owned-env.mjs',
      'scripts/lib/database-tls.mjs',
      'scripts/lib/local-supabase-ports.cjs',
      'scripts/lib/local-supabase-ports.mjs',
      'scripts/lib/prisma-migrate-connection.mjs',
      'scripts/local-e2e-database.mjs',
      'scripts/prisma-migrate-deploy.mjs',
    ])
  })

  test('the API build command runs the migration script BUILD_SCRIPTS names', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'apps/api/package.json'), 'utf8')
    )
    assert.equal(
      manifest.scripts['vercel:build'],
      'cd ../.. && npx prisma@6.19.0 generate --schema packages/db/prisma/schema.prisma && node scripts/prisma-migrate-deploy.mjs && npm run build --workspace api'
    )
    const root = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    assert.equal(root.scripts.preinstall, 'node scripts/check-node-version.mjs')
    for (const workspace of ['api-client', 'config', 'testing', 'utils']) {
      const pkg = JSON.parse(
        fs.readFileSync(
          path.join(repoRoot, 'packages', workspace, 'package.json'),
          'utf8'
        )
      )
      assert.match(
        pkg.scripts.build,
        /^node \.\.\/\.\.\/scripts\/build-workspace-package\.mjs/
      )
    }
  })
})

describe('inputsHashAt', () => {
  const changes = [
    ['apps/web/src/page.tsx', { web: true, api: false }],
    ['apps/api/src/main.ts', { web: false, api: true }],
    ['packages/utils/src/index.ts', { web: true, api: true }],
    ['scripts/lib/connection.mjs', { web: false, api: true }],
    ['scripts/build-workspace-package.mjs', { web: true, api: true }],
    ['scripts/ci/lanes.mjs', { web: false, api: false }],
    ['scripts/lib/report.mjs', { web: false, api: false }],
    ['docs/guide.md', { web: false, api: false }],
    ['apps/mobile/app/index.tsx', { web: false, api: false }],
  ]
  for (const [file, expected] of changes)
    test(`a commit changing ${file} changes the inputs of ${JSON.stringify(expected)}`, () => {
      const before = {
        web: inputsHashAt(fixture, 'web'),
        api: inputsHashAt(fixture, 'api'),
      }
      commit(fixture, { [file]: 'changed' })
      assert.deepEqual(
        {
          web: inputsHashAt(fixture, 'web') !== before.web,
          api: inputsHashAt(fixture, 'api') !== before.api,
        },
        expected
      )
    })

  test('a script a build script starts importing becomes an input at that commit', () => {
    const before = inputsHashAt(fixture, 'web')
    commit(fixture, {
      'scripts/build-workspace-package.mjs':
        "import { report } from './lib/report.mjs'\n",
    })
    const imported = inputsHashAt(fixture, 'web')
    assert.notEqual(imported, before)
    commit(fixture, { 'scripts/lib/report.mjs': 'export const report = 2\n' })
    assert.notEqual(inputsHashAt(fixture, 'web'), imported)
  })

  test('identifies inputs by content, so the same source on other history hashes alike', () => {
    const base = git(fixture, 'rev-parse', 'HEAD')
    commit(fixture, { 'apps/api/src/main.ts': 'same change' })
    const original = inputsHashAt(fixture, 'api')
    git(fixture, 'checkout', '-q', '-b', 'rewritten', base)
    commit(fixture, { 'docs/guide.md': 'a note' })
    commit(fixture, { 'apps/api/src/main.ts': 'same change' })
    assert.equal(inputsHashAt(fixture, 'api'), original)
  })

  test('fails for a commit the repository does not hold', () => {
    assert.throws(
      () => inputsHashAt(fixture, 'web', 'f'.repeat(40)),
      /^Error: git ls-tree f{40} failed \(exit 128: fatal: /
    )
  })
})

describe('the ignored build step', () => {
  const production = (previous, extra = {}) => ({
    VERCEL_ENV: 'production',
    VERCEL_GIT_PREVIOUS_SHA: previous,
    ...extra,
  })

  test('always builds a preview or a deployment Vercel does not name', () => {
    const previous = git(fixture, 'rev-parse', 'HEAD')
    commit(fixture, { 'docs/guide.md': 'docs only' })
    for (const env of ['preview', 'development', undefined])
      assert.deepEqual(
        buildDecision(
          'web',
          { VERCEL_ENV: env, VERCEL_GIT_PREVIOUS_SHA: previous },
          fixture
        ),
        {
          build: true,
          reason: `VERCEL_ENV is ${JSON.stringify(env ?? '')}; only a production build is ever skipped`,
        }
      )
  })

  test('builds when there is no previous successful production deployment', () => {
    for (const previous of [undefined, '', '  '])
      assert.deepEqual(buildDecision('web', production(previous), fixture), {
        build: true,
        reason:
          'no previous successful production deployment (VERCEL_GIT_PREVIOUS_SHA is empty)',
      })
  })

  test('builds when the previous commit is not a full SHA', () => {
    assert.deepEqual(buildDecision('api', production('07647a18'), fixture), {
      build: true,
      reason: 'VERCEL_GIT_PREVIOUS_SHA "07647a18" is not a commit SHA',
    })
  })

  test('builds an unknown project', () => {
    assert.deepEqual(buildDecision('mobile', production('a'.repeat(40)), fixture), {
      build: true,
      reason: 'unknown project "mobile"',
    })
  })

  test('skips a production build whose inputs equal the last deployed ones', () => {
    const previous = git(fixture, 'rev-parse', 'HEAD')
    commit(fixture, {
      'docs/guide.md': 'docs',
      'scripts/ci/lanes.mjs': 'ci',
      'scripts/run-e2e.mjs': 'runner',
      'apps/mobile/app/index.tsx': 'mobile',
      'playwright/tests/flow.spec.ts': 'test',
    })
    for (const project of ['web', 'api'])
      assert.deepEqual(buildDecision(project, production(previous), fixture), {
        build: false,
        reason: `${project} inputs at HEAD equal those of ${previous}, the last successful production deployment`,
      })
  })

  test('builds only the project whose inputs changed, and names the change', () => {
    const previous = git(fixture, 'rev-parse', 'HEAD')
    commit(fixture, {
      'scripts/lib/connection.mjs':
        "const ports = require('./ports.cjs')\nexport const connection = ports + 1\n",
    })
    const head = commit(fixture, { 'docs/guide.md': 'more docs' })
    const env = production(previous, { VERCEL_GIT_COMMIT_SHA: head })
    assert.deepEqual(buildDecision('api', env, fixture), {
      build: true,
      reason: `api inputs changed since ${previous}: scripts/lib/connection.mjs`,
    })
    assert.deepEqual(buildDecision('web', env, fixture), {
      build: false,
      reason: `web inputs at ${head} equal those of ${previous}, the last successful production deployment`,
    })
  })

  test('compares against the last successful deployment, so skipped commits still count', () => {
    const previous = git(fixture, 'rev-parse', 'HEAD')
    commit(fixture, { 'apps/web/src/page.tsx': 'built, then its deployment failed' })
    commit(fixture, { 'docs/guide.md': 'docs only' })
    assert.deepEqual(buildDecision('web', production(previous), fixture), {
      build: true,
      reason: `web inputs changed since ${previous}: apps/web/src/page.tsx`,
    })
  })

  test('builds when the commit under test cannot be read', () => {
    const previous = git(fixture, 'rev-parse', 'HEAD')
    const decision = buildDecision(
      'web',
      production(previous, { VERCEL_GIT_COMMIT_SHA: 'f'.repeat(40) }),
      fixture
    )
    assert.equal(decision.build, true)
    assert.match(
      decision.reason,
      /^could not compare inputs \(git ls-tree f{40} failed \(exit 128: fatal: /
    )
  })

  describe('in a clone holding only the commit it builds, as Vercel clones', () => {
    let origin
    let clone
    let previous

    beforeEach(() => {
      origin = fixture
      previous = git(origin, 'rev-parse', 'HEAD')
      commit(origin, { 'docs/guide.md': 'docs only' })
      clone = path.join(scratch, 'clone')
      git(scratch, 'clone', '-q', '--depth=1', `file://${origin}`, clone)
      // Vercel's clone has no remote; the step fetches from the repository Vercel names.
      git(clone, 'remote', 'remove', 'origin')
      git(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
      git(
        clone,
        'config',
        `url.file://${origin}.insteadOf`,
        'https://github.com/owner/repo.git'
      )
      // A repository that is gone, without leaving the machine.
      git(
        clone,
        'config',
        `url.file://${path.join(scratch, 'gone')}.insteadOf`,
        'https://github.com/owner/gone.git'
      )
      assert.equal(
        spawnSync('git', ['cat-file', '-e', `${previous}^{commit}`], { cwd: clone })
          .status,
        128
      )
    })

    test('fetches the previous commit from the public repository and decides', () => {
      assert.deepEqual(
        buildDecision(
          'web',
          production(previous, {
            VERCEL_GIT_REPO_OWNER: 'owner',
            VERCEL_GIT_REPO_SLUG: 'repo',
          }),
          clone
        ),
        {
          build: false,
          reason: `web inputs at HEAD equal those of ${previous}, the last successful production deployment`,
        }
      )
    })

    test('builds when the repository is not named', () => {
      assert.deepEqual(buildDecision('web', production(previous), clone), {
        build: true,
        reason: `could not fetch ${previous} (exit 1: fatal: VERCEL_GIT_REPO_OWNER or VERCEL_GIT_REPO_SLUG is empty)`,
      })
    })

    test('builds when the fetch fails', () => {
      const decision = buildDecision(
        'web',
        production(previous, {
          VERCEL_GIT_REPO_OWNER: 'owner',
          VERCEL_GIT_REPO_SLUG: 'gone',
        }),
        clone
      )
      assert.equal(decision.build, true)
      assert.match(
        decision.reason,
        new RegExp(`^could not fetch ${previous} \\(exit 128: `)
      )
    })
  })

  describe('as Vercel runs it, from the project root directory', () => {
    beforeEach(() => {
      write(fixture, MODULE, fs.readFileSync(path.join(repoRoot, MODULE), 'utf8'))
      git(fixture, 'add', '--', MODULE)
    })

    const ignore = (project, env) =>
      spawnSync(process.execPath, [`../../${MODULE}`, 'ignore', project], {
        cwd: path.join(fixture, 'apps', project),
        encoding: 'utf8',
        env: { PATH: process.env.PATH, ...env },
      })

    test('exits 0 to skip and 1 to build, and says why', () => {
      const previous = commit(fixture, {}, 'add the step')
      commit(fixture, { 'apps/api/src/main.ts': 'api change' })
      const env = production(previous)
      const web = ignore('web', env)
      assert.equal(web.status, 0)
      assert.equal(
        web.stdout,
        `Skipping the build: web inputs at HEAD equal those of ${previous}, the last successful production deployment\n`
      )
      const api = ignore('api', env)
      assert.equal(api.status, 1)
      assert.equal(
        api.stdout,
        `Building: api inputs changed since ${previous}: apps/api/src/main.ts\n`
      )
    })

    test('a preview builds and reports what a production build would decide', () => {
      const previous = commit(fixture, {}, 'add the step')
      commit(fixture, { 'docs/guide.md': 'docs only' })
      const result = ignore('web', {
        VERCEL_ENV: 'preview',
        VERCEL_GIT_PREVIOUS_SHA: previous,
      })
      assert.equal(result.status, 1)
      assert.equal(
        result.stdout,
        'Building: VERCEL_ENV is "preview"; only a production build is ever skipped\n' +
          `As a production build it would skip: web inputs at HEAD equal those of ${previous}, the last successful production deployment\n`
      )
    })

    test('exits 1 to build when Vercel passes no previous deployment', () => {
      commit(fixture, {}, 'add the step')
      const result = ignore('web', { VERCEL_ENV: 'production' })
      assert.equal(result.status, 1)
      assert.equal(
        result.stdout,
        'Building: no previous successful production deployment (VERCEL_GIT_PREVIOUS_SHA is empty)\n'
      )
    })
  })

  test('each vercel.json runs the step for its own project from its root directory', () => {
    for (const project of ['web', 'api']) {
      const config = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'apps', project, 'vercel.json'), 'utf8')
      )
      assert.equal(config.ignoreCommand, `node ../../${MODULE} ignore ${project}`)
      assert.deepEqual(config.git.deploymentEnabled, { main: true, '**': false })
      assert.equal(
        path.resolve(repoRoot, 'apps', project, `../../${MODULE}`),
        path.join(repoRoot, MODULE)
      )
    }
  })
})

describe('equivalentCommits', () => {
  test('lists the first-parent commits that build the same source, newest first', () => {
    const base = git(fixture, 'rev-parse', 'HEAD')
    const web = commit(fixture, { 'apps/web/src/page.tsx': 'web change' })
    const docs = commit(fixture, { 'docs/guide.md': 'docs' })
    const ci = commit(fixture, { 'scripts/ci/lanes.mjs': 'ci' })
    const api = commit(fixture, { 'apps/api/src/main.ts': 'api change' })
    assert.deepEqual(equivalentCommits(fixture, 'web', api), [api, ci, docs, web])
    assert.deepEqual(equivalentCommits(fixture, 'api', api), [api])
    assert.deepEqual(equivalentCommits(fixture, 'api', ci), [ci, docs, web, base])
    assert.deepEqual(equivalentCommits(fixture, 'web', api, 2), [api, ci])
  })

  test('includes an earlier commit whose source a revert restored', () => {
    const base = git(fixture, 'rev-parse', 'HEAD')
    const change = commit(fixture, { 'apps/web/src/page.tsx': 'web change' })
    const revert = commit(fixture, {
      'apps/web/src/page.tsx': BASE_FILES['apps/web/src/page.tsx'],
    })
    assert.deepEqual(equivalentCommits(fixture, 'web', revert), [revert, base])
    assert.ok(!equivalentCommits(fixture, 'web', revert).includes(change))
  })

  test('the CLI writes the list for its project to GITHUB_OUTPUT', () => {
    write(fixture, MODULE, fs.readFileSync(path.join(repoRoot, MODULE), 'utf8'))
    const head = commit(fixture, {
      [MODULE]: fs.readFileSync(path.join(repoRoot, MODULE), 'utf8'),
    })
    const output = path.join(scratch, 'output')
    const result = spawnSync(process.execPath, [MODULE, 'equivalent', 'web', head], {
      cwd: fixture,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: output },
    })
    assert.equal(result.status, 0, result.stderr)
    const commits = equivalentCommits(fixture, 'web', head)
    assert.equal(commits.length, 2)
    assert.equal(result.stdout, `${commits.join(' ')}\n`)
    assert.equal(fs.readFileSync(output, 'utf8'), `web=${commits.join(' ')}\n`)
  })
})

describe('the preview deploys share the map', () => {
  test('inputsHash is the committed inputs hash of a clean checkout', () => {
    for (const project of ['web', 'api'])
      assert.equal(inputsHash(fixture, project), inputsHashAt(fixture, project, 'HEAD'))
  })

  test('an uncommitted edit fails only the project that builds from the file', () => {
    write(fixture, 'scripts/ci/lanes.mjs', 'uncommitted CI edit')
    assert.equal(inputsHash(fixture, 'web'), inputsHashAt(fixture, 'web', 'HEAD'))
    assert.equal(inputsHash(fixture, 'api'), inputsHashAt(fixture, 'api', 'HEAD'))
    write(fixture, 'scripts/lib/connection.mjs', 'uncommitted API edit')
    assert.equal(inputsHash(fixture, 'web'), inputsHashAt(fixture, 'web', 'HEAD'))
    assert.throws(() => inputsHash(fixture, 'api'), {
      message: 'the checkout has uncommitted changes to the build inputs',
    })
  })

  test('a staged edit fails the project too, and the checkout keeps its index', () => {
    write(fixture, 'apps/web/src/page.tsx', 'staged')
    git(fixture, 'add', '--', 'apps/web/src/page.tsx')
    const staged = git(fixture, 'diff', '--cached', '--name-only')
    assert.throws(() => inputsHash(fixture, 'web'), {
      message: 'the checkout has uncommitted changes to the build inputs',
    })
    assert.equal(inputsHash(fixture, 'api'), inputsHashAt(fixture, 'api', 'HEAD'))
    assert.equal(git(fixture, 'diff', '--cached', '--name-only'), staged)
  })
})

describe('production E2E accepts what each project serves', () => {
  const workflow = (file) =>
    parse(fs.readFileSync(path.join(repoRoot, '.github/workflows', file), 'utf8'))

  test('pw-e2e-prod waits for one of the equivalent commits and tests the one served', () => {
    const { jobs } = workflow('pw-e2e-prod.yml')
    assert.deepEqual(
      jobs['served-commits'].steps.map((step) => step.run).filter(Boolean),
      [
        'node scripts/vercel-build-inputs.mjs equivalent web "$GITHUB_SHA"\nnode scripts/vercel-build-inputs.mjs equivalent api "$GITHUB_SHA"\n',
      ]
    )
    assert.equal(jobs['served-commits'].steps[0].with['fetch-depth'], 100)
    assert.deepEqual(jobs['served-commits'].outputs, {
      web: '${{ steps.commits.outputs.web }}',
      api: '${{ steps.commits.outputs.api }}',
    })
    for (const project of ['web', 'api']) {
      const wait = jobs[`wait-${project}`]
      assert.equal(wait.needs, 'served-commits')
      assert.equal(wait.uses, './.github/workflows/rwf-wait-for-deployment.yml')
      assert.equal(
        wait.with.expected_sha,
        `\${{ needs.served-commits.outputs.${project} }}`
      )
      assert.equal(
        wait.with.health_url,
        `https://couture-cast-${project}.vercel.app/api/health`
      )
    }
    assert.deepEqual(jobs['run-prod-tests'].needs, ['wait-web', 'wait-api'])
    assert.equal(
      jobs['run-prod-tests'].with.expected_web_sha,
      '${{ needs.wait-web.outputs.observed_sha }}'
    )
    assert.equal(
      workflow('rwf-wait-for-deployment.yml').on.workflow_call.outputs.observed_sha.value,
      '${{ jobs.wait.outputs.observed_sha }}'
    )
  })

  describe('the deployment wait', () => {
    let server
    let served
    let healthUrl

    beforeEach(async () => {
      served = { status: 'ok', gitSha: 'c'.repeat(40) }
      server = createServer((_request, response) => {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(served))
      })
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      healthUrl = `http://127.0.0.1:${server.address().port}/api/health`
    })

    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve))
    })

    /**
     * Runs the wait step's shell as the reusable workflow does, with one attempt. It runs
     * asynchronously: the health server answers from this process.
     */
    async function wait(expected) {
      const { jobs } = workflow('rwf-wait-for-deployment.yml')
      const step = jobs.wait.steps.find((candidate) => candidate.id === 'health_check')
      const output = path.join(scratch, `output-${Math.random()}`)
      fs.writeFileSync(output, '')
      const child = spawn(
        'bash',
        ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run],
        {
          env: {
            PATH: process.env.PATH,
            HEALTH_URL: healthUrl,
            EXPECTED_SHA: expected,
            RETRIES: '1',
            SLEEP_SECONDS: '0',
            GITHUB_OUTPUT: output,
          },
        }
      )
      let stdout = ''
      child.stdout.on('data', (chunk) => (stdout += chunk))
      const status = await new Promise((resolve) => child.on('close', resolve))
      return { status, output: fs.readFileSync(output, 'utf8'), stdout }
    }

    test('accepts the served commit when it is the only one expected', async () => {
      const result = await wait('c'.repeat(40))
      assert.equal(result.status, 0)
      assert.equal(result.output, `observed_sha=${'c'.repeat(40)}\n`)
    })

    test('accepts the served commit when it is any of several equivalent ones', async () => {
      const result = await wait(`${'a'.repeat(40)} ${'b'.repeat(40)} ${'c'.repeat(40)}`)
      assert.equal(result.status, 0)
      assert.equal(result.output, `observed_sha=${'c'.repeat(40)}\n`)
    })

    test('fails when the served commit is none of them, and writes no commit', async () => {
      const result = await wait(`${'a'.repeat(40)} ${'b'.repeat(40)}`)
      assert.equal(result.status, 1)
      assert.equal(result.output, '')
      assert.match(
        result.stdout,
        /Expected SHA: aaaaaaa or one of 1 earlier commits with the same inputs/
      )
    })

    test('fails when no commit is expected', async () => {
      const result = await wait('')
      assert.equal(result.status, 1)
      assert.equal(result.output, '')
    })
  })
})
