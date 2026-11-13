// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
// Story 6.15 SL-11: package-lock.json and the root package.json are shared by every workspace, so
// a change to them is a native iOS change when it touches what the iOS jobs install and run (the
// root tools, apps/mobile and the packages except packages/db), or a root field or script an iOS
// run reads. An Expo bump, a native dependency under mobile and a root playwright or prisma bump
// count. A web-only bump skips; an API-only or packages/db bump skips while browser-acceptance
// boots the same API on pull requests, which the pin below holds.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import { runsApi } from './fixtures/ios-runs-github.mjs'
import { matchesAny, readWorkspaceDependencies, selectLanes } from './lanes.mjs'
import {
  disabledCondition,
  executedLines,
  neutralizedRun,
  requiredLineProblems,
} from './ios-native-workflow.mjs'
import {
  IOS_JOBS_WORKFLOW,
  IOS_NATIVE_WORKFLOW,
  LIFECYCLE_SCRIPTS,
  LOCKFILE,
  PUSH_ONLY_PATHS,
  ROOT_MANIFEST,
  dependencyChanges,
  evidenceInputs,
  nativeClosure,
  nativeIosChanges,
  nativeLockChanges,
  pushChanges,
  pushPaths,
  rootManifestChanges,
  rootScriptClosure,
  rootScriptsRun,
} from './ios-native-inputs.mjs'

const workflowText = fs.readFileSync(IOS_NATIVE_WORKFLOW, 'utf8')
const inputs = pushPaths(workflowText)
const jobsText = fs.readFileSync(IOS_JOBS_WORKFLOW, 'utf8')
const clone = (value) => JSON.parse(JSON.stringify(value))

// A small lockfile of the shape npm writes: three workspaces, a linked shared package, hoisted
// and nested installs.
const lock = {
  lockfileVersion: 3,
  packages: {
    '': {
      name: 'root',
      workspaces: ['apps/*', 'packages/*'],
      dependencies: { '@prisma/client': '^6' },
      devDependencies: {
        eslint: '^9',
        '@playwright/test': '^1',
        prisma: '^6',
        tsx: '^4',
      },
    },
    'apps/mobile': {
      dependencies: { expo: '^58.0.0', react: '19.1.0', '@couture/utils': '*' },
      devDependencies: { 'jest-expo': '^58.0.0' },
    },
    'apps/web': { dependencies: { next: '^15', react: '19.1.0', '@couture/utils': '*' } },
    'apps/api': { dependencies: { '@nestjs/core': '^11' } },
    'packages/utils': { dependencies: { zod: '^3' } },
    'packages/config': { devDependencies: { tsup: '^8' } },
    'packages/db': { dependencies: { '@prisma/adapter-pg': '^6' } },
    'node_modules/@couture/utils': { resolved: 'packages/utils', link: true },
    'node_modules/expo': {
      version: '58.0.1',
      dependencies: { 'expo-modules-core': '3.0.0', 'babel-preset-expo': '58.0.0' },
    },
    'node_modules/expo-modules-core': { version: '3.0.0' },
    'node_modules/expo/node_modules/babel-preset-expo': { version: '58.0.0' },
    'node_modules/babel-preset-expo': { version: '54.0.0' },
    'node_modules/jest-expo': { version: '58.0.0', dev: true },
    'node_modules/react': { version: '19.1.0' },
    'node_modules/zod': { version: '3.25.0' },
    'node_modules/next': { version: '15.5.0', dependencies: { 'styled-jsx': '5.1.6' } },
    'node_modules/styled-jsx': { version: '5.1.6' },
    'node_modules/@nestjs/core': { version: '11.2.0' },
    'node_modules/eslint': { version: '9.0.0', dev: true },
    'node_modules/@playwright/test': { version: '1.50.0', dev: true },
    'node_modules/prisma': { version: '6.1.0', dev: true },
    'node_modules/@prisma/client': { version: '6.1.0' },
    'node_modules/tsx': { version: '4.19.0', dev: true },
    'node_modules/tsup': { version: '8.3.0', dev: true },
    'node_modules/@prisma/adapter-pg': { version: '6.1.0' },
  },
}
const bump = (key, patch) => {
  const next = clone(lock)
  next.packages[key] = { ...next.packages[key], ...patch }
  return next
}

