import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  proveReleaseLiveFont,
  assertReleaseTextPreserved,
} from './story68-release-live-font.mjs'
import { runReleaseLiveFontCommand } from './story68-release-live-font-command.mjs'

const app = 'com.couturecast.story68'
const sha = 'a'.repeat(64)
const database = `tea_community_${'b'.repeat(32)}`
function configuration() {
  return {
    platform: 'android',
    device: 'emulator-5584',
    appId: app,
    apkSha256: sha,
    runtime: {
      environment: {
        DATABASE_URL: `postgresql://x@127.0.0.1:54322/${database}`,
        API_BASE_URL: 'http://127.0.0.1:4088',
        SUPABASE_URL: 'http://127.0.0.1:54321',
      },
      build: {
        STORY68_NATIVE_TEST_BUILD: '1',
        EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4088',
        EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:53068',
      },
      resources: {
        owner: 'cc68-impl',
        database,
        createdDatabase: true,
        apiPort: 4088,
        authProxyPort: 53068,
      },
      apiLog: JSON.stringify({ code: 'owned_database_verified', database }),
    },
    clientCatalog: { shareCard: { title: 'Your share card' } },
    renderCatalog: {
      outfit: 'Outfit',
      scenarios: { morning: 'Morning' },
      categories: { top: 'Top', bottom: 'Bottom', shoes: 'Shoes' },
    },
  }
}
function tree({
  height = 92,
  previewId = 'share-card-preview-loaded',
  title = 'Your share card',
  label = 'Outfit. Morning. Top. Bottom. Shoes. CoutureCast',
  checked = 'false',
} = {}) {
  return {
    children: [
      {
        attributes: {
          'resource-id': 'share-card-title',
          text: title,
          bounds: `[63,170][1017,${170 + height}]`,
        },
      },
      { attributes: { 'resource-id': previewId, accessibilityText: label } },
      { attributes: { 'resource-id': 'share-card-watermark', checked } },
    ],
  }
}
function fixture(overrides = {}) {
  const events = []
  let live = false
  let time = 0
  const io = {
    avdName: async () => 'cc68-api36\nOK\n',
    shell: async (args) => {
      const command = args.join(' ')
      events.push(command)
      if (command === 'settings put system font_scale 1.5') live = true
      if (command === 'getprop ro.build.version.sdk') return '36'
      if (command === `dumpsys package ${app}`)
        return `Package [${app}]\nflags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]`
      if (command === `pm path ${app}`) return 'package:/data/app/~~owned/app/base.apk'
      if (command.startsWith('toybox sha256sum'))
        return `${sha}  /data/app/~~owned/app/base.apk`
      if (command === 'settings get system font_scale') return '1.2'
      if (command === `pidof ${app}`) return '12345'
      return ''
    },
    maestro: async (flow) => events.push(`flow ${flow}`),
    hierarchy: async () => tree({ height: live ? 138 : 92 }),
    recordTree: async (stage) => events.push(`private ${stage}`),
    logcat: async () => '',
    recordLog: async () => events.push('private log'),
    screenshot: async () => events.push('private screenshot'),
    now: () => time,
    pause: async (ms) => {
      time += ms
    },
    ...overrides,
  }
  return { io, events, now: () => time }
}

test('empty installed package evidence fails before any app or font mutation', async () => {
  const f = fixture()
  const shell = f.io.shell
  f.io.shell = (args) => (args[0] === 'dumpsys' ? '' : shell(args))
  await assert.rejects(
    proveReleaseLiveFont(configuration(), f.io),
    /non_debuggable_release_required/
  )
  assert.equal(
    f.events.some((event) => /force-stop|settings put/.test(event)),
    false
  )
})

