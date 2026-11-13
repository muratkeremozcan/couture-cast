// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
// Story 6.15 SL-11: package-lock.json and the root package.json are shared by every workspace, so
// a change to them is a native iOS change only when it touches what apps/mobile installs, or a
// root field or script an iOS run reads. An Expo bump or a native dependency under mobile must
// count; a web-only or API-only bump must not.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import {
  IOS_NATIVE_WORKFLOW,
  LOCKFILE,
  ROOT_MANIFEST,
  dependencyChanges,
  mobileClosure,
  mobileLockChanges,
  nativeIosChanges,
  pushChanges,
  pushPaths,
  rootManifestChanges,
  rootScriptsRun,
} from './ios-native-inputs.mjs'

const workflowText = fs.readFileSync(IOS_NATIVE_WORKFLOW, 'utf8')
const inputs = pushPaths(workflowText)
const clone = (value) => JSON.parse(JSON.stringify(value))

// A small lockfile of the shape npm writes: three workspaces, a linked shared package, hoisted
// and nested installs.
const lock = {
  lockfileVersion: 3,
  packages: {
    '': {
      name: 'root',
      workspaces: ['apps/*', 'packages/*'],
      devDependencies: { eslint: '^9' },
    },
    'apps/mobile': {
      dependencies: { expo: '^58.0.0', react: '19.1.0', '@couture/utils': '*' },
      devDependencies: { 'jest-expo': '^58.0.0' },
    },
    'apps/web': { dependencies: { next: '^15', react: '19.1.0', '@couture/utils': '*' } },
    'apps/api': { dependencies: { '@nestjs/core': '^11' } },
    'packages/utils': { dependencies: { zod: '^3' } },
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
  },
}
const bump = (key, patch) => {
  const next = clone(lock)
  next.packages[key] = { ...next.packages[key], ...patch }
  return next
}

describe('what apps/mobile installs, from the lockfile alone', () => {
  test('the workspace, what it resolves, nested installs first, and linked workspaces', () => {
    assert.deepEqual([...mobileClosure(lock)].sort(), [
      'apps/mobile',
      'node_modules/@couture/utils',
      'node_modules/expo',
      'node_modules/expo-modules-core',
      'node_modules/expo/node_modules/babel-preset-expo',
      'node_modules/jest-expo',
      'node_modules/react',
      'node_modules/zod',
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
    'a new dependency of the mobile workspace': bump('apps/mobile', {
      dependencies: {
        ...lock.packages['apps/mobile'].dependencies,
        'expo-camera': '^17',
      },
    }),
  }
  for (const [name, after] of Object.entries(fires))
    test(`${name} counts`, () => {
      assert.ok(mobileLockChanges(lock, after).length > 0, name)
    })

  const quiet = {
    'a web-only bump': (() => {
      const after = bump('node_modules/next', { version: '15.5.1' })
      after.packages['node_modules/styled-jsx'].version = '5.1.7'
      after.packages['apps/web'].dependencies.next = '^15.5.1'
      return after
    })(),
    'an API-only bump': (() => {
      const after = bump('node_modules/@nestjs/core', { version: '11.2.1' })
      after.packages['apps/api'].dependencies['@nestjs/core'] = '^11.2.1'
      return after
    })(),
    'a root development tool bump': bump('node_modules/eslint', { version: '9.1.0' }),
    'the hoisted copy mobile does not resolve': bump('node_modules/babel-preset-expo', {
      version: '54.0.1',
    }),
  }
  for (const [name, after] of Object.entries(quiet))
    test(`${name} does not count`, () => {
      assert.deepEqual(mobileLockChanges(lock, after), [], name)
    })

  test('a dependency mobile drops counts, since it was installed before', () => {
    const after = clone(lock)
    delete after.packages['node_modules/expo-modules-core']
    delete after.packages['node_modules/expo'].dependencies['expo-modules-core']
    assert.deepEqual(mobileLockChanges(lock, after), [
      'node_modules/expo',
      'node_modules/expo-modules-core',
    ])
  })

  test('a lockfile this cannot read counts as unknown', () => {
    assert.equal(mobileLockChanges(lock, { lockfileVersion: 1, dependencies: {} }), null)
    assert.equal(mobileLockChanges(null, lock), null)
  })

  test('the repository lockfile: mobile installs Expo and React Native, never Next or Nest', () => {
    const closure = mobileClosure(JSON.parse(fs.readFileSync(LOCKFILE, 'utf8')))
    for (const key of [
      'node_modules/expo',
      'node_modules/react-native',
      'packages/utils',
    ])
      assert.ok(closure.has(key), key)
    for (const key of [
      'node_modules/next',
      'node_modules/@nestjs/core',
      'apps/web',
      'apps/api',
    ])
      assert.ok(!closure.has(key), key)
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
        workflowText,
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

  test('a web script or a root dependency does not count; the lockfile decides dependencies', () => {
    assert.deepEqual(
      change({ scripts: { ...root.scripts, 'lint:web': 'eslint apps/web' } }),
      []
    )
    assert.deepEqual(change({ devDependencies: { eslint: '^10' } }), [])
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
      workflowText
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
      workflowText
    )
    assert.deepEqual(
      nativeIosChanges([LOCKFILE, 'apps/mobile/package.json'], inputs, expo),
      [LOCKFILE, 'apps/mobile/package.json']
    )
  })

  test('an unreadable side counts', async () => {
    const unknown = await dependencyChanges(
      read({ before: {}, after: contents(lock) }),
      workflowText
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

  test('the push paths parse the same without a YAML parser', () => {
    assert.deepEqual(inputs, parse(workflowText).on.push.paths)
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
    const answer = await pushChanges({ env, run })
    return { answer, calls }
  }
  const sides = (after) => ({
    before: { [LOCKFILE]: JSON.stringify(lock), [ROOT_MANIFEST]: '{}' },
    after: { [LOCKFILE]: JSON.stringify(after), [ROOT_MANIFEST]: '{}' },
  })

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
