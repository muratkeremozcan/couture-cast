// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import {
  prepareWorkletsStaging,
  verifyWorkletsStaging,
} from './story68-worklets-staging.mjs'
import vm from 'node:vm'
import {
  IOS_DERIVED_DATA,
  buildSelection,
  nativeBuildCommand,
  nativeBuildEnv,
  nativeProjectDirectory,
} from './story68-native-build.mjs'
import { LOCALES } from '../ci/native-ios-shards.mjs'
import { describe, test } from 'node:test'
import { talkbackFailureSummary } from './story68-talkback-failure.mjs'
import {
  bundleBuilds,
  focusLatencies,
  talkBackVersion,
  talkbackEvidence,
} from './story68-talkback-evidence.mjs'

describe('TalkBack driver handoff', () => {
  for (const initiallyEnabled of [false, true]) {
    test(`waits for TalkBack after Maestro and restores enabled=${initiallyEnabled}`, () => {
      const source = fs.readFileSync('scripts/run-story68-native.mjs', 'utf8')
      const marker = "} else if (command === 'a11y' && platform === 'android') {"
      const start = source.indexOf(marker) + marker.length
      const end = source.indexOf("} else if (command === 'a11y'", start)
      const previousService = initiallyEnabled ? 'owned.reader/Service' : 'null'
      let touchExploration = initiallyEnabled
      let modalOpen = true
      let instrumented = false
      const restored = new Map()
      const logs = []
      vm.runInNewContext(`(() => {${source.slice(start, end)}})()`, {
        // Globals and imports the extracted a11y branch uses; the real modules, not stubs.
        performance,
        console: { log: (line) => logs.push(line) },
        bundleBuilds,
        focusLatencies,
        talkBackVersion,
        talkbackEvidence,
        talkbackFailureSummary,
        requireDevice: () => undefined,
        activeLocale: 'en-US',
        platform: 'android',
        read: () => ({}),
        device: 'owned-device',
        adb: '/owned/adb',
        appId: 'com.couturecast.story68',
        root: '/owned/repo',
        directory: '/owned/runtime',
        path,
        process: { env: {} },
        fs: { writeFileSync: () => undefined },
        privateJson: () => undefined,
        openUrl: () => undefined,
        maestro: (flow) => {
          if (flow.endsWith('/set-locale.yaml'))
            assert.equal(modalOpen, false, 'Cold launch must clear a prior failed modal')
          touchExploration = false
        },
        run: (binary, args) => {
          if (args.includes('force-stop') && args.includes('com.couturecast.story68'))
            modalOpen = false
          if (binary === 'bash' && args[1] === 'enable') touchExploration = true
          if (args.includes('instrument')) {
            assert.equal(touchExploration, true, 'TalkBack must recover from Maestro')
            instrumented = true
            return 'OK (2 tests)'
          }
          if (args.includes('settings')) {
            const [, operation, , key, value] = args.slice(args.indexOf('settings'))
            if (operation === 'get')
              return key === 'enabled_accessibility_services'
                ? previousService
                : initiallyEnabled
                  ? '1'
                  : '0'
            restored.set(key, operation === 'delete' ? 'null' : value)
          }
          return ''
        },
      })
      assert.equal(instrumented, true)
      // The closed evidence is printed on a passing run too, and no failure summary is.
      assert.equal(logs.filter((line) => line.includes('talkbackEvidence')).length, 1)
      assert.equal(
        logs.some((line) => line.includes('talkbackComposer')),
        false
      )
      assert.equal(restored.get('enabled_accessibility_services'), previousService)
      assert.equal(restored.get('accessibility_enabled'), initiallyEnabled ? '1' : '0')
    })
  }
})