test('actual proof changes font live only after exact production OFF state and cold-restores before success', async () => {
  const f = fixture()
  const result = await proveReleaseLiveFont(configuration(), f.io)
  assert.equal(result.passed, true)
  assert.equal(result.beforeTitleHeight, 92)
  assert.equal(result.afterTitleHeight, 138)
  const baseline = f.events.indexOf('settings put system font_scale 1.0')
  assert.equal(f.events[baseline - 1], `am force-stop ${app}`)
  const live = f.events.indexOf('settings put system font_scale 1.5')
  assert.ok(live > f.events.indexOf('private before'))
  assert.equal(
    f.events.slice(baseline + 1, live).some((event) => event.includes('force-stop')),
    false
  )
  assert.deepEqual(f.events.slice(-2), [
    `am force-stop ${app}`,
    'settings put system font_scale 1.2',
  ])
  assert.deepEqual(
    f.events.filter((event) => event.startsWith('flow ')),
    [
      'flow maestro/story65/set-locale.yaml',
      'flow maestro/story68/release-open-outfit.yaml',
      'flow maestro/story68/release-watermark-off.yaml',
    ]
  )
  assert.equal(result.originalFontRestored, true)
  assert.equal(
    Object.values(result).some((value) => typeof value === 'object'),
    false
  )
  assert.equal(JSON.stringify(result).includes('Outfit. Morning'), false)
})

test('Release proof supplies the exact locale required by the real Settings fragment', async () => {
  const f = fixture()
  const maestro = f.io.maestro
  f.io.maestro = async (flow, env) => {
    if (flow === 'maestro/story65/set-locale.yaml') {
      assert.deepEqual(env, { MAESTRO_LOCALE: 'en-US' })
    }
    return maestro(flow)
  }
  assert.equal((await proveReleaseLiveFont(configuration(), f.io)).passed, true)
})

for (const [name, mutate, code] of [
  [
    'wrong owned runtime',
    (config) => {
      config.runtime.environment.DATABASE_URL = 'postgresql://x@127.0.0.1/postgres'
    },
    /owned_uuid_loopback_database_required/,
  ],
  [
    'wrong app',
    (config) => {
      config.appId = 'com.other.app'
    },
    /owned_release_font_target_required/,
  ],
  [
    'implicit device',
    (config) => {
      config.device = undefined
    },
    /owned_release_font_target_required/,
  ],
  [
    'remote Auth',
    (config) => {
      config.runtime.build.EXPO_PUBLIC_SUPABASE_URL = 'https://auth.example.test'
    },
    /owned_release_font_auth_required/,
  ],
]) {
  test(`${name} is rejected before device commands`, async () => {
    const f = fixture()
    const config = configuration()
    mutate(config)
    await assert.rejects(proveReleaseLiveFont(config, f.io), code)
    assert.deepEqual(f.events, [])
  })
}

for (const [name, change, code] of [
  [
    'debuggable package',
    { package: `Package [${app}]\nflags=[ DEBUGGABLE HAS_CODE ]` },
    /non_debuggable_release_required/,
  ],
  ['wrong AVD', { avd: 'shared-avd' }, /owned_avd_and_safe_even_port_required/],
  ['wrong installed APK', { hash: 'c'.repeat(64) }, /installed_release_apk_mismatch/],
]) {
  test(`${name} fails before mutation`, async () => {
    const f = fixture()
    const shell = f.io.shell
    f.io.shell = (args) =>
      args[0] === 'dumpsys' && change.package
        ? change.package
        : args[0] === 'toybox' && change.hash
          ? change.hash
          : shell(args)
    if (change.avd) f.io.avdName = async () => change.avd
    await assert.rejects(proveReleaseLiveFont(configuration(), f.io), code)
    assert.equal(
      f.events.some((event) => /force-stop|settings put/.test(event)),
      false
    )
  })
}

for (const [name, state, code] of [
  [
    'digest-only debug preview',
    { previewId: `share-card-preview-loaded-${sha}` },
    /release_production_preview_required/,
  ],
  [
    'wrong localized title',
    { title: 'Another card' },
    /release_localized_title_required/,
  ],
  ['watermark ON', { checked: 'true' }, /release_watermark_off_required/],
  [
    'wrong full source label',
    { label: 'Different source. CoutureCast' },
    /release_full_render_label_required/,
  ],
]) {
  test(`${name} cannot establish the before state and always restores the original font`, async () => {
    const f = fixture({ hierarchy: async () => tree(state) })
    await assert.rejects(proveReleaseLiveFont(configuration(), f.io), code)
    assert.equal(f.events.includes('settings put system font_scale 1.5'), false)
    assert.deepEqual(f.events.slice(-2), [
      `am force-stop ${app}`,
      'settings put system font_scale 1.2',
    ])
  })
}

