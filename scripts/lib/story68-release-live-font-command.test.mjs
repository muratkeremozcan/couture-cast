// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import { prebuildArgs } from './story68-native-build.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { describe, test } from 'node:test'
import { runReleaseLiveFontCommand } from './story68-release-live-font-command.mjs'
import {
  RESTORE_DEADLINE_MS,
  adapterFixture,
  app,
  configuration,
} from './story68-release-live-font-fixtures.mjs'

describe('Release live-font command adapter', () => {
  test('actual adapter bounds commands, preserves explicit device and keeps raw diagnostics in private files', async () => {
    const remainingMs = 11900
    const f = adapterFixture(async (_config, io) => {
      await io.avdName()
      await io.shell(['pidof', app])
      await io.hierarchy(remainingMs)
      await io.recordTree('after', { private: 'source-label' })
      await io.recordLog('private process log')
      await io.screenshot()
      return { passed: true, platform: 'android', originalFontRestored: true }
    })
    await f.invoke()
    assert.ok(
      f.processes.every(
        ({ args, options }) =>
          args.includes('emulator-5584') &&
          options.timeout > 0 &&
          options.timeout <= RESTORE_DEADLINE_MS &&
          options.detached &&
          options.killSignal === 'SIGKILL'
      )
    )
    const hierarchy = f.processes.find(({ args }) => args.includes('hierarchy'))
    assert.equal(hierarchy.options.timeout, remainingMs)
    assert.equal(f.records[0].record.passed, false)
    assert.equal(f.records.at(-1).record.passed, true)
    assert.ok(
      f.records.every(({ name }) => name === 'native-release-live-font-android.json')
    )
    assert.equal(JSON.stringify(f.records).includes('source-label'), false)
    // Exactly the tree, log and screenshot land in the owned runtime directory, so the
    // private-mode check below cannot pass over an empty write list.
    assert.deepEqual(
      f.writes.map(({ name }) => name),
      [
        '/owned/runtime/release-live-font-after-private.json',
        '/owned/runtime/release-live-font-logcat-private.log',
        '/owned/runtime/release-live-font-after-private.png',
      ]
    )
    assert.ok(
      f.writes.every(
        ({ name, options }) => name.includes('-private.') && options.mode === 0o600
      )
    )
  })

  test('actual adapter timeout kills only its owned process group and publishes a closed failure', async () => {
    const f = adapterFixture(
      async (_config, io) => io.hierarchy(RESTORE_DEADLINE_MS),
      true
    )
    await assert.rejects(f.invoke(), /release_font_native_command_failed/)
    assert.deepEqual(f.kills, [[-4321, 'SIGKILL']])
    const record = JSON.parse(JSON.stringify(f.records.at(-1).record))
    assert.deepEqual(record, {
      platform: 'android',
      configuration: 'Release',
      passed: false,
      code: 'release_font_native_command_failed',
    })
    assert.equal(JSON.stringify(f.records).includes('private diagnostic'), false)
  })

  test('both baseline and after adapters retain the Maestro driver within the original capture budgets', async () => {
    const remainingMs = 11900
    const f = adapterFixture(async (_config, io) => {
      await io.hierarchy(RESTORE_DEADLINE_MS, 'before')
      await io.hierarchy(remainingMs, 'after')
      return { passed: true }
    })
    await f.invoke()
    assert.deepEqual(
      f.processes.map(({ args }) => args),
      [
        ['--device', 'emulator-5584', 'hierarchy', '--no-reinstall-driver'],
        ['--device', 'emulator-5584', 'hierarchy', '--no-reinstall-driver'],
      ]
    )
    assert.deepEqual(
      f.processes.map(({ options }) => options.timeout),
      [RESTORE_DEADLINE_MS, remainingMs]
    )
  })

  test('each attempt removes only fixed owned artifacts before an early proof failure can leave stale trees', async () => {
    const failure = new Error('early_guard_failure')
    const f = adapterFixture(async () => {
      assert.equal(f.removals.length, 6)
      throw failure
    })
    await assert.rejects(f.invoke(), (error) => error === failure)
    const expected = [
      'release-live-font-before-private.json',
      'release-live-font-after-private.json',
      'release-live-font-before-private.png',
      'release-live-font-after-private.png',
      'release-live-font-logcat-private.log',
      'release-live-font-command-error-private.log',
    ]
    assert.deepEqual(
      f.removals.map(({ name }) => path.basename(name)).sort(),
      expected.sort()
    )
    assert.ok(
      f.removals.every(
        ({ name, options }) =>
          path.dirname(name) === '/owned/runtime' && options.force && !options.recursive
      )
    )
    assert.equal(f.records[0].record.passed, false)
    assert.equal(f.records.at(-1).record.passed, false)
  })

  test('native timeout retains rich private diagnostics without copying them into the closed result', async () => {
    const f = adapterFixture(
      async (_config, io) => io.hierarchy(RESTORE_DEADLINE_MS, 'after'),
      true
    )
    await assert.rejects(f.invoke(), /release_font_native_command_failed/)
    const diagnostic = JSON.parse(
      f.writes.find(({ name }) =>
        name.endsWith('release-live-font-command-error-private.log')
      ).data
    )
    assert.equal(diagnostic.error.code, 'ETIMEDOUT')
    assert.equal(diagnostic.durationMs, 23)
    assert.equal(diagnostic.status, null)
    assert.equal(diagnostic.stderr, 'private diagnostic')
    assert.ok(diagnostic.args.includes('--no-reinstall-driver'))
    assert.equal(JSON.stringify(f.records).includes('private diagnostic'), false)
  })

  test('the real shell adapter receives the remaining app-configuration observation deadline', async () => {
    const f = adapterFixture(async (_config, io) => {
      await io.shell(['dumpsys', 'activity', 'top', '-a'], 427)
      return { passed: true }
    })
    await f.invoke()
    assert.equal(f.processes.length, 1)
    assert.equal(f.processes[0].options.timeout, 427)
    assert.deepEqual(f.processes[0].args.slice(-5), [
      'shell',
      'dumpsys',
      'activity',
      'top',
      '-a',
    ])
  })

  test('real attempt entry removes stale owned trees even on a runtime guard failure and preserves unrelated evidence', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-release-attempt-'))
    try {
      const stale = ['before', 'after'].flatMap((stage) =>
        ['json', 'png'].map(
          (extension) => `release-live-font-${stage}-private.${extension}`
        )
      )
      for (const file of [
        ...stale,
        'release-live-font-logcat-private.log',
        'release-live-font-command-error-private.log',
        'unrelated-evidence-private.json',
      ])
        fs.writeFileSync(path.join(directory, file), 'previous attempt')
      fs.writeFileSync(path.join(directory, 'app.apk'), 'owned test fixture')
      fs.writeFileSync(path.join(directory, 'api.log'), configuration().runtime.apiLog)
      const runtime = configuration().runtime
      await assert.rejects(
        runReleaseLiveFontCommand({
          platform: 'ios',
          appId: app,
          device: 'emulator-5584',
          root: process.cwd(),
          directory,
          apkPath: path.join(directory, 'app.apk'),
          read: (file) =>
            ({
              'owned-env.json': runtime.environment,
              'public-build-env.json': runtime.build,
              'resources.json': runtime.resources,
            })[file],
          privateJson: (file, value) =>
            fs.writeFileSync(path.join(directory, file), JSON.stringify(value)),
        }),
        /owned_release_font_target_required/
      )
      for (const file of stale)
        assert.equal(fs.existsSync(path.join(directory, file)), false)
      assert.equal(
        fs.readFileSync(path.join(directory, 'unrelated-evidence-private.json'), 'utf8'),
        'previous attempt'
      )
      assert.equal(
        JSON.parse(
          fs.readFileSync(
            path.join(directory, 'native-release-live-font-android.json'),
            'utf8'
          )
        ).passed,
        false
      )
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('Release live-font failure code in the job log', () => {
  // The sandbox's closed set is the adapter fixture's: the native command code only.
  for (const [name, message, code] of [
    [
      'a closed failure',
      'release_font_native_command_failed',
      'release_font_native_command_failed',
    ],
    ['an unexpected error', '/owned/private/path', 'release_live_font_failed'],
  ])
    test(`${name} logs only its closed code`, async () => {
      const error = new Error(message)
      const f = adapterFixture(async () => {
        throw error
      })
      await assert.rejects(f.invoke(), (thrown) => thrown === error)
      assert.equal(f.records.at(-1).record.code, code)
      assert.deepEqual(f.logs, [
        JSON.stringify({ releaseLiveFont: { passed: false, code } }),
      ])
      assert.doesNotMatch(f.logs.join('\n'), /owned|private/)
    })
})

describe('Release live-font native runner commands', () => {
  test('actual prebuild passes clean only when requested and preserves externally scoped proof input', () => {
    const source = fs.readFileSync('scripts/run-story68-native.mjs', 'utf8')
    const marker = "if (command === 'prebuild') {"
    const start = source.indexOf(marker) + marker.length
    const end = source.indexOf("} else if (command === 'build')", start)
    for (const clean of [undefined, 'yes']) {
      let observed
      vm.runInNewContext(`(() => {${source.slice(start, end)}})()`, {
        ownedEnv: () => undefined,
        prebuildArgs,
        read: () => ({ STORY68_NATIVE_TEST_BUILD: '1' }),
        option: (name) => (name === 'clean' ? clean : undefined),
        path,
        root: '/owned/repo',
        directory: '/owned/runtime',
        platform: 'android',
        process: { env: { CC68_RELEASE_PROOF_LOOPBACK: '1' } },
        fs: { openSync: () => 1, closeSync: () => undefined },
        spawnSync: (binary, args, options) => {
          observed = { binary, args: Array.from(args), options }
          return { status: 0 }
        },
      })
      assert.equal(observed.args.includes('--clean'), clean === 'yes')
      assert.equal(observed.options.env.CC68_RELEASE_PROOF_LOOPBACK, '1')
      assert.equal(observed.options.env.STORY68_NATIVE_TEST_BUILD, '1')
    }
  })

  test('actual command preflight replaces an older passing record before a runtime guard can fail', async () => {
    const source = fs.readFileSync('scripts/run-story68-native.mjs', 'utf8')
    const marker = "} else if (command === 'release-live-font') {"
    const start = source.indexOf(marker) + marker.length
    const end = source.indexOf("} else if (command === 'fallback-focus')", start)
    const records = [{ passed: true }]
    const failure = new Error('owned_database_required')
    const execution = vm.runInNewContext(
      `(async () => {${source.slice(start, end)}})()`,
      {
        privateJson: (name, record) => {
          assert.equal(name, 'native-release-live-font-android.json')
          records.push(record)
        },
        requireDevice: () => {
          throw failure
        },
        runReleaseLiveFontCommand: () =>
          assert.fail('guard must fail before native proof'),
      }
    )
    await assert.rejects(execution, (error) => error === failure)
    assert.equal(records.at(-1).passed, false)
  })
})
