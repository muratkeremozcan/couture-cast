#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 live font-scale proof on a device (AC3). The journey itself lives in
// scripts/lib/live-font-journey.mjs; this file binds it to adb, simctl and Maestro, writes
// private evidence under --out, and exits nonzero unless every requested screen passed
// (Codex R4-03). The React Native version is the one the installed app reports through its
// test-build marker (R4 limits), never the host's node_modules.
//
//   node scripts/run-live-font-proof.mjs --platform android|ios --device <serial|udid> \
//     --build release|debug --screens home,community,settings,composer --out <dir> \
//     [--label sdk54-release] [--app-id com.couturecast.story68]
//   node scripts/run-live-font-proof.mjs ... --config-change theme|locale|density
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  activityToken,
  countOnCreate,
  flattenHierarchy,
  readEnvironment,
  rootIdentity,
  sameLayout,
  stitchPages,
  windowBounds,
} from './lib/live-font-capture.mjs'
import {
  aggregateVerdict,
  numericScale,
  runScreenJourney,
  SCALES,
  SCREENS,
} from './lib/live-font-journey.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`)
  return at < 0 ? fallback : argv[at + 1]
}
const platform = option('platform')
const device = option('device')
const build = option('build', 'release')
const appId = option('app-id', 'com.couturecast.story68')
const screens = option('screens', 'home,community,settings,composer').split(',')
const configChange = option('config-change')
const runLabel = option('label', build)
if (!['android', 'ios'].includes(platform) || !device || !option('out'))
  throw new Error('usage: --platform android|ios --device <id> --out <dir>')
if (!['release', 'debug'].includes(build))
  throw new Error('build_release_or_debug_required')
const out = path.resolve(option('out'))
fs.mkdirSync(out, { recursive: true, mode: 0o700 })

const adbBinary = path.join(process.env.HOME, 'Library/Android/sdk/platform-tools/adb')
const component = `${appId}/.MainActivity`
const className = `${appId}.MainActivity`

function run(binary, args, { timeout = 120_000 } = {}) {
  const result = spawnSync(binary, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout,
    killSignal: 'SIGKILL',
  })
  if (result.status !== 0 || result.error)
    throw new Error(
      `live_font_command_failed:${path.basename(binary)} ${args.slice(0, 4).join(' ')}:${result.status}:${String(result.stderr).slice(-600)}`
    )
  return result.stdout
}
const adb = (...args) => run(adbBinary, ['-s', device, ...args])
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function maestro(flow) {
  run(
    'maestro',
    [
      '--device',
      device,
      'test',
      '-e',
      `MAESTRO_APP_ID=${appId}`,
      '-e',
      'MAESTRO_BACK=Back',
      path.join(root, 'maestro/live-font', `${flow}.yaml`),
    ],
    { timeout: 240_000 }
  )
}
function hierarchy() {
  const raw = run('maestro', ['--device', device, 'hierarchy'])
  const start = raw.indexOf('{')
  if (start < 0) throw new Error('live_font_hierarchy_invalid')
  return JSON.parse(raw.slice(start))
}
function readScale() {
  return platform === 'android'
    ? adb('shell', 'settings', 'get', 'system', 'font_scale').trim()
    : run('xcrun', ['simctl', 'ui', device, 'content_size']).trim()
}
function setScale(scale) {
  if (platform === 'android')
    adb('shell', 'settings', 'put', 'system', 'font_scale', String(scale))
  else run('xcrun', ['simctl', 'ui', device, 'content_size', scale])
}
function pid() {
  if (platform === 'android') return adb('shell', 'pidof', appId).trim() || undefined
  const line = run('xcrun', ['simctl', 'spawn', device, 'launchctl', 'list'])
    .split('\n')
    .find((entry) => entry.includes(`UIKitApplication:${appId}`))
  return line?.trim().split(/\s+/)[0]
}
function nativeIdentity() {
  if (platform !== 'android') return {}
  let onCreate
  try {
    onCreate = countOnCreate(
      adb('logcat', '-b', 'events', '-d'),
      className,
      adb('logcat', '-b', 'events', '-g')
    )
  } catch {
    onCreate = undefined
  }
  return {
    activity: activityToken(adb('shell', 'dumpsys', 'activity', 'top', '-a'), component),
    onCreate,
  }
}