test('actual observed modal loss fails at the original 20-second deadline with cleanup', async () => {
  let snapshots = 0
  const f = fixture({
    hierarchy: async () => (snapshots++ === 0 ? tree() : { children: [] }),
  })
  await assert.rejects(
    proveReleaseLiveFont(configuration(), f.io),
    /release_production_preview_required/
  )
  assert.equal(f.now(), 20000)
  assert.deepEqual(f.events.slice(-2), [
    `am force-stop ${app}`,
    'settings put system font_scale 1.2',
  ])
})

test('pre-existing renderer clipping records unchanged height while preserving every text node', async () => {
  const f = fixture({ hierarchy: async () => tree() })
  const result = await proveReleaseLiveFont(configuration(), f.io)
  assert.equal(result.beforeTitleHeight, result.afterTitleHeight)
  assert.equal(result.textNodesPreserved, true)
  assert.equal(result.beforeTextNodes, result.afterTextNodes)
})

for (const mutation of ['missing', 'changed', 'duplicated']) {
  test(`live font ${mutation} body text fails even when title and card state survive`, async () => {
    let reads = 0
    const f = fixture({
      hierarchy: async () => {
        const after = reads++ > 0
        const value = tree({ height: after ? 138 : 92 })
        if (!after || mutation !== 'missing')
          value.children.push({
            attributes: {
              'resource-id': 'card-body',
              text: after && mutation === 'changed' ? 'Changed label' : 'Card body',
            },
          })
        if (after && mutation === 'duplicated')
          value.children.push({
            attributes: {
              'resource-id': 'card-body',
              text: 'Card body',
            },
          })
        return value
      },
    })
    await assert.rejects(
      proveReleaseLiveFont(configuration(), f.io),
      /release_text_nodes_changed/
    )
    assert.equal(f.events.at(-1), 'settings put system font_scale 1.2')
  })
}

test('text identity comparison retains multiplicity and labels while excluding only the changing system clock', () => {
  const before = tree()
  before.children.push({
    attributes: {
      'resource-id': 'com.android.systemui:id/clock',
      text: '10:59',
    },
  })
  const after = tree({ height: 138 })
  after.children.push({
    attributes: {
      'resource-id': 'com.android.systemui:id/clock',
      text: '11:00',
    },
  })
  assert.deepEqual(assertReleaseTextPreserved(before, after), {
    beforeTextNodes: 1,
    afterTextNodes: 1,
    textNodesPreserved: true,
  })
  after.children[0].attributes.accessibilityText = 'Different accessible title'
  assert.throws(
    () => assertReleaseTextPreserved(before, after),
    /release_text_nodes_changed/
  )
  assert.throws(
    () => assertReleaseTextPreserved({ children: [] }, { children: [] }),
    /release_text_nodes_changed/
  )
})

test('a changed process and a crash log each fail the actual proof', async () => {
  for (const crash of [false, true]) {
    const f = fixture()
    let pidReads = 0
    const shell = f.io.shell
    f.io.shell = (args) =>
      args[0] === 'pidof' && ++pidReads > 1 && !crash ? '99999' : shell(args)
    let logReads = 0
    if (crash) f.io.logcat = async () => (++logReads > 1 ? 'FATAL EXCEPTION: main' : '')
    await assert.rejects(
      proveReleaseLiveFont(configuration(), f.io),
      crash ? /release_crash_log/ : /release_process_changed/
    )
    assert.equal(f.events.at(-1), 'settings put system font_scale 1.2')
  }
})

test('cleanup retains assertion error and refuses a hot restore when the final stop fails', async () => {
  const f = fixture({ hierarchy: async () => tree({ label: 'Wrong' }) })
  const shell = f.io.shell
  let stops = 0
  const cleanup = new Error('stop_failed')
  f.io.shell = (args) => {
    if (args[0] === 'am' && args[1] === 'force-stop' && ++stops === 2) throw cleanup
    return shell(args)
  }
  await assert.rejects(proveReleaseLiveFont(configuration(), f.io), (error) => {
    assert.equal(error.message, 'release_font_restore_failed')
    assert.match(error.errors[0].message, /release_full_render_label_required/)
    assert.equal(error.errors[1], cleanup)
    return true
  })
  assert.equal(f.events.includes('settings put system font_scale 1.2'), false)
})