describe('original-resource proof', () => {
  for (const platform of ['android', 'ios']) {
    test(`actual ${platform} original-resource proof returns a tab-ready app for the matrix`, async () => {
      const source = fs.readFileSync('scripts/run-story68-native.mjs', 'utf8')
      const marker = "} else if (command === 'proof') {"
      const start = source.indexOf(marker) + marker.length
      const end = source.indexOf("} else if (command === 'matrix')", start)
      let dialogOpen = false
      let extracted = false
      const events = []
      const context = {
        requireDevice: () => undefined,
        platform,
        adb: '/owned/adb',
        device: 'owned-device',
        appId: 'com.couturecast.story68',
        directory: '/owned/runtime',
        process: { execPath: '/owned/node' },
        fileURLToPath: () => '/owned/run-story68-native.mjs',
        openUrl: () => undefined,
        nativeOriginalPaths: () => [],
        iosPhotoPermissions: () => ({ read: 0, addOnly: 1 }),
        assertIosReadDenied: () => events.push('read-denied-verified'),
        privateJson: () => undefined,
        read: () => ({}),
        captureApproved: () => events.push('approved'),
        previewDigest: () => 'a'.repeat(64),
        openOsSettings: () => {
          events.push('settings-opened')
          return { foregroundMarkers: [] }
        },
        IOS_RETRYABLE_DENIAL_EVIDENCE: 'restricted adapter response',
        console: { log: () => undefined },
        run: (_binary, args) => {
          if (args.includes('extract')) {
            extracted = true
            events.push('extracted')
          }
          return args.includes('getprop') ? '36' : ''
        },
        maestro: (flow) => {
          events.push(flow)
          if (flow.endsWith('/open-outfit.yaml')) dialogOpen = true
          if (flow.endsWith('/cancel.yaml')) {
            assert.equal(extracted, true, 'extract real saved resource before dismissal')
            if (platform === 'ios') assert.equal(events.at(-2), 'read-denied-verified')
            dialogOpen = false
          }
          if (flow.endsWith('/set-locale.yaml') && dialogOpen)
            throw new Error('matrix_tab_bar_occluded')
        },
      }
      const proof = source
        .slice(start, end)
        .replaceAll('import.meta.url', "'file:///owned/runner.mjs'")
      await vm.runInNewContext(`(async () => {${proof}})()`, context)
      assert.equal(extracted, true)
      assert.equal(dialogOpen, false, 'completed proof must leave tabs reachable')
      const matrixStart = end + "} else if (command === 'matrix') {".length
      const matrixSetupEnd = source.indexOf(
        "  if (inMatrixSection(plan, shard, 'pre-locale')) {",
        matrixStart
      )
      const setup = source
        .slice(matrixStart, matrixSetupEnd)
        .replaceAll('import.meta.url', "'file:///owned/runner.mjs'")
      vm.runInNewContext(`(() => {${setup}})()`, {
        ...context,
        activeLocale: 'en-US',
        option: () => undefined,
        parseShard: () => undefined,
      })
      assert.equal(events.at(-1), 'maestro/story65/set-locale.yaml')
    })
  }
})

describe('native matrix retry resource accounting', () => {
  for (const importedDuringRetry of [null, 'cache_failure', 'storage', 'offline']) {
    test(`Retry ${importedDuringRetry ? `rejects an import during ${importedDuringRetry}` : 'preserves the pre-Save baseline for all failure modes'}`, () => {
      const source = fs.readFileSync('scripts/run-story68-native.mjs', 'utf8')
      const start = source.indexOf(
        "for (const mode of ['cache_failure', 'storage', 'offline'])"
      )
      const end = source.indexOf("fixture('real')\n    close()", start)
      assert.ok(start >= 0 && end > start)
      const guardStart = source.indexOf('  const assertUnchanged = (before) => {')
      const guardEnd = source.indexOf('  const extract = ', guardStart)
      assert.ok(guardStart >= 0 && guardEnd > guardStart)
      const resources = []
      const captures = []
      const extracts = []
      let failureMode
      const execute = () =>
        vm.runInNewContext(
          `(() => {
        let before;
        ${source.slice(guardStart, guardEnd)}
        ${source.slice(start, end)}
      })()`,
          {
            originals: () => JSON.stringify(resources),
            fixture: (mode) => {
              if (mode !== 'real') failureMode = mode
            },
            readLocale: () => ({ shareCard: { offline: 'offline', storage: 'storage' } }),
            maestro: (flow) => {
              if (flow.endsWith('/retry.yaml') && failureMode === importedDuringRetry)
                resources.push('unexpected-retry-photo.png')
              if (flow.endsWith('/save.yaml')) resources.push(`saved-${failureMode}.png`)
            },
            captureApproved: () => captures.push(failureMode),
            extract: (name) => extracts.push(name),
            mark: () => undefined,
          }
        )
      if (importedDuringRetry) {
        assert.throws(execute, { message: 'unexpected_native_import' })
        assert.equal(captures.includes(importedDuringRetry), false)
        assert.equal(extracts.includes(`retry-${importedDuringRetry}`), false)
      } else {
        execute()
        assert.deepEqual(captures, ['cache_failure', 'storage', 'offline'])
        assert.deepEqual(extracts, [
          'retry-cache_failure',
          'retry-storage',
          'retry-offline',
        ])
      }
    })
  }
})

