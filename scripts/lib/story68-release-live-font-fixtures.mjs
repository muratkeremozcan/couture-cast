// Shared fixtures for the Release live-font proof and command adapter tests.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createHash } from 'node:crypto'

// Budgets mirrored from story68-release-live-font.mjs: every snapshot and the whole
// restoration share one 20 s deadline, an unmatched observation retries after 100 ms
// and a preserved state must hold for a 1 s stable window.
export const RESTORE_DEADLINE_MS = 20000
export const RETRY_PAUSE_MS = 100
export const STABLE_WINDOW_MS = 1000

export const app = 'com.couturecast.story68'
export const sha = 'a'.repeat(64)
const database = `tea_community_${'b'.repeat(32)}`

export function configuration() {
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

export function tree({
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

export function activityDump({
  scale = '1.5',
  component = app,
  token = 'a123',
  resumed = true,
} = {}) {
  return `TASK ${component} id=37\n  ACTIVITY ${component}/.MainActivity ${token} pid=12345\n    mResumed=${resumed} mStopped=false mFinished=false\n    mChangingConfigurations=false\n    mCurrentConfig={${scale} 310mcc260mnc [en_US] 420dpi s.7}\n`
}

/** Device IO for proveReleaseLiveFont on an injected clock. */
export function fixture(overrides = {}) {
  const events = []
  let live = false
  let time = 0
  const io = {
    avdName: async () => 'cc68-api36\nOK\n',
    shell: async (args) => {
      const command = args.join(' ')
      events.push(command)
      if (command === 'settings put system font_scale 1.5') live = true
      if (command === 'dumpsys activity top -a') return activityDump()
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

/** The real runReleaseLiveFontCommand body, evaluated against recorded process and file IO. */
export function adapterFixture(proof, timedOut = false) {
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
  const logs = []
  let nativeTime = 0
  const context = {
    path,
    createHash,
    console: { log: (line) => logs.push(line) },
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
  return { invoke: () => invoke(ctx), records, processes, writes, kills, removals, logs }
}