for (const [name, state, code] of [
  [
    'changed source after recreation',
    { label: 'Different source. CoutureCast' },
    /release_full_render_label_required/,
  ],
  [
    'reset watermark after recreation',
    { checked: 'true' },
    /release_watermark_off_required/,
  ],
  [
    'reset locale after recreation',
    { title: 'Otra tarjeta' },
    /release_localized_title_required/,
  ],
]) {
  test(`${name} fails within the original deadline`, async () => {
    let reads = 0
    const f = fixture({
      hierarchy: async () => (reads++ === 0 ? tree() : tree({ height: 138, ...state })),
    })
    await assert.rejects(proveReleaseLiveFont(configuration(), f.io), code)
    assert.equal(f.now(), 20000)
    assert.equal(f.events.at(-1), 'settings put system font_scale 1.2')
  })
}

test('an actual error surface cannot satisfy restored state', async () => {
  let reads = 0
  const f = fixture({
    hierarchy: async () => {
      const value = tree({ height: reads++ === 0 ? 92 : 138 })
      if (reads > 1)
        value.children.push({ attributes: { 'resource-id': 'hero-error-state' } })
      return value
    },
  })
  await assert.rejects(
    proveReleaseLiveFont(configuration(), f.io),
    /release_error_surface/
  )
  assert.ok(f.now() < 20000)
})

test('baseline font write acknowledgement failure still deletes an originally absent setting', async () => {
  const original = new Error('setting_ack_lost')
  const f = fixture()
  const shell = f.io.shell
  f.io.shell = (args) => {
    if (args.join(' ') === 'settings get system font_scale') return 'null'
    if (args.join(' ') === 'settings put system font_scale 1.0') throw original
    return shell(args)
  }
  await assert.rejects(
    proveReleaseLiveFont(configuration(), f.io),
    (error) => error === original
  )
  assert.deepEqual(f.events.slice(-2), [
    `am force-stop ${app}`,
    'settings delete system font_scale',
  ])
})

test('snapshot commands use measured 20s headroom and the remaining restoration deadline', async () => {
  const timeouts = []
  let snapshots = 0
  const f = fixture()
  f.io.hierarchy = async (timeout) => {
    timeouts.push(timeout)
    snapshots++
    if (snapshots === 1) return tree()
    await f.io.pause(8000)
    return snapshots === 2 ? { children: [] } : tree({ height: 138 })
  }
  const result = await proveReleaseLiveFont(configuration(), f.io)
  assert.equal(result.passed, true)
  assert.deepEqual(timeouts, [20000, 20000, 11900])
})

test('a snapshot arriving after the restoration deadline cannot pass', async () => {
  const f = fixture()
  let reads = 0
  f.io.hierarchy = async () => {
    if (reads++ === 0) return tree()
    await f.io.pause(20001)
    return tree({ height: 138 })
  }
  await assert.rejects(
    proveReleaseLiveFont(configuration(), f.io),
    /release_restore_deadline/
  )
  assert.equal(f.events.at(-1), 'settings put system font_scale 1.2')
})

test('lost-card timeout collects private failure evidence before cold cleanup without replacing its error', async () => {
  for (const diagnosticsFail of ['none', 'log', 'screenshot']) {
    let reads = 0
    const f = fixture({
      hierarchy: async () => (reads++ === 0 ? tree() : { children: [] }),
    })
    f.io.screenshot = async (stage) => {
      f.events.push(`private ${stage} screenshot`)
      if (diagnosticsFail === 'screenshot' && stage === 'after')
        throw new Error('screenshot_failed')
    }
    f.io.recordLog = async () => {
      f.events.push('private log')
      if (diagnosticsFail === 'log') throw new Error('log_failed')
    }
    await assert.rejects(
      proveReleaseLiveFont(configuration(), f.io),
      /release_production_preview_required/
    )
    assert.ok(f.events.indexOf('private log') > f.events.indexOf('private after'))
    assert.ok(
      f.events.indexOf('private after screenshot') <
        f.events.lastIndexOf(`am force-stop ${app}`)
    )
    assert.equal(f.events.at(-1), 'settings put system font_scale 1.2')
  }
})

