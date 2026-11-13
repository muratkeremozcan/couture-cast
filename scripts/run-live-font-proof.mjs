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
//     [--label sdk54-release] [--app-id com.couturecast.story68] [--scale-path settings|in-place]
//   --scale-path settings (default) changes the live scale the way a user does: the app goes to
//   the background behind the system Settings screen, the scale changes, and the app returns.
//   React Native reads the new font scale on resume, so a foreground write (in-place) is a
//   narrower path that only an accessibility shortcut takes.
//   node scripts/run-live-font-proof.mjs ... --config-change theme|locale|density
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  activityConfiguration,
  activityToken,
  countOnCreate,
  flattenHierarchy,
  readEnvironment,
  rootIdentity,
  sameLayout,
  sameLayoutShifted,
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
const scalePath = option('scale-path', 'settings')
if (!['settings', 'in-place'].includes(scalePath))
  throw new Error('scale_path_settings_or_in_place_required')
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
  if (result.status !== 0 || result.error) {
    // Maestro reports a failed step on stdout, so keep the tail of both streams and the last
    // argument (the flow file) to make the failure readable from the report alone.
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().slice(-900)
    throw new Error(
      `live_font_command_failed:${path.basename(binary)} ${args.slice(0, 4).join(' ')} ${path.basename(String(args.at(-1)))}:${result.status ?? result.error?.code}:${output}`
    )
  }
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
/** The live scale change, taken through the system Settings screen unless --scale-path in-place. */
async function changeLiveScale(scale) {
  if (scalePath === 'in-place') return setScale(scale)
  if (platform === 'android') {
    adb('shell', 'am', 'start', '-W', '-a', 'android.settings.DISPLAY_SETTINGS')
    await pause(1500)
    setScale(scale)
    await pause(1500)
    // MainActivity is singleTask, so this resumes the running task instead of a new launch.
    adb('shell', 'am', 'start', '-W', '-n', component)
  } else {
    run('xcrun', ['simctl', 'launch', device, 'com.apple.Preferences'])
    await pause(1500)
    setScale(scale)
    await pause(1500)
    // Without --terminate-running-process simctl brings the running app back to the front.
    run('xcrun', ['simctl', 'launch', device, appId])
  }
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

// The screen whose journey is running sets the regions every capture leaves out; screens run
// one after another, so one module-level value is enough.
let activeVolatile = []
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
  const flat = flattenHierarchy(tree, { platform, volatile: activeVolatile })
  sequence += 1
  const capture = {
    stage,
    launch: launchId,
    fontScale: numericScale(platform, scale),
    osScale: readScale(),
    jsFontScale: flat.jsFontScale,
    environment: flat.environment,
    volatileDropped: flat.volatileDropped,
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

/**
 * Two identical pages half a second apart. A scroll page (`page: true`) keeps volatile text,
 * flagged, so stitchPages can line pages up through a feed of volatile cards.
 */
async function stableNodes({ page = false } = {}) {
  const read = () =>
    flattenHierarchy(hierarchy(), {
      platform,
      volatile: activeVolatile,
      markVolatile: page,
    }).nodes
  let previous = read()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await pause(500)
    const current = read()
    if (sameLayout(current, previous)) return current
    previous = current
  }
  throw new Error('live_font_scroll_page_unstable')
}

function windowSize(capture) {
  const match = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(capture.window ?? '')
  return match ? { width: Number(match[3]), height: Number(match[4]) } : undefined
}
const [DRAG_FROM, DRAG_TO] = [0.7, 0.35]
function drag(size, up) {
  const x = String(Math.round(size.width / 2))
  const [from, to] = up ? [DRAG_FROM, DRAG_TO] : [DRAG_TO, DRAG_FROM]
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
  const pages = [await stableNodes({ page: true })]
  let drags = 0
  for (; drags < 12; drags += 1) {
    drag(size, true)
    const page = await stableNodes({ page: true })
    if (sameLayout(page, pages.at(-1))) break
    pages.push(page)
  }
  for (let back = 0; back <= drags + 1; back += 1) drag(size, false)
  let top = await stableNodes()
  for (let extra = 0; extra < 3 && !sameLayout(top, capture.nodes); extra += 1) {
    drag(size, false)
    top = await stableNodes()
  }
  if (!sameLayout(top, capture.nodes) && !sameLayoutShifted(capture.nodes, top)) {
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
  // A page of only a tall image shares no text with its neighbors; the stitch then steps by
  // the drag's length.
  capture.fullText =
    pages.length > 1
      ? stitchPages(pages, {
          expectedShift: Math.round(size.height * (DRAG_FROM - DRAG_TO)),
        })
      : undefined
  persist(capture)
  return capture
}

/**
 * Drags a scrolling screen to its true top. A flow's scrollUntilVisible stops as soon as the
 * anchor shows, a few dozen pixels short of the top, and fullText's scroll-back then lands on
 * the real top and reads as a moved page. The composer is a modal and is left alone.
 */
async function scrollToTop(screenName) {
  if (SCREENS[screenName].composer) return
  const size = windowSize({ window: windowBounds(hierarchy()) })
  if (!size) throw new Error('live_font_window_bounds_required')
  let top = await stableNodes()
  for (let drags = 0; drags < 4; drags += 1) {
    drag(size, false)
    const page = await stableNodes()
    if (sameLayout(page, top) || sameLayoutShifted(top, page)) return
    top = page
  }
  throw new Error('live_font_scroll_top_unreached')
}

async function settle(screenName, stage, scale) {
  // Two identical hierarchies at least a second apart, within 60 seconds: a cold Debug launch
  // keeps loading the teaser and the outfit images for a while after the anchors appear.
  const deadline = Date.now() + 60_000
  let previous = flattenHierarchy(hierarchy(), {
    platform,
    volatile: activeVolatile,
  }).nodes
  let since = Date.now()
  while (Date.now() < deadline) {
    await pause(500)
    const current = flattenHierarchy(hierarchy(), {
      platform,
      volatile: activeVolatile,
    }).nodes
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
    // Each launch starts the onCreate count from an empty event log, so a full ring buffer
    // cannot drop the entries the identity check needs. The Activity token alone cannot show
    // a recreation: Android keeps the ActivityRecord token across a configuration relaunch.
    adb('logcat', '-b', 'events', '-c')
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
      await scrollToTop(name)
      return fullText(await settle(name, 'cold', scale))
    },
    launch: async () => launch(),
    setScale: async (scale) => changeLiveScale(scale),
    navigate: async () => {
      maestro(flow)
      await scrollToTop(name)
    },
    capture: async (stage, scale) => makeCapture(name, stage, scale),
    settle: async (stage, scale) => settle(name, stage, scale),
    fullText,
    // An update flow scrolls to its control (Settings' locale buttons sit mid-page), so the
    // screen goes back to its top before the next capture starts the scroll-through there.
    update: async () => {
      maestro(`update-${name}`)
      await scrollToTop(name)
    },
    revert: async () => {
      maestro(`revert-${name}`)
      await scrollToTop(name)
    },
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
    // The app keeps its own language and React Native fixes the layout direction at startup,
    // so the JavaScript markers cannot show this change; the Activity's own configuration can.
    expect: () => {
      const reported = activityConfiguration(
        adb('shell', 'dumpsys', 'activity', 'activities'),
        component
      )
      return reported?.locales[0] === 'ar_EG' && reported.rtl
    },
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
    // Android keeps the ActivityRecord token across a configuration relaunch, so a relaunch
    // shows as a rise in MainActivity onCreate calls; an unknown count proves nothing either way.
    const counted =
      Number.isInteger(before.identity.onCreate) &&
      Number.isInteger(after.identity.onCreate)
    const recreated =
      before.identity.activity !== after.identity.activity ||
      (counted && after.identity.onCreate > before.identity.onCreate)
    const checks = {
      applied: change.expect(after),
      routeKept: SCREENS[name].anchors.every((anchor) => ids.has(anchor)),
      processKept: before.pid === after.pid,
      activity: counted && (change.inPlace ? !recreated : recreated),
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
// A 4 MiB event buffer holds a whole journey's wm_on_create_called entries.
if (platform === 'android') adb('logcat', '-b', 'events', '-G', '4M')
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
    activeVolatile = SCREENS[name]?.volatile ?? []
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
      try {
        launch()
        maestro(SCREENS[name].flow)
        reactNativeVersion = readEnvironment(
          flattenHierarchy(hierarchy(), { platform, volatile: activeVolatile })
        ).reactNativeVersion
        if (!reactNativeVersion)
          throw new Error('live_font_installed_rn_version_unreadable')
      } catch (error) {
        // A failure before the journey still writes the report and fails the exit code.
        results.push({
          screen: name,
          error: { error: error.message.split(':')[0], message: error.message },
        })
        continue
      }
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
  scalePath,
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