describe('what apps/mobile installs, from the lockfile alone', () => {
  test('the root, mobile and the packages but packages/db, what they resolve, nested installs first', () => {
    assert.deepEqual([...nativeClosure(lock)].sort(), [
      '',
      'apps/mobile',
      'node_modules/@couture/utils',
      'node_modules/@playwright/test',
      'node_modules/@prisma/client',
      'node_modules/eslint',
      'node_modules/expo',
      'node_modules/expo-modules-core',
      'node_modules/expo/node_modules/babel-preset-expo',
      'node_modules/jest-expo',
      'node_modules/prisma',
      'node_modules/react',
      'node_modules/tsup',
      'node_modules/tsx',
      'node_modules/zod',
      'packages/config',
      'packages/utils',
    ])
  })

  const fires = {
    'an expo bump': bump('node_modules/expo', { version: '58.0.2' }),
    'a transitive native dependency under mobile': bump(
      'node_modules/expo-modules-core',
      {
        version: '3.0.1',
      }
    ),
    'a nested install under a mobile dependency': bump(
      'node_modules/expo/node_modules/babel-preset-expo',
      { version: '58.0.1' }
    ),
    'a shared package mobile and web both use': bump('node_modules/react', {
      version: '19.1.1',
    }),
    'a dependency of a workspace mobile links': bump('node_modules/zod', {
      version: '3.25.1',
    }),
    'a root playwright bump': bump('node_modules/@playwright/test', {
      version: '1.51.0',
    }),
    'a root prisma bump': bump('node_modules/prisma', { version: '6.2.0' }),
    'a root tsx bump': bump('node_modules/tsx', { version: '4.20.0' }),
    'a root development tool bump': bump('node_modules/eslint', { version: '9.1.0' }),
    'a development tool of a package the iOS jobs build': bump('node_modules/tsup', {
      version: '8.4.0',
    }),
    'a new dependency of the mobile workspace': bump('apps/mobile', {
      dependencies: {
        ...lock.packages['apps/mobile'].dependencies,
        'expo-camera': '^17',
      },
    }),
  }
  for (const [name, after] of Object.entries(fires))
    test(`${name} counts`, () => {
      assert.ok(nativeLockChanges(lock, after).length > 0, name)
    })

  const quiet = {
    'a web-only bump': (() => {
      const after = bump('node_modules/next', { version: '15.5.1' })
      after.packages['node_modules/styled-jsx'].version = '5.1.7'
      after.packages['apps/web'].dependencies.next = '^15.5.1'
      return after
    })(),
    // browser-acceptance boots the same API on the pull request (pinned below).
    'an API-only bump, which browser-acceptance runs': (() => {
      const after = bump('node_modules/@nestjs/core', { version: '11.2.1' })
      after.packages['apps/api'].dependencies['@nestjs/core'] = '^11.2.1'
      return after
    })(),
    'a packages/db-only bump, which browser-acceptance runs': bump(
      'node_modules/@prisma/adapter-pg',
      { version: '6.2.0' }
    ),
    'the hoisted copy mobile does not resolve': bump('node_modules/babel-preset-expo', {
      version: '54.0.1',
    }),
  }
  for (const [name, after] of Object.entries(quiet))
    test(`${name} does not count`, () => {
      assert.deepEqual(nativeLockChanges(lock, after), [], name)
    })

  test('a dependency mobile drops counts, since it was installed before', () => {
    const after = clone(lock)
    delete after.packages['node_modules/expo-modules-core']
    delete after.packages['node_modules/expo'].dependencies['expo-modules-core']
    assert.deepEqual(nativeLockChanges(lock, after), [
      'node_modules/expo',
      'node_modules/expo-modules-core',
    ])
  })

  test('a lockfile this cannot read counts as unknown', () => {
    assert.equal(nativeLockChanges(lock, { lockfileVersion: 1, dependencies: {} }), null)
    assert.equal(nativeLockChanges(null, lock), null)
  })

  test('the repository lockfile: the iOS jobs install Expo, React Native and the root tools', () => {
    const closure = nativeClosure(JSON.parse(fs.readFileSync(LOCKFILE, 'utf8')))
    for (const key of [
      'node_modules/expo',
      'node_modules/react-native',
      'node_modules/@playwright/test',
      'node_modules/prisma',
      'node_modules/tsx',
      'packages/utils',
    ])
      assert.ok(closure.has(key), key)
    for (const key of [
      'node_modules/next',
      'node_modules/stripe',
      'apps/web',
      'apps/api',
      'packages/db',
    ])
      assert.ok(!closure.has(key), key)
  })
})

// apps/api and packages/db skip iOS evidence only while a Linux pull request job boots the same
// API path: browser-acceptance builds the API, runs node scripts/run-story68-native.mjs serve
// and the story68-api-entry guard, under the share-card lane those workspaces wake.
//
// IOS-R3-04: the pin binds each command the way the mandatory iOS checks are bound: an exact line
// the shell executes, unconditionally, in a step that runs and can fail the job. The serve line
// runs in the background, so a later step that always runs must fail on its recorded exit status.
const API_BUILD = 'npm run build --workspace api'
const API_SERVE =
  '(node scripts/run-story68-native.mjs serve > /tmp/cc68-api.log 2>&1; echo $? > /tmp/cc68-api.exit) &'
const API_ENTRY =
  'npx vitest run scripts/lib/story68-api-entry.test.mjs --reporter=default --reporter=json --outputFile="$RUNNER_TEMP/story68-api-entry.json"'
const SERVICE_EXITS = [
  'for service in auth api; do',
  'if [ -f "/tmp/cc68-$service.exit" ]; then',
  'exit "$status"',
]

/**
 * Whether a report body fails with no owned service exit marker, with one for the API, one for
 * auth, and with both. The body runs in a temporary directory that stands in for /tmp.
 */