function adapterFixture(proof, timedOut = false) {
  const source = fs.readFileSync(
    'scripts/lib/story68-release-live-font-command.mjs',
    'utf8'
  )
  const start = source.indexOf('export async function runReleaseLiveFontCommand')
  const records = []
  const processes = []
  const writes = []
  const kills = []
  const removals = []
  let nativeTime = 0
  const context = {
    path,
    createHash,
    console: { log: () => undefined },
    performance: { now: () => nativeTime },
    process: { kill: (...args) => kills.push(args) },
    failures: new Set(['release_font_native_command_failed']),
    fs: {
      rmSync: (name, options) => removals.push({ name, options }),
      readFileSync: (name) =>
        name.endsWith('.apk')
          ? Buffer.from('Release APK')
          : name.endsWith('api.log')
            ? 'owned log'
            : '{}',
      writeFileSync: (name, data, options) => writes.push({ name, data, options }),
    },
    restoreAndroidReverse: () => undefined,
    proveReleaseLiveFont: proof,
    spawnSync: (binary, args, options) => {
      processes.push({ binary, args: Array.from(args), options })
      nativeTime += 23
      return timedOut
        ? {
            status: null,
            pid: 4321,
            error: { code: 'ETIMEDOUT' },
            stderr: 'private diagnostic',
          }
        : {
            status: 0,
            stdout: args.includes('hierarchy')
              ? '{}'
              : options.encoding
                ? ''
                : Buffer.from('PNG'),
          }
    },
  }
  const invoke = vm.runInNewContext(
    `(${source.slice(start).replace('export ', '')})`,
    context
  )
  const ctx = {
    root: '/owned/repo',
    directory: '/owned/runtime',
    platform: 'android',
    appId: app,
    device: 'emulator-5584',
    adb: '/owned/sdk/adb',
    maestroBinary: '/owned/maestro',
    apkPath: '/owned/repo/app-release.apk',
    read: () => ({}),
    maestro: () => undefined,
    privateJson: (name, record) => records.push({ name, record }),
  }
  return { invoke: () => invoke(ctx), records, processes, writes, kills, removals }
}

test('actual adapter bounds commands, preserves explicit device and keeps raw diagnostics in private files', async () => {
  const f = adapterFixture(async (_config, io) => {
    await io.avdName()
    await io.shell(['pidof', app])
    await io.hierarchy(11900)
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
        options.timeout <= 20000 &&
        options.detached &&
        options.killSignal === 'SIGKILL'
    )
  )
  const hierarchy = f.processes.find(({ args }) => args.includes('hierarchy'))
  assert.equal(hierarchy.options.timeout, 11900)
  assert.equal(f.records[0].record.passed, false)
  assert.equal(f.records.at(-1).record.passed, true)
  assert.ok(
    f.records.every(({ name }) => name === 'native-release-live-font-android.json')
  )
  assert.equal(JSON.stringify(f.records).includes('source-label'), false)
  assert.ok(
    f.writes.every(
      ({ name, options }) => name.includes('-private.') && options.mode === 0o600
    )
  )
})