let launchCount = 0
let launchId
let sequence = 0
function screenshot(name) {
  const file = path.join(out, `${name}.png`)
  if (platform === 'android') {
    const shot = spawnSync(adbBinary, ['-s', device, 'exec-out', 'screencap', '-p'], {
      maxBuffer: 64 * 1024 * 1024,
    })
    fs.writeFileSync(file, shot.stdout, { mode: 0o600 })
  } else run('xcrun', ['simctl', 'io', device, 'screenshot', file])
}
function persist(capture) {
  fs.writeFileSync(
    path.join(out, `${capture.file}.json`),
    JSON.stringify(capture, null, 2),
    {
      mode: 0o600,
    }
  )
}

function makeCapture(screenName, stage, scale) {
  const tree = hierarchy()
  const flat = flattenHierarchy(tree, { platform })
  sequence += 1
  const capture = {
    stage,
    launch: launchId,
    fontScale: numericScale(platform, scale),
    osScale: readScale(),
    jsFontScale: flat.jsFontScale,
    environment: flat.environment,
    pid: pid(),
    identity: { root: rootIdentity(flat.markers), ...nativeIdentity() },
    nodes: flat.nodes,
    controls: flat.controls,
    window: windowBounds(tree),
  }
  Object.defineProperty(capture, 'file', {
    value: `${screenName}-${String(sequence).padStart(3, '0')}-${stage}-${scale}`,
    enumerable: false,
  })
  persist(capture)
  screenshot(capture.file)
  return capture
}

async function stableNodes() {
  let previous = flattenHierarchy(hierarchy(), { platform }).nodes
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await pause(500)
    const current = flattenHierarchy(hierarchy(), { platform }).nodes
    if (sameLayout(current, previous)) return current
    previous = current
  }
  throw new Error('live_font_scroll_page_unstable')
}

function windowSize(capture) {
  const match = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(capture.window ?? '')
  return match ? { width: Number(match[3]), height: Number(match[4]) } : undefined
}
function drag(size, up) {
  const x = String(Math.round(size.width / 2))
  const [from, to] = up ? [0.7, 0.35] : [0.35, 0.7]
  if (platform === 'android')
    // A slow drag stops where the finger lifts; a fast one flings on after the capture.
    adb(
      'shell',
      'input',
      'swipe',
      x,
      String(Math.round(size.height * from)),
      x,
      String(Math.round(size.height * to)),
      '1500'
    )
  else
    run('maestro', [
      '--device',
      device,
      'test',
      '-e',
      `MAESTRO_APP_ID=${appId}`,
      '-e',
      `MAESTRO_SWIPE=${up ? 'UP' : 'DOWN'}`,
      path.join(root, 'maestro/live-font/swipe.yaml'),
    ])
}

/** Adds the scrolled-through text to a capture, then scrolls back and checks the top. */
async function fullText(capture) {
  const size = windowSize(capture)
  if (!size) throw new Error('live_font_window_bounds_required')
  const pages = [capture.nodes]
  let drags = 0
  for (; drags < 12; drags += 1) {
    drag(size, true)
    const page = await stableNodes()
    if (sameLayout(page, pages.at(-1))) break
    pages.push(page)
  }
  for (let back = 0; back <= drags + 1; back += 1) drag(size, false)
  let top = await stableNodes()
  for (let extra = 0; extra < 3 && !sameLayout(top, capture.nodes); extra += 1) {
    drag(size, false)
    top = await stableNodes()
  }
  if (!sameLayout(top, capture.nodes)) {
    fs.writeFileSync(
      path.join(out, `${capture.file}-not-restored.json`),
      JSON.stringify(top),
      {
        mode: 0o600,
      }
    )
    throw new Error('live_font_scroll_not_restored')
  }
  fs.writeFileSync(path.join(out, `${capture.file}-pages.json`), JSON.stringify(pages), {
    mode: 0o600,
  })
  capture.fullText = pages.length > 1 ? stitchPages(pages) : undefined
  persist(capture)
  return capture
}