function reportFails(run) {
  const failed = {}
  for (const [name, services] of Object.entries({
    none: [],
    api: ['api'],
    auth: ['auth'],
    both: ['api', 'auth'],
  })) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-report-'))
    try {
      for (const service of services) {
        fs.writeFileSync(path.join(dir, `cc68-${service}.exit`), '1\n')
        fs.writeFileSync(path.join(dir, `cc68-${service}.log`), 'harmless\n')
      }
      const body = String(run).replaceAll('/tmp/', `${dir}/`)
      failed[name] = spawnSync('bash', ['-e', '-c', body], { cwd: dir }).status !== 0
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
  return failed
}

// C-14 B: the calls that bind JavaScript to a native module or view.
const NATIVE_CALL =
  /\b(requireNativeModule|requireOptionalNativeModule|requireNativeView|requireNativeViewManager|requireNativeComponent|NativeModules|TurboModuleRegistry)\b/
const SOURCE = /^apps\/mobile\/.+\.(ts|tsx|js|jsx|cjs|mjs)$/
const TEST_ONLY = /(\.(test|spec)\.[cm]?[jt]sx?$)|^apps\/mobile\/src\/test-utils\//

/** The non-test source files under apps/mobile that call a native module. */
function nativeCallers(files, read) {
  return files
    .filter((file) => SOURCE.test(file) && !TEST_ONLY.test(file))
    .filter((file) => NATIVE_CALL.test(read(file) ?? ''))
    .sort()
}

// TEA P3 and C14-02: the files of a native module that need evidence: every one but its Android
// half, its tests and its Markdown, which the evidence inputs leave out too.
const moduleFiles = (files) =>
  files.filter(
    (file) =>
      /^apps\/mobile\/modules\/[^/]+\/.+$/.test(file) &&
      !/^apps\/mobile\/modules\/[^/]+\/android\//.test(file) &&
      !/\.(test|spec)\.[^/]*$/.test(file) &&
      !file.endsWith('.md')
  )

/** The native module files a pull request could change without a dispatch. */
function moduleFileProblems(files, evidence) {
  return moduleFiles(files)
    .filter((file) => !matchesAny(file, evidence))
    .map((file) => `${file} belongs to a native module and is no evidence input`)
}

/** The native callers a pull request could change without a dispatch. */
function nativeCallerProblems(files, read, evidence) {
  return nativeCallers(files, read)
    .filter((file) => !matchesAny(file, evidence))
    .map((file) => `${file} calls a native module and is no evidence input`)
}

/**
 * A step body without the text its here-documents carry, which the shell reads as data, and
 * without their `<<` openers.
 */
function withoutHereDocuments(run) {
  const kept = []
  let end = null
  for (const line of String(run ?? '').split('\n')) {
    if (end !== null) {
      if (line.trim() === end) end = null
      continue
    }
    const opener = /<<-?\s*(['"]?)([\w-]+)\1/.exec(line)
    if (opener) end = opener[2]
    kept.push(opener ? line.replace(opener[0], '') : line)
  }
  return kept.join('\n')
}

/** Why browser-acceptance may no longer build, boot and check the API on a pull request. */
function apiPinProblems(workflow) {
  const job = workflow?.jobs?.['browser-acceptance']
  if (!job) return ['browser-acceptance is gone']
  const problems = []
  if (job['runs-on'] !== 'ubuntu-latest')
    problems.push('browser-acceptance left ubuntu-latest')
  if (!/\['share-card'\]/.test(String(job.if)))
    problems.push('browser-acceptance no longer runs on the share-card lane')
  if (job['continue-on-error'] !== undefined && job['continue-on-error'] !== false)
    problems.push('browser-acceptance continues on error')
  // The steps that run under the default bash -e and can fail the job.
  const steps = (job.steps ?? [])
    .map((row, index) => ({ row, index, run: withoutHereDocuments(row.run) }))
    .filter(
      ({ row, run }) =>
        row.run !== undefined &&
        !disabledCondition(row.if) &&
        (row['continue-on-error'] === undefined || row['continue-on-error'] === false) &&
        (row.shell === undefined || row.shell === 'bash') &&
        !neutralizedRun(run)
    )
  const runs = (line) =>
    steps.find(({ run }) => requiredLineProblems(run, [line]).length === 0)
  for (const line of [API_BUILD, API_ENTRY])
    if (!runs(line)) problems.push(`no step that can fail runs ${line}`)
  const serve = steps.find(({ run }) =>
    executedLines(run).some((entry) => entry.line === API_SERVE && !entry.conditional)
  )
  if (!serve) problems.push(`no step that can fail runs ${API_SERVE}`)
  else if (
    !steps.some(
      ({ row, index, run }) =>
        index > serve.index &&
        row.if === 'always()' &&
        requiredLineProblems(run, SERVICE_EXITS).length === 0 &&
        executedLines(run).some((entry) => entry.line === 'status=1') &&
        // IOS-R4-02: and it does: run with harmless exit markers, it fails for each service.
        JSON.stringify(reportFails(row.run)) ===
          JSON.stringify({
            none: false,
            api: true,
            auth: true,
            both: true,
          })
    )
  )
    problems.push('no later step that always runs fails on the API exit status')
  return problems
}

describe('the API pin', () => {
  const unpinned =
    'apps/api and packages/db must return to the iOS evidence inputs (scripts/ci/ios-native-inputs.mjs)'
  const read = () =>
    parse(fs.readFileSync('.github/workflows/pr-share-card-native.yml', 'utf8'))

  test('browser-acceptance boots the API on every pull request apps/api or packages/db wakes', () => {
    assert.deepEqual(apiPinProblems(read()), [], unpinned)
    const dependencies = readWorkspaceDependencies('.')
    for (const file of ['apps/api/src/main.ts', 'packages/db/package.json']) {
      const plan = selectLanes({ event: 'pull_request', files: [file], dependencies })
      assert.equal(
        plan['share-card'].run,
        true,
        `${unpinned}: the share-card lane skips ${file}`
      )
    }
  })

  // Each mutant edits a parsed copy; the workflow file itself stays untouched.
  const stepWith = (job, line) =>
    job.steps.find((row) =>
      String(row.run ?? '')
        .split('\n')
        .includes(line)
    )
  const edit = (line, replace) => (job) => {
    const row = stepWith(job, line)
    row.run = row.run
      .split('\n')
      .map((text) => (text === line ? replace : text))
      .join('\n')
  }
  const patch = (line, fields) => (job) => Object.assign(stepWith(job, line), fields)
  const mutants = {
    'a commented-out API build': edit(API_BUILD, `# ${API_BUILD}`),
    'a commented-out serve line': edit(API_SERVE, `# ${API_SERVE}`),
    'a commented-out entry guard': edit(API_ENTRY, `# ${API_ENTRY}`),
    'a disabled build step': patch(API_BUILD, { if: false }),
    'a disabled entry guard step': patch(API_ENTRY, {
      if: "${{ false && steps.runtime.outcome == 'success' }}",
    }),
    'a build whose failure is swallowed': edit(API_BUILD, `${API_BUILD} || true`),
    'an entry guard whose failure is swallowed': edit(API_ENTRY, `${API_ENTRY} || :`),
    'a build step under set +e': edit(API_BUILD, `set +e\n${API_BUILD}`),
    'a build step that continues on error': patch(API_BUILD, {
      'continue-on-error': true,
    }),
    'an entry guard behind an if': edit(API_ENTRY, `if false; then\n${API_ENTRY}\nfi`),
    'an entry guard inside a here-document': edit(
      API_ENTRY,
      `cat <<'TEXT'\n${API_ENTRY}\nTEXT`
    ),
    'a build step run by sh': patch(API_BUILD, { shell: 'sh -c "exit 0" {0}' }),
    'a job that continues on error': (job) =>
      Object.assign(job, { 'continue-on-error': true }),
    'no step that fails on the API exit status': edit('exit "$status"', 'exit 0'),
    // IOS-R4-02: a report that resets its status before it exits keeps every structural line.
    'a report that resets its status': edit('exit "$status"', 'status=0\nexit "$status"'),
    'a disabled exit status report': patch('exit "$status"', { if: false }),
  }
  // IOS-R4-02: the real report body, run with harmless exit markers in a temporary directory in
  // place of /tmp, exits 0 with no service exit and nonzero for each one.
  test('the report step fails for each owned service that exited, and only then', () => {
    const job = read().jobs['browser-acceptance']
    const report = job.steps.find((row) =>
      String(row.run ?? '').includes('exit "$status"')
    )
    assert.equal(report.if, 'always()')
    assert.deepEqual(reportFails(report.run), {
      none: false,
      api: true,
      auth: true,
      both: true,
    })
  })

  for (const [name, mutate] of Object.entries(mutants))
    test(`${name} unpins the API`, () => {
      const workflow = read()
      mutate(workflow.jobs['browser-acceptance'])
      assert.notDeepEqual(apiPinProblems(workflow), [], `${name} still passes the pin`)
    })
})

describe('what the root manifest changes for an iOS run', () => {
  const root = {
    workspaces: ['apps/*', 'packages/*'],
    overrides: { glob: '^10' },
    engines: { node: '>=22' },
    packageManager: 'npm@10.9.0',
    scripts: {
      'db:generate': 'npm run db:generate --workspace packages/db',
      'build:packages':
        'npm run build:config && npm run build --workspace @couture/utils',
      'build:config': 'npm run build --workspace @couture/config',
      'lint:web': 'npm run lint --workspace web',
    },
    devDependencies: { eslint: '^9' },
  }
  const text =
    'run: |\n  npm run db:generate\n  npm run build:packages\n  npm run build --workspace api\n'

  test('the root scripts a run names, and the root scripts those run', () => {
    assert.deepEqual(rootScriptsRun(text, root), [
      'build:config',
      'build:packages',
      'db:generate',
    ])
    assert.ok(
      rootScriptsRun(
        jobsText,
        JSON.parse(fs.readFileSync(ROOT_MANIFEST, 'utf8'))
      ).includes('build:packages')
    )
  })

  const change = (patch) => rootManifestChanges(root, { ...clone(root), ...patch }, text)
  test('an install-wide field or a script the run uses counts', () => {
    assert.deepEqual(change({ overrides: { glob: '^11' } }), ['overrides'])
    assert.deepEqual(change({ workspaces: ['apps/*'] }), ['workspaces'])
    assert.deepEqual(change({ packageManager: 'npm@11.0.0' }), ['packageManager'])
    assert.deepEqual(
      change({ scripts: { ...root.scripts, 'build:config': 'tsc -b packages/config' } }),
      ['scripts.build:config']
    )
  })

  test('a root dependency, a lifecycle script, or a hook of a script the run uses counts', () => {
    assert.deepEqual(change({ devDependencies: { eslint: '^10' } }), ['devDependencies'])
    assert.deepEqual(change({ dependencies: { '@prisma/client': '^7' } }), [
      'dependencies',
    ])
    for (const name of LIFECYCLE_SCRIPTS)
      assert.deepEqual(
        change({ scripts: { ...root.scripts, [name]: 'node scripts/setup.mjs' } }),
        [`scripts.${name}`],
        name
      )
    for (const name of ['predb:generate', 'postbuild:packages', 'prebuild:config'])
      assert.deepEqual(
        change({ scripts: { ...root.scripts, [name]: 'node scripts/hook.mjs' } }),
        [`scripts.${name}`],
        name
      )
  })

  // IOS-R3-03: npm ci runs this sequence of root scripts on its own (docs.npmjs.com, Scripts,
  // "npm ci"), preprepare and postprepare among them.
  test('the lifecycle scripts are every root script npm ci runs, in its order', () => {
    assert.deepEqual(LIFECYCLE_SCRIPTS, [
      'preinstall',
      'install',
      'postinstall',
      'prepublish',
      'preprepare',
      'prepare',
      'postprepare',
    ])
    for (const hook of ['preprepare', 'postprepare']) {
      const hooked = {
        ...root,
        scripts: { ...root.scripts, [hook]: 'npm run setup:hooks', 'setup:hooks': 'a' },
      }
      assert.ok(rootScriptClosure(text, hooked).includes('setup:hooks'), hook)
      assert.deepEqual(
        rootManifestChanges(
          hooked,
          { ...hooked, scripts: { ...hooked.scripts, 'setup:hooks': 'b' } },
          text
        ),
        ['scripts.setup:hooks'],
        hook
      )
    }
  })

  // IOS-R2-03: the root scripts a lifecycle script or a hook runs count too.
  test('a root script a lifecycle script or a hook runs counts', () => {
    const hooked = {
      ...root,
      scripts: {
        ...root.scripts,
        prepare: 'npm run setup:git',
        'setup:git': 'husky',
        'prebuild:packages': 'npm run clean',
        clean: 'rimraf dist',
      },
    }
    const edit = (name) =>
      rootManifestChanges(
        hooked,
        { ...hooked, scripts: { ...hooked.scripts, [name]: 'changed' } },
        text
      )
    assert.deepEqual(edit('setup:git'), ['scripts.setup:git'])
    assert.deepEqual(edit('clean'), ['scripts.clean'])
    assert.deepEqual(
      rootScriptClosure(text, hooked).filter((name) =>
        ['setup:git', 'clean', 'prepare'].includes(name)
      ),
      ['clean', 'prepare', 'setup:git']
    )
  })

  test('a web script or a hook of a script no iOS job runs does not count', () => {
    assert.deepEqual(
      change({ scripts: { ...root.scripts, 'lint:web': 'eslint apps/web' } }),
      []
    )
    assert.deepEqual(change({ scripts: { ...root.scripts, 'prelint:web': 'echo' } }), [])
    assert.equal(rootManifestChanges(null, root, text), null)
  })
})

describe('a native iOS change', () => {
  const read = (sides) => async (side, file) => sides[side][file] ?? null
  const contents = (lockfile, manifest = {}) => ({
    [LOCKFILE]: JSON.stringify(lockfile),
    [ROOT_MANIFEST]: JSON.stringify(manifest),
  })

  test('the lockfile counts only when mobile installs what changed', async () => {
    const web = await dependencyChanges(
      read({
        before: contents(lock),
        after: contents(bump('node_modules/next', { version: '16' })),
      }),
      jobsText
    )
    assert.deepEqual(web, { [LOCKFILE]: false, [ROOT_MANIFEST]: false })
    assert.deepEqual(
      nativeIosChanges([LOCKFILE, ROOT_MANIFEST, 'apps/web/package.json'], inputs, web),
      []
    )
    const expo = await dependencyChanges(
      read({
        before: contents(lock),
        after: contents(bump('node_modules/expo', { version: '58.1.0' })),
      }),
      jobsText
    )
    assert.deepEqual(
      nativeIosChanges([LOCKFILE, 'apps/mobile/package.json'], inputs, expo),
      [LOCKFILE, 'apps/mobile/package.json']
    )
  })

  test('an unreadable side counts', async () => {
    const unknown = await dependencyChanges(
      read({ before: {}, after: contents(lock) }),
      jobsText
    )
    assert.deepEqual(unknown, { [LOCKFILE]: true, [ROOT_MANIFEST]: true })
  })

  test('without an answer, the shared files count on their path', () => {
    assert.deepEqual(nativeIosChanges([LOCKFILE, ROOT_MANIFEST], inputs), [
      LOCKFILE,
      ROOT_MANIFEST,
    ])
  })

  test('a narrowed scripts/lib: a helper the iOS jobs read counts, a community helper does not', () => {
    assert.deepEqual(
      nativeIosChanges(
        [
          'scripts/lib/story68-native-build.mjs',
          'scripts/lib/community-rollout-flags.mjs',
          'scripts/lib/story68-native-build.test.mjs',
        ],
        inputs
      ),
      ['scripts/lib/story68-native-build.mjs']
    )
  })

  test("a dispatch runs main's workflows and no local action, so their edits are no evidence input", () => {
    const evidence = evidenceInputs(inputs)
    for (const glob of [
      '.github/workflows/ios-native.yml',
      '.github/workflows/ios-native-jobs.yml',
      '.github/actions/install/**',
    ]) {
      assert.ok(inputs.includes(glob), `a merge still runs on ${glob}`)
      assert.ok(!evidence.includes(glob), glob)
    }
    assert.deepEqual(
      nativeIosChanges(
        ['.github/workflows/ios-native-jobs.yml', '.github/actions/install/action.yml'],
        evidence
      ),
      []
    )
    assert.ok(evidence.includes('apps/mobile/package.json'))
  })

  test('the push paths parse the same without a YAML parser', () => {
    assert.deepEqual(inputs, parse(workflowText).on.push.paths)
  })
})

// C-14: a merge to main runs iOS for any JavaScript the Release bundle holds, while a pull request
// needs a head-commit dispatch only for a native input, the JavaScript half of a native contract,
// or the bundler configuration. Probe PR 218 changed apps/mobile/metro.config.js alone and passed
// the evidence gate.
describe('the push paths and the evidence inputs', () => {
  const evidence = evidenceInputs(inputs)
  const wakes = (file) => ({
    push: matchesAny(file, inputs),
    evidence: matchesAny(file, evidence),
  })
  const fixtures = {
    'push only': [
      'apps/mobile/app/(tabs)/index.tsx',
      'apps/mobile/components/forecast-card.tsx',
      'apps/mobile/src/hooks/use-forecast.ts',
      'apps/mobile/src/screens/home.tsx',
      'apps/mobile/src/lib/share-card-save.ts',
      'packages/utils/src/index.ts',
      'packages/utils/package.json',
      'packages/config/tsconfig.json',
      // A module's Android half runs no iOS job, so it needs no dispatch.
      'apps/mobile/modules/share-card-native-share/android/src/main/java/ShareModule.kt',
      'apps/mobile/modules/share-card-native-share/android/build.gradle',
    ],
    both: [
      'apps/mobile/modules/share-card-photo-save/index.native.ts',
      'apps/mobile/modules/accessibility-focus/index.native.ts',
      'apps/mobile/modules/modal-system-bars/index.native.ts',
      'apps/mobile/modules/share-card-native-share/index.native.ts',
      'apps/mobile/src/lib/share-card-save.native.ts',
      'apps/mobile/src/lib/share-card-share.native.ts',
      'apps/mobile/src/lib/widget-share.ts',
      'apps/mobile/metro.config.js',
      'apps/mobile/babel.config.cjs',
      'apps/mobile/modules/share-card-photo-save/ios/ShareCardPhotoSaveModule.swift',
      'apps/mobile/app.json',
      'apps/mobile/package.json',
      // C-14 P1: every top-level file of a native module is its contract or autolinking entry.
      'apps/mobile/modules/share-card-photo-save/types.ts',
      'apps/mobile/modules/accessibility-focus/types.ts',
      'apps/mobile/modules/modal-system-bars/package.json',
      'apps/mobile/modules/modal-system-bars/index.ts',
      'apps/mobile/modules/share-card-native-share/expo-module.config.json',
      'apps/mobile/modules/new-module/constants.ts',
      'apps/mobile/native-tests/ShareCardShareSheetUITests.swift',
      // TEA P3: a module's nested JavaScript is its contract too.
      'apps/mobile/modules/share-card-photo-save/src/checksum.ts',
      'apps/mobile/modules/new-module/src/bindings/index.ts',
      // C14-01: the classifier and the judge themselves.
      'scripts/ci/ios-native-inputs.mjs',
      'scripts/ci/ios-native-evidence.mjs',
    ],
    neither: [
      'packages/db/src/client.ts',
      'packages/db/package.json',
      'packages/db/prisma/schema.prisma',
      'apps/mobile/src/lib/share-card-save.native.spec.ts',
      'apps/mobile/src/hooks/use-forecast.test.tsx',
      'apps/mobile/components/forecast-card.spec.tsx',
      'packages/utils/src/index.test.ts',
      'apps/mobile/README.md',
      'packages/utils/README.md',
      'apps/mobile/plugins/with-share-card-permissions.test.js',
      'apps/mobile/modules/share-card-photo-save/types.test.ts',
      'apps/mobile/modules/share-card-photo-save/index.spec.ts',
      'apps/mobile/modules/share-card-photo-save/README.md',
      'apps/mobile/modules/share-card-photo-save/docs/save-flow.md',
      'apps/mobile/modules/share-card-photo-save/src/checksum.test.ts',
      'scripts/ci/ios-native-inputs.test.mjs',
      'apps/web/app/page.tsx',
      'apps/api/src/main.ts',
    ],
  }
  const expected = {
    'push only': { push: true, evidence: false },
    both: { push: true, evidence: true },
    neither: { push: false, evidence: false },
  }
  for (const [name, files] of Object.entries(fixtures))
    test(`${name}: ${files.length} fixtures`, () => {
      for (const file of files) assert.deepEqual(wakes(file), expected[name], file)
    })

  test('the shared dependency files keep their lockfile closure rule on both', () => {
    for (const globs of [inputs, evidence]) {
      assert.deepEqual(
        nativeIosChanges([LOCKFILE, ROOT_MANIFEST], globs, {
          [LOCKFILE]: false,
          [ROOT_MANIFEST]: false,
        }),
        []
      )
      assert.deepEqual(
        nativeIosChanges([LOCKFILE, ROOT_MANIFEST], globs, {
          [LOCKFILE]: true,
          [ROOT_MANIFEST]: true,
        }),
        [LOCKFILE, ROOT_MANIFEST]
      )
    }
  })

  // C-14 C: whatever needs a dispatch on a pull request also runs iOS on its merge.
  test('the push paths hold every evidence input, on every tracked file and fixture', () => {
    const tracked = execFileSync('git', ['ls-files'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter(Boolean)
    const files = [...tracked, ...Object.values(fixtures).flat()]
    assert.ok(tracked.length > 1000)
    assert.deepEqual(
      files.filter((file) => matchesAny(file, evidence) && !matchesAny(file, inputs)),
      []
    )
    for (const glob of PUSH_ONLY_PATHS)
      assert.ok(inputs.includes(glob), `the push paths miss ${glob}`)
  })

  // C-14 B: every file that binds a native module is an evidence input, so a new caller outside
  // the set fails here before it can skip the dispatch.
  test('every non-test caller of a native module under apps/mobile is an evidence input', () => {
    const tracked = execFileSync('git', ['ls-files', 'apps/mobile'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter(Boolean)
    const read = (file) => fs.readFileSync(file, 'utf8')
    const callers = nativeCallers(tracked, read)
    assert.ok(callers.includes('apps/mobile/src/lib/widget-share.ts'), callers.join('\n'))
    assert.ok(
      callers.includes('apps/mobile/modules/share-card-photo-save/index.native.ts')
    )
    assert.deepEqual(nativeCallerProblems(tracked, read, evidence), [])
    // C-14 P1 and TEA P3: a module's files hold its contract (types.ts, nested src) and its
    // autolinking entry (package.json) without calling a require function, so each one is an
    // evidence input too.
    assert.ok(
      moduleFiles(tracked).includes('apps/mobile/modules/share-card-photo-save/types.ts')
    )
    assert.ok(
      moduleFiles(tracked).includes('apps/mobile/modules/modal-system-bars/package.json')
    )
    assert.deepEqual(moduleFileProblems(tracked, evidence), [])
  })

  // C14-02: module documentation, tests and the Android half need no evidence; contracts and
  // package metadata, nested ones included, stay covered.
  test('the module guard leaves docs, tests and Android out, and covers every module contract', () => {
    const tree = [
      'apps/mobile/modules/share-card-photo-save/README.md',
      'apps/mobile/modules/share-card-photo-save/docs/save-flow.md',
      'apps/mobile/modules/share-card-photo-save/types.test.ts',
      'apps/mobile/modules/share-card-photo-save/src/checksum.spec.ts',
      'apps/mobile/modules/share-card-photo-save/android/src/main/java/SaveModule.kt',
      'apps/mobile/modules/share-card-photo-save/types.ts',
      'apps/mobile/modules/share-card-photo-save/package.json',
      'apps/mobile/modules/share-card-photo-save/expo-module.config.json',
      'apps/mobile/modules/share-card-photo-save/src/checksum.ts',
      'apps/mobile/modules/share-card-photo-save/ios/SaveModule.swift',
    ]
    assert.deepEqual(moduleFiles(tree), tree.slice(5))
    assert.deepEqual(moduleFileProblems(tree, evidence), [])
    // Without the module entries, each contract the native push paths leave out is reported, and
    // no doc or test: expo-module.config.json and ios/** stay native push paths of their own.
    const narrowed = evidence.filter(
      (glob) => !glob.startsWith('apps/mobile/modules/*/**')
    )
    assert.deepEqual(
      moduleFileProblems(tree, narrowed),
      [
        'apps/mobile/modules/share-card-photo-save/types.ts',
        'apps/mobile/modules/share-card-photo-save/package.json',
        'apps/mobile/modules/share-card-photo-save/src/checksum.ts',
      ].map((file) => `${file} belongs to a native module and is no evidence input`)
    )
  })

  test('a new caller outside the evidence inputs fails the guard; tests and test helpers do not', () => {
    const tree = {
      'apps/mobile/src/lib/haptics.native.ts':
        "import { requireNativeModule } from 'expo-modules-core'\nexport default requireNativeModule('Haptics')\n",
      'apps/mobile/components/map-view.tsx':
        "import { requireNativeView } from 'expo'\nexport const Map = requireNativeView('Map')\n",
      'apps/mobile/src/lib/battery.ts':
        "import { NativeModules } from 'react-native'\nexport const b = NativeModules.Battery\n",
      'apps/mobile/src/lib/optional.ts':
        "import { requireOptionalNativeModule } from 'expo-modules-core'\nrequireOptionalNativeModule('X')\n",
      'apps/mobile/src/lib/haptics.test.ts': "requireNativeModule('Haptics')\n",
      'apps/mobile/src/lib/haptics.spec.tsx': 'NativeModules.Battery\n',
      'apps/mobile/src/test-utils/mocks/native.js': 'export const NativeModules = {}\n',
      'apps/mobile/src/lib/plain.ts': 'export const nativeModulesCount = 1\n',
      'apps/mobile/src/lib/widget-share.ts': 'NativeModules.WidgetSharedModule\n',
    }
    assert.deepEqual(
      nativeCallerProblems(Object.keys(tree), (file) => tree[file], evidence),
      [
        'apps/mobile/components/map-view.tsx calls a native module and is no evidence input',
        'apps/mobile/src/lib/battery.ts calls a native module and is no evidence input',
        'apps/mobile/src/lib/haptics.native.ts calls a native module and is no evidence input',
        'apps/mobile/src/lib/optional.ts calls a native module and is no evidence input',
      ]
    )
  })
})

describe('the ios-changes job', () => {
  const before = 'b'.repeat(40)
  const decide = async (env, repo) => {
    const calls = []
    const run = (args) => {
      calls.push(args.join(' '))
      if (args[0] === 'fetch') return ''
      if (args[0] === 'diff') return `${repo.files.join('\n')}\n`
      if (args[0] === 'show') {
        const [sha, file] = args[1].split(':')
        const text = repo[sha === 'HEAD' ? 'after' : 'before'][file]
        if (text == null) throw new Error('missing')
        return text
      }
      throw new Error(`unexpected git ${args.join(' ')}`)
    }
    const answer = await pushChanges({ env, run, fetchImpl: runsApi().fetchImpl })
    return { answer, calls }
  }
  const sides = (after) => ({
    before: { [LOCKFILE]: JSON.stringify(lock), [ROOT_MANIFEST]: '{}' },
    after: { [LOCKFILE]: JSON.stringify(after), [ROOT_MANIFEST]: '{}' },
  })

  // A nightly run with no passing run on its commit; ios-native-runs.test.mjs covers the rest.
  test('a dispatch or a nightly run always runs, without reading the diff', async () => {
    for (const EVENT of ['workflow_dispatch', 'schedule']) {
      const { answer, calls } = await decide({ EVENT, BEFORE: '' }, { files: [] })
      assert.equal(answer, true, EVENT)
      assert.deepEqual(calls, [])
    }
  })

  test('a merge of a web-only lockfile bump skips the iOS jobs', async () => {
    const { answer } = await decide(
      { EVENT: 'push', BEFORE: before },
      {
        files: [LOCKFILE, 'apps/web/package.json'],
        ...sides(bump('node_modules/next', { version: '16' })),
      }
    )
    assert.equal(answer, false)
  })

  test('a merge of an Expo bump runs them', async () => {
    const { answer } = await decide(
      { EVENT: 'push', BEFORE: before },
      { files: [LOCKFILE], ...sides(bump('node_modules/expo', { version: '58.1.0' })) }
    )
    assert.equal(answer, true)
  })

  // IOS-R2-03: a merge that changes only the root prepare script runs them.
  test('a merge of a root prepare script alone runs them', async () => {
    const { answer } = await decide(
      { EVENT: 'push', BEFORE: before },
      {
        files: [ROOT_MANIFEST],
        before: {
          [LOCKFILE]: JSON.stringify(lock),
          [ROOT_MANIFEST]: '{"scripts":{"prepare":"husky"}}',
        },
        after: {
          [LOCKFILE]: JSON.stringify(lock),
          [ROOT_MANIFEST]: '{"scripts":{"prepare":"husky install"}}',
        },
      }
    )
    assert.equal(answer, true)
    const quiet = await decide(
      { EVENT: 'push', BEFORE: before },
      {
        files: [ROOT_MANIFEST],
        before: {
          [LOCKFILE]: JSON.stringify(lock),
          [ROOT_MANIFEST]: '{"scripts":{"lint:web":"a"}}',
        },
        after: {
          [LOCKFILE]: JSON.stringify(lock),
          [ROOT_MANIFEST]: '{"scripts":{"lint:web":"b"}}',
        },
      }
    )
    assert.equal(quiet.answer, false)
  })

  // IOS-R3-03: the same for a preprepare or postprepare hook, added, edited or removed.
  test('a merge of a preprepare or postprepare hook alone runs them', async () => {
    for (const hook of ['preprepare', 'postprepare'])
      for (const [name, was, now] of [
        ['added', {}, { [hook]: 'printf harmless-hook-marker' }],
        ['edited', { [hook]: 'printf a' }, { [hook]: 'printf b' }],
        ['removed', { [hook]: 'printf a' }, {}],
      ]) {
        const { answer } = await decide(
          { EVENT: 'push', BEFORE: before },
          {
            files: [ROOT_MANIFEST],
            before: {
              [LOCKFILE]: JSON.stringify(lock),
              [ROOT_MANIFEST]: JSON.stringify({ scripts: was }),
            },
            after: {
              [LOCKFILE]: JSON.stringify(lock),
              [ROOT_MANIFEST]: JSON.stringify({ scripts: now }),
            },
          }
        )
        assert.equal(answer, true, `${hook} ${name}`)
      }
  })

  // C-14: a merge of JavaScript the Release bundle holds runs them; a test, Markdown or
  // packages/db merge does not.
  test('a merge of mobile or shared package JavaScript alone runs them', async () => {
    for (const file of [
      'apps/mobile/src/hooks/use-forecast.ts',
      'apps/mobile/metro.config.js',
      'packages/utils/src/index.ts',
    ]) {
      const { answer } = await decide(
        { EVENT: 'push', BEFORE: before },
        { files: [file], ...sides(lock) }
      )
      assert.equal(answer, true, file)
    }
    for (const file of [
      'apps/mobile/src/hooks/use-forecast.test.ts',
      'apps/mobile/README.md',
      'packages/db/src/client.ts',
    ]) {
      const { answer } = await decide(
        { EVENT: 'push', BEFORE: before },
        { files: [file], ...sides(lock) }
      )
      assert.equal(answer, false, file)
    }
  })

  test('a merge with no earlier commit, or a diff that fails, runs them', async () => {
    assert.equal(
      (await decide({ EVENT: 'push', BEFORE: '0'.repeat(40) }, { files: [] })).answer,
      true
    )
    assert.equal(
      (await decide({ EVENT: 'push', BEFORE: 'main' }, { files: [] })).answer,
      true
    )
    const broken = await pushChanges({
      env: { EVENT: 'push', BEFORE: before },
      run: () => {
        throw new Error('fetch failed')
      },
    })
    assert.equal(broken, true)
  })
})
