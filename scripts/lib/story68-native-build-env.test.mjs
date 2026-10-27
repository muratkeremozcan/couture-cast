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
import { describe, test } from 'node:test'

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
        '  const beforePreparation = originals()',
        matrixStart
      )
      const setup = source
        .slice(matrixStart, matrixSetupEnd)
        .replaceAll('import.meta.url', "'file:///owned/runner.mjs'")
      vm.runInNewContext(`(() => {${setup}})()`, {
        ...context,
        activeLocale: 'en-US',
      })
      assert.equal(events.at(-1), 'maestro/story65/set-locale.yaml')
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
          maestroBinary: 'maestro',
          requireDevice: () => undefined,
          reverse: () => undefined,
          withNativeTransport: (work) => work(),
          localeEnv: () => ({}),
          process: { env: {} },
          fs: { mkdirSync: () => undefined, openSync: () => 1, existsSync: () => false },
          privateJson: () => undefined,
          summarizeNativeFlowFailure: () => ({}),
          redactRapidWatermarkControl: () => undefined,
          spawnSync: capture,
          spawn: capture,
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