async function settle(screenName, stage, scale) {
  // Two identical hierarchies at least a second apart, within 60 seconds: a cold Debug launch
  // keeps loading the teaser and the outfit images for a while after the anchors appear.
  const deadline = Date.now() + 60_000
  let previous = flattenHierarchy(hierarchy(), { platform }).nodes
  let since = Date.now()
  while (Date.now() < deadline) {
    await pause(500)
    const current = flattenHierarchy(hierarchy(), { platform }).nodes
    if (!sameLayout(current, previous)) {
      previous = current
      since = Date.now()
    } else if (Date.now() - since >= 1000) return makeCapture(screenName, stage, scale)
  }
  throw new Error(`live_font_stable_state_deadline:${screenName}:${stage}`)
}

function launch() {
  launchCount += 1
  launchId = `launch-${launchCount}`
  if (platform === 'android') {
    adb('shell', 'am', 'force-stop', appId)
    if (build === 'release') adb('shell', 'am', 'start', '-n', component)
    else
      adb(
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        `couturecast-story68://expo-development-client/?url=${encodeURIComponent('http://127.0.0.1:8089')}`
      )
  } else {
    spawnSync('xcrun', ['simctl', 'terminate', device, appId])
    run('xcrun', ['simctl', 'launch', device, appId])
  }
  run(
    'maestro',
    [
      '--device',
      device,
      'test',
      '-e',
      `MAESTRO_APP_ID=${appId}`,
      '-e',
      'MAESTRO_BACK=Back',
      path.join(root, 'maestro/story65/open-app.yaml'),
    ],
    { timeout: 240_000 }
  )
}

function deviceIo(name) {
  const flow = SCREENS[name].flow
  return {
    cold: async (scale) => {
      setScale(scale)
      launch()
      maestro(flow)
      return fullText(await settle(name, 'cold', scale))
    },
    launch: async () => launch(),
    setScale: async (scale) => setScale(scale),
    navigate: async () => maestro(flow),
    capture: async (stage, scale) => makeCapture(name, stage, scale),
    settle: async (stage, scale) => settle(name, stage, scale),
    fullText,
    update: async () => maestro(`update-${name}`),
    revert: async () => maestro(`revert-${name}`),
  }
}

function androidDensity() {
  const output = adb('shell', 'wm', 'density')
  const override = /Override density: (\d+)/.exec(output)
  const physical = /Physical density: (\d+)/.exec(output)
  return Number((override ?? physical)?.[1])
}

/**
 * R2-03: a theme change Android handles in place, a locale change the manifest also handles
 * in place (expo-localization declares locale|layoutDirection), and a density change that
 * recreates the Activity. Each reads the prior setting, applies, checks the app saw the new
 * configuration and kept its route and text, and restores what it read.
 */
const CONFIG_CHANGES = {
  theme: {
    read: () => adb('shell', 'cmd', 'uimode', 'night').trim(),
    apply: () => adb('shell', 'cmd', 'uimode', 'night', 'yes'),
    restore: (prior) =>
      adb(
        'shell',
        'cmd',
        'uimode',
        'night',
        /yes/.test(prior) ? 'yes' : /auto/.test(prior) ? 'auto' : 'no'
      ),
    expect: (after) => after.environment?.scheme === 'dark',
    inPlace: true,
  },
  locale: {
    read: () => adb('shell', 'cmd', 'locale', 'get-app-locales', appId).trim(),
    apply: () =>
      adb('shell', 'cmd', 'locale', 'set-app-locales', appId, '--locales', 'ar-EG'),
    restore: (prior) => {
      const locales = /\[([^\]]*)\]/.exec(prior)?.[1] ?? ''
      adb('shell', 'cmd', 'locale', 'set-app-locales', appId, '--locales', locales)
    },
    expect: (after) => after.environment?.direction === 'rtl',
    inPlace: true,
  },
  density: {
    read: () => adb('shell', 'wm', 'density'),
    apply: () => adb('shell', 'wm', 'density', '480'),
    restore: (prior) => {
      const override = /Override density: (\d+)/.exec(prior)?.[1]
      if (override) adb('shell', 'wm', 'density', override)
      else adb('shell', 'wm', 'density', 'reset')
    },
    expect: (after) => Math.abs(Number(after.environment?.density) - 3) < 0.01,
    inPlace: false,
  },
}