describe('owned Play emulator', () => {
  test('owned Play emulator and CI allocate 4GiB while retaining existing user data', () => {
    const source = fs.readFileSync('scripts/run-story68-native.mjs', 'utf8')
    const marker = "} else if (command === 'emulator') {"
    const start = source.indexOf(marker) + marker.length
    const end = source.indexOf("} else if (command === 'open')", start)
    let observed
    vm.runInNewContext(`(() => {${source.slice(start, end)}})()`, {
      ownedEnv: () => undefined,
      option: (name) => ({ avd: 'cc68-api36', port: '5584' })[name],
      assertOwnedStory68EmulatorPort: () => undefined,
      path,
      directory: '/owned/runtime',
      process: { pid: 123, env: { HOME: '/owned/home' }, once: () => undefined },
      child: (binary, args) => {
        observed = { binary, args: Array.from(args) }
        return { pid: 456, once: () => undefined }
      },
      privateJson: () => undefined,
      console: { log: () => undefined },
    })
    assert.equal(observed.args[observed.args.indexOf('-memory') + 1], '4096')
    assert.equal(observed.args[observed.args.indexOf('-gpu') + 1], 'swiftshader_indirect')
    assert.equal(observed.args.includes('-wipe-data'), false)
    const workflow = fs.readFileSync('.github/workflows/pr-share-card-native.yml', 'utf8')
    assert.match(workflow, /ram-size:\s*4096M/)
  })
})

describe('Android build environment', () => {
  test('actual Android build preserves SDK selection, stages the selected variant and verifies postbuild hashes', () => {
    const source = fs.readFileSync('scripts/run-story68-native.mjs', 'utf8')
    const marker = "} else if (command === 'build') {"
    const start = source.indexOf(marker) + marker.length
    const end = source.indexOf('\n} else if', start)
    for (const explicit of [undefined, '/explicit/android-sdk']) {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-build-env-unit-'))
      try {
        fs.mkdirSync(path.join(directory, 'apps/mobile/android'), { recursive: true })
        let observed
        let selected
        const events = []
        vm.runInNewContext(`(() => {${source.slice(start, end)}})()`, {
          ownedEnv: () => undefined,
          option: () => undefined,
          path,
          fs: { openSync: () => 1, closeSync: () => undefined },
          directory,
          platform: 'android',
          root: directory,
          adb: '/owned/android-sdk/platform-tools/adb',
          process: { arch: 'arm64', env: explicit ? { ANDROID_HOME: explicit } : {} },
          read: () => ({ STORY68_NATIVE_TEST_BUILD: '1' }),
          IOS_DERIVED_DATA,
          buildSelection,
          nativeBuildCommand,
          nativeBuildEnv,
          nativeProjectDirectory,
          prepareWorkletsStaging: (input) => {
            events.push('prepare')
            selected = prepareWorkletsStaging(input)
            return selected
          },
          verifyWorkletsStaging: (plan) => {
            events.push('verify')
            assert.equal(plan, selected)
            return verifyWorkletsStaging(plan)
          },
          spawnSync: (_binary, args, options) => {
            events.push('build')
            observed = options.env
            assert.deepEqual(Array.from(args.slice(1, 3)), selected.args)
            assert.ok(fs.readFileSync(args[2], 'utf8').includes('externalNativeBuild'))
            assert.ok(args.includes('-PreactNativeArchitectures=arm64-v8a'))
            const workletsProject = path.join(
              selected.projectRoot,
              'react-native-worklets'
            )
            const compiled = path.join(
              workletsProject,
              'build/intermediates/cxx/Debug/current/obj/arm64-v8a/libworklets.so'
            )
            const legacyImported = path.join(
              workletsProject,
              'build/intermediates/cmake/debug/obj/arm64-v8a/libworklets.so'
            )
            for (const binary of [compiled, legacyImported]) {
              fs.mkdirSync(path.dirname(binary), { recursive: true })
              fs.writeFileSync(binary, 'compiled-selected-worklets')
            }
            const sha256 = createHash('sha256')
              .update('compiled-selected-worklets')
              .digest('hex')
            fs.writeFileSync(
              selected.proofs[0],
              JSON.stringify({
                projectRoot: selected.projectRoot,
                workletsProject,
                configuration: 'Debug',
                architecture: 'arm64-v8a',
                compiled,
                legacyImported,
                compiledSha256: sha256,
                legacyImportedSha256: sha256,
              })
            )
            return { status: 0 }
          },
        })
        assert.equal(observed.ANDROID_HOME, explicit ?? '/owned/android-sdk')
        assert.deepEqual(events, ['prepare', 'build', 'verify'])
      } finally {
        fs.rmSync(directory, { recursive: true, force: true })
      }
    }
  })
})