test('actual adapter timeout kills only its owned process group and publishes a closed failure', async () => {
  const f = adapterFixture(async (_config, io) => io.hierarchy(20000), true)
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

for (const failure of ['none', 'proof', 'cleanup']) {
  test(`actual CI Release script scopes proof flags and cleanly switches off after ${failure}`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-release-ci-'))
    try {
      const bin = path.join(directory, 'bin')
      fs.mkdirSync(bin)
      const events = path.join(directory, 'events.jsonl')
      for (const command of ['node', 'adb']) {
        fs.writeFileSync(
          path.join(bin, command),
          `#!${process.execPath}
const fs = require('node:fs')
const args = process.argv.slice(2)
const flags = Object.fromEntries(['STORY68_NATIVE_TEST_BUILD', 'CC68_RELEASE_PROOF_LOOPBACK', 'EAS_BUILD_PROFILE'].map(key => [key, process.env[key] ?? null]))
fs.appendFileSync(process.env.CC68_CI_EVENTS, JSON.stringify({ command: '${command}', args, flags }) + '\\n')
if (process.env.CC68_CI_FAILURE === 'proof' && args.includes('release-live-font')) process.exit(19)
if (process.env.CC68_CI_FAILURE === 'cleanup' && args.includes('prebuild') && flags.CC68_RELEASE_PROOF_LOOPBACK === '0') process.exit(37)
`,
          { mode: 0o755 }
        )
      }
      const result = spawnSync(
        'bash',
        ['scripts/ci/share-card-android-release-font.sh'],
        {
          encoding: 'utf8',
          timeout: 5000,
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            ANDROID_SERIAL: 'emulator-5554',
            CC68_CI_EVENTS: events,
            CC68_CI_FAILURE: failure,
            CC68_RELEASE_PROOF_LOOPBACK: undefined,
            STORY68_NATIVE_TEST_BUILD: undefined,
            EAS_BUILD_PROFILE: undefined,
          },
        }
      )
      assert.equal(
        result.status,
        failure === 'proof' ? 19 : failure === 'cleanup' ? 37 : 0,
        result.stderr
      )
      const records = fs
        .readFileSync(events, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      assert.equal(records.length, 5)
      for (const record of records.slice(0, 2))
        assert.deepEqual(record.flags, {
          STORY68_NATIVE_TEST_BUILD: '1',
          CC68_RELEASE_PROOF_LOOPBACK: '1',
          EAS_BUILD_PROFILE: 'cc68-release-proof',
        })
      assert.ok(records[0].args.includes('--clean') && records[0].args.includes('yes'))
      assert.ok(records[1].args.includes('Release'))
      assert.equal(records[2].command, 'adb')
      assert.equal(records[3].args.includes('release-live-font'), true)
      assert.equal(records[3].flags.CC68_RELEASE_PROOF_LOOPBACK, null)
      assert.deepEqual(records[4].args, [
        'scripts/run-story68-native.mjs',
        'prebuild',
        '--platform',
        'android',
        '--clean',
        'yes',
      ])
      assert.equal(records[4].flags.CC68_RELEASE_PROOF_LOOPBACK, '0')
    } finally {
      fs.rmSync(directory, { recursive: true })
    }
  })
}

test('new exact native fragment failures retain assertion classification through the closed schema', async () => {
  const { summarizeNativeFlowFailure, assertNativeFlowFailure } = await import(
    './share-card-native-failure.mjs'
  )
  for (const name of ['release-open-outfit.yaml', 'release-watermark-off.yaml']) {
    const record = summarizeNativeFlowFailure({
      flow: `maestro/story68/${name}`,
      platform: 'android',
      durationMs: 1234,
      log: 'maestro.MaestroException$AssertionFailure: Assertion is false',
    })
    assert.equal(record.flow, name)
    assert.equal(record.classification, 'assertion')
    assertNativeFlowFailure(record)
  }
})

test('actual prebuild passes clean only when requested and preserves externally scoped proof input', () => {
  const source = fs.readFileSync('scripts/run-story68-native.mjs', 'utf8')
  const marker = "if (command === 'prebuild') {"
  const start = source.indexOf(marker) + marker.length
  const end = source.indexOf("} else if (command === 'build')", start)
  for (const clean of [undefined, 'yes']) {
    let observed
    vm.runInNewContext(`(() => {${source.slice(start, end)}})()`, {
      ownedEnv: () => undefined,
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
  const execution = vm.runInNewContext(`(async () => {${source.slice(start, end)}})()`, {
    privateJson: (name, record) => {
      assert.equal(name, 'native-release-live-font-android.json')
      records.push(record)
    },
    requireDevice: () => {
      throw failure
    },
    runReleaseLiveFontCommand: () => assert.fail('guard must fail before native proof'),
  })
  await assert.rejects(execution, (error) => error === failure)
  assert.equal(records.at(-1).passed, false)
})

test('after snapshot skips driver reinstall only after the verified production baseline', async () => {
  const f = fixture()
  const stages = []
  const hierarchy = f.io.hierarchy
  f.io.hierarchy = async (timeout, stage) => {
    stages.push({
      timeout,
      stage,
      live: f.events.includes('settings put system font_scale 1.5'),
    })
    return hierarchy()
  }
  await proveReleaseLiveFont(configuration(), f.io)
  assert.deepEqual(stages, [
    { timeout: 20000, stage: 'before', live: false },
    { timeout: 20000, stage: 'after', live: true },
  ])
})

test('both baseline and after adapters retain the Maestro driver within the original capture budgets', async () => {
  const f = adapterFixture(async (_config, io) => {
    await io.hierarchy(20000, 'before')
    await io.hierarchy(11900, 'after')
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
    [20000, 11900]
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
  const f = adapterFixture(async (_config, io) => io.hierarchy(20000, 'after'), true)
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