async function proveConfigChange(name, kind) {
  const change = CONFIG_CHANGES[kind]
  if (!change) throw new Error(`live_font_unknown_config_change:${kind}`)
  const prior = change.read()
  setScale(SCALES[platform].base)
  launch()
  maestro(SCREENS[name].flow)
  const before = await settle(name, 'before', SCALES[platform].base)
  try {
    change.apply()
    const after = await settle(name, 'settled', SCALES[platform].base)
    const ids = new Set(after.nodes.map((node) => node.id).filter(Boolean))
    const sameActivity = before.identity.activity === after.identity.activity
    const checks = {
      applied: change.expect(after),
      routeKept: SCREENS[name].anchors.every((anchor) => ids.has(anchor)),
      processKept: before.pid === after.pid,
      activity: change.inPlace ? sameActivity : !sameActivity,
    }
    return {
      screen: name,
      configChange: kind,
      pass: Object.values(checks).every(Boolean),
      checks,
      environment: [before.environment, after.environment],
      activities: [before.identity.activity, after.identity.activity],
      onCreate: [before.identity.onCreate, after.identity.onCreate],
      roots: [before.identity.root, after.identity.root],
      textNodes: [before.nodes.length, after.nodes.length],
    }
  } finally {
    change.restore(prior)
  }
}

const residualBaselines = JSON.parse(
  fs.readFileSync(
    path.join(root, 'scripts/lib/fixtures/live-font-residual-baselines.json'),
    'utf8'
  )
).entries
const androidApi =
  platform === 'android'
    ? Number(adb('shell', 'getprop', 'ro.build.version.sdk').trim())
    : undefined
const previousScale = readScale()
const started = Date.now()
const results = []
let reactNativeVersion
try {
  if (platform === 'android' && build === 'release') {
    const flags = adb('shell', 'dumpsys', 'package', appId)
    if (/pkgFlags=\[[^\]]*DEBUGGABLE/.test(flags))
      throw new Error('non_debuggable_release_required')
  }
  for (const name of screens) {
    if (configChange) {
      try {
        results.push(await proveConfigChange(name, configChange))
      } catch (error) {
        results.push({
          screen: name,
          configChange,
          pass: false,
          error: { error: error.message },
        })
      }
      continue
    }
    // The installed app reports its React Native version; read it once on the first launch.
    if (!reactNativeVersion) {
      launch()
      maestro(SCREENS[name].flow)
      reactNativeVersion = readEnvironment(
        flattenHierarchy(hierarchy(), { platform })
      ).reactNativeVersion
      if (!reactNativeVersion)
        throw new Error('live_font_installed_rn_version_unreadable')
    }
    const report = await runScreenJourney({
      io: deviceIo(name),
      platform,
      androidApi,
      name,
      reactNativeVersion,
      residualBaselines,
      label: runLabel,
      androidDensity,
    })
    for (const leg of report.legs) {
      for (const [stage, capture] of Object.entries(leg.evidence))
        leg.evidence[stage] = capture.file
    }
    results.push(report)
  }
} finally {
  if (platform === 'android' && previousScale === 'null')
    adb('shell', 'settings', 'delete', 'system', 'font_scale')
  else setScale(previousScale)
}
const verdict = configChange
  ? {
      pass: results.length > 0 && results.every((result) => result.pass),
      reasons: results.filter((result) => !result.pass).map((result) => result.screen),
    }
  : aggregateVerdict(results, platform)
const report = {
  platform,
  device,
  build,
  label: runLabel,
  appId,
  reactNativeVersion: reactNativeVersion ?? null,
  androidApi: androidApi ?? null,
  configChange: configChange ?? null,
  wallSeconds: Math.round((Date.now() - started) / 1000),
  verdict,
  results,
}
fs.writeFileSync(
  path.join(out, 'live-font-report.json'),
  JSON.stringify(report, null, 2),
  {
    mode: 0o600,
  }
)
console.log(JSON.stringify({ verdict, wallSeconds: report.wallSeconds }))
process.exitCode = verdict.pass ? 0 : 1