describe('Maestro driver port', () => {
  for (const flow of ['maestro', 'rapidWatermarkFlow']) {
    for (const platform of ['android', 'ios']) {
      test(`actual ${flow} ${platform} launch pins only Android outside the device ephemeral range`, async () => {
        const source = fs.readFileSync('scripts/run-story68-native.mjs', 'utf8')
        const start = source.indexOf(`function ${flow}(`)
        const end = source.indexOf(
          flow === 'maestro'
            ? '\nasync function signin('
            : "\nif (command === 'prebuild')",
          start
        )
        let observed
        const stopped = new Error('launch_observed')
        const capture = (_binary, args) => {
          observed = Array.from(args)
          throw stopped
        }
        const context = {
          platform,
          path,
          directory: '/owned/runtime',
          root: '/owned/repo',
          device: 'owned-device',
          appId: 'owned.app',
          maestroBinary: 'maestro',
          requireDevice: () => undefined,
          reverse: () => undefined,
          withNativeTransport: (work) => work(),
          localeEnv: () => ({}),
          process: { env: {} },
          fs: { mkdirSync: () => undefined, openSync: () => 1, existsSync: () => false },
          privateJson: () => undefined,
          summarizeNativeFlowFailure: () => ({}),
          closedRapidWatermarkFailure: () => 'native_rapid_watermark_failed',
          redactRapidWatermarkControl: () => undefined,
          recordIosCommandTimings: () => undefined,
          spawnSync: capture,
          spawn: capture,
          flowTimeoutMs: () => 120_000,
          spawnIosFlow: capture,
          nativeFlowTimeoutMs: () => 120_000,
          logSize: () => 0,
          recordIosFlowTiming: () => undefined,
          recordIosFlowProgress: () => undefined,
          scheduleIosInFlowSample: () => false,
          inMatrixSection: () => true,
          localesForShard: () => [...LOCALES],
          parseShard: () => undefined,
          iosDriverGlobalArgs: () => [],
          iosDriverTestArgs: () => [],
          recordIosDriverFlow: () => null,
          MAESTRO_ANDROID_DRIVER_PORT: 17001,
          DRIVER_HOST_PORT_ARG: '--driver-host-port',
          signal: new AbortController().signal,
          control: {},
        }
        const invoke = () =>
          vm.runInNewContext(
            `(${source.slice(start, end)})(${flow === 'maestro' ? '"maestro/story68/cancel.yaml"' : 'signal, control'})`,
            context
          )
        if (flow === 'maestro') assert.throws(invoke, (error) => error === stopped)
        else await assert.rejects(invoke(), (error) => error === stopped)
        const index = observed.indexOf('--driver-host-port')
        if (platform === 'android') {
          assert.equal(index, observed.indexOf('test') + 1)
          assert.equal(observed[index + 1], '17001')
          assert.ok(Number(observed[index + 1]) < 32768)
        } else assert.equal(index, -1)
      })
    }
  }
})
