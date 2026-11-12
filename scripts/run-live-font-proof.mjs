#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 live font-scale proof on a device (AC3; F-01 to F-08). For each screen:
//   1. cold control: launch cold at the base scale and at the target scale, compare (F-01);
//   2. live change: launch at the base scale, capture, change the scale with the app in the
//      foreground, capture at once and after a stable second, make one React update, then judge
//      against the cold target launch with the oracle;
//   3. the change back down, judged against the cold base launch.
// The device scale is restored in `finally`. Captures, screenshots and verdicts are private
// evidence under --out.
//
//   node scripts/run-live-font-proof.mjs --platform android --device emulator-5584 \
//     --build release --screens home,composer --out <dir> [--app-id com.couturecast.story68]
//     [--rn-version 0.81.5] [--force-fix-expected yes]
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  activityToken,
  assertLiveProvenance,
  countOnCreate,
  flattenHierarchy,
  IOS_CONTENT_SIZES,
  rootIdentity,
  sameLayout,
  stitchPages,
} from './lib/live-font-capture.mjs'
import {
  assertColdControl,
  assertComposerControls,
  assertLiveFontProof,
  evaluateLiveFontChange,
} from './lib/live-font-scale-proof.mjs'

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
const out = path.resolve(option('out'))
const screens = option('screens', 'home,community,settings,composer').split(',')
const forceFix = option('force-fix-expected') === 'yes'
const configChange = option('config-change')
const runLabel = option('label', build)
if (!['android', 'ios'].includes(platform) || !device || !option('out'))
  throw new Error('usage: --platform android|ios --device <id> --out <dir>')
if (!['release', 'debug'].includes(build))
  throw new Error('build_release_or_debug_required')
fs.mkdirSync(out, { recursive: true, mode: 0o700 })

const reactNativeVersion =
  option('rn-version') ??
  JSON.parse(
    fs.readFileSync(path.join(root, 'node_modules/react-native/package.json'), 'utf8')
  ).version
const sdk = path.join(process.env.HOME, 'Library/Android/sdk')
const adbBinary = path.join(sdk, 'platform-tools/adb')
const component = `${appId}/.MainActivity`
const scales =
  platform === 'android'
    ? { base: 1, steps: [1.5] }
    : { base: 'large', steps: ['extra-extra-extra-large', 'accessibility-medium'] }
const numericScale = (scale) =>
  platform === 'android' ? Number(scale) : IOS_CONTENT_SIZES[scale]

const SCREENS = {
  home: {
    flow: 'open-home',
    anchors: ['current-temperature'],
    controls: ['tab-home', 'tab-community', 'tab-settings'],
    probes: [
      { id: 'current-temperature', sizeSp: 48 },
      { id: 'current-condition', sizeSp: 14 },
    ],
    update: 'update-home',
  },
  community: {
    flow: 'open-community',
    anchors: ['community-new-post-button'],
    controls: ['tab-home', 'tab-community', 'tab-settings'],
    probes: [],
  },
  settings: {
    flow: 'open-settings',
    anchors: ['settings-language-title'],
    controls: ['tab-home', 'tab-community', 'tab-settings'],
    probes: [{ id: 'settings-language-title', sizeSp: 16 }],
  },
  composer: {
    flow: 'open-composer',
    anchors: ['share-card-title'],
    probes: [],
    update: 'update-composer',
    controls: ['share-card-save', 'share-card-share', 'share-card-cancel'],
    composer: true,
  },
}

function run(binary, args, { allowFail = false, timeout = 120_000 } = {}) {
  const result = spawnSync(binary, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout,
    killSignal: 'SIGKILL',
  })
  if (!allowFail && (result.status !== 0 || result.error))
    throw new Error(
      `live_font_command_failed:${path.basename(binary)} ${args.slice(0, 4).join(' ')}:${result.status}:${String(result.stderr).slice(-800)}`
    )
  return result.stdout
}
const adb = (...args) => run(adbBinary, ['-s', device, ...args])
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function maestro(flow, env = {}) {
  const vars = Object.entries({
    MAESTRO_APP_ID: appId,
    MAESTRO_BACK: 'Back',
    ...env,
  }).flatMap(([key, value]) => ['-e', `${key}=${value}`])
  run('maestro', ['--device', device, 'test', ...vars, path.join(root, flow)], {
    timeout: 240_000,
  })
}

function hierarchy() {
  const raw = run('maestro', ['--device', device, 'hierarchy'], { timeout: 120_000 })
  const start = raw.indexOf('{')
  if (start < 0) throw new Error('live_font_hierarchy_invalid')
  return JSON.parse(raw.slice(start))
}

function setScale(scale) {
  if (platform === 'android')
    adb('shell', 'settings', 'put', 'system', 'font_scale', String(scale))
  else run('xcrun', ['simctl', 'ui', device, 'content_size', scale])
}
function readScale() {
  if (platform === 'android')
    return adb('shell', 'settings', 'get', 'system', 'font_scale').trim()
  return run('xcrun', ['simctl', 'ui', device, 'content_size']).trim()
}

function pid() {
  if (platform === 'android') return adb('shell', 'pidof', appId).trim() || undefined
  const listing = run('xcrun', ['simctl', 'spawn', device, 'launchctl', 'list'])
  const line = listing
    .split('\n')
    .find((entry) => entry.includes(`UIKitApplication:${appId}`))
  return line?.trim().split(/\s+/)[0]
}

function identity(markers) {
  const facts = { root: rootIdentity(markers) }
  if (platform === 'android') {
    facts.activity = activityToken(
      adb('shell', 'dumpsys', 'activity', 'top', '-a'),
      component
    )
    facts.onCreate = countOnCreate(adb('logcat', '-b', 'events', '-d'), component)
  }
  return facts
}

function screenshot(name) {
  const file = path.join(out, `${name}.png`)
  if (platform === 'android') {
    const result = spawnSync(adbBinary, ['-s', device, 'exec-out', 'screencap', '-p'], {
      maxBuffer: 64 * 1024 * 1024,
    })
    fs.writeFileSync(file, result.stdout, { mode: 0o600 })
  } else run('xcrun', ['simctl', 'io', device, 'screenshot', file])
}

let launchCount = 0
let launchId

function capture(stage, scale, name) {
  const tree = hierarchy()
  const flat = flattenHierarchy(tree, { platform })
  const result = {
    stage,
    launch: launchId,
    fontScale: numericScale(scale),
    osScale: readScale(),
    jsFontScale: flat.jsFontScale,
    pid: pid(),
    identity: identity(flat.markers),
    nodes: flat.nodes,
    controls: flat.controls,
    window: tree.attributes?.bounds,
  }
  persist(result, name)
  screenshot(name)
  return result
}

function persist(result, name) {
  Object.defineProperty(result, 'file', {
    value: name,
    enumerable: false,
    writable: true,
  })
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(result, null, 2), {
    mode: 0o600,
  })
}

/** Adds the scroll-through text to a capture and rewrites its evidence file. */
async function withFullText(result) {
  result.fullText = await scrollThrough(result)
  persist(result, result.file)
  return result
}

function windowSize(capture) {
  const match = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(capture.window ?? '')
  return match
    ? { width: Number(match[3]), height: Number(match[4]) }
    : { width: 1080, height: 2400 }
}
function swipe(size, up) {
  const x = Math.round(size.width / 2)
  const [from, to] = up ? [0.7, 0.35] : [0.35, 0.7]
  if (platform === 'android')
    adb(
      'shell',
      'input',
      'swipe',
      String(x),
      String(Math.round(size.height * from)),
      String(x),
      String(Math.round(size.height * to)),
      // A slow drag stops where the finger lifts; a fast one flings on after the capture.
      '1500'
    )
  else
    maestro('maestro/live-font/swipe.yaml', {
      MAESTRO_SWIPE: up ? 'UP' : 'DOWN',
    })
}

/** Scroll through the screen and back, returning the stitched text multiset. */
/** The visible text once two hierarchies half a second apart agree. */
async function stablePage() {
  let previous = flattenHierarchy(hierarchy(), { platform }).nodes
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await pause(500)
    const current = flattenHierarchy(hierarchy(), { platform }).nodes
    if (sameLayout(current, previous)) return current
    previous = current
  }
  throw new Error('live_font_scroll_page_unstable')
}

async function scrollThrough(first) {
  const size = windowSize(first)
  const pages = [first.nodes]
  let swipes = 0
  for (; swipes < 12; swipes += 1) {
    swipe(size, true)
    const page = await stablePage()
    if (sameLayout(page, pages[pages.length - 1])) break
    pages.push(page)
  }
  for (let back = 0; back <= swipes + 1; back += 1) swipe(size, false)
  await pause(700)
  fs.appendFileSync(
    path.join(out, 'scroll-through.log'),
    `${first.stage} ${first.fontScale} pages=${pages.length} swipes=${swipes} nodes=${pages.map((page) => page.length).join(',')}\n`
  )
  fs.writeFileSync(
    path.join(out, `${first.file ?? first.stage}-pages.json`),
    JSON.stringify(pages),
    { mode: 0o600 }
  )
  return pages.length === 1 ? undefined : stitchPages(pages)
}

async function settle(stage, scale, label) {
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
    } else if (Date.now() - since >= 1000) return capture(stage, scale, label)
  }
  throw new Error(`live_font_stable_state_deadline:${label}`)
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
    run('xcrun', ['simctl', 'terminate', device, appId], { allowFail: true })
    run('xcrun', ['simctl', 'launch', device, appId])
  }
  maestro('maestro/story65/open-app.yaml')
}

async function coldScreen(name, scale, label) {
  setScale(scale)
  launch()
  maestro(`maestro/live-font/${SCREENS[name].flow}.yaml`)
  return withFullText(await settle('cold', scale, label))
}

const baselines = JSON.parse(
  fs.readFileSync(
    path.join(root, 'scripts/lib/fixtures/live-font-residual-baselines.json'),
    'utf8'
  )
).entries

function residualBaseline(name, from, to) {
  return baselines.find(
    (entry) =>
      entry.platform === platform &&
      entry.build === runLabel &&
      entry.screen === name &&
      String(entry.from) === String(from) &&
      String(entry.to) === String(to)
  )
}

async function coldReferences(name, screen, target) {
  const coldBase = await coldScreen(name, scales.base, `${name}-cold-base`)
  const coldTarget = await coldScreen(name, target, `${name}-cold-target`)
  let coldUpdated
  if (screen.update) {
    maestro(`maestro/live-font/${screen.update}.yaml`)
    coldUpdated = await settle('cold', target, `${name}-cold-target-updated`)
  }
  const control = screen.probes.length
    ? assertColdControl({
        platform,
        androidApi,
        base: coldBase,
        target: coldTarget,
        probes: screen.probes,
      })
    : { skipped: 'no probe with a testID on this screen' }
  return { coldBase, coldTarget, coldUpdated, control }
}

async function liveChange(name, screen, from, to) {
  const tag = `${name}-${from}-to-${to}`
  setScale(from)
  launch()
  maestro(`maestro/live-font/${screen.flow}.yaml`)
  const before = await settle('before', from, `${tag}-before`)
  await withFullText(before)
  const top = flattenHierarchy(hierarchy(), { platform }).nodes
  if (!sameLayout(top, before.nodes))
    throw new Error(`live_font_scroll_not_restored:${tag}`)
  setScale(to)
  const immediate = capture('immediate', to, `${tag}-immediate`)
  const settled = await settle('settled', to, `${tag}-settled`)
  await withFullText(settled)
  return { before, immediate, settled }
}

function judge(name, screen, change, from, to) {
  try {
    assertLiveProvenance({ ...change, platform })
    return assertLiveFontProof({
      reactNativeVersion: forceFix ? '0.87.0' : reactNativeVersion,
      residualBaseline: residualBaseline(name, from, to),
      ...change,
    })
  } catch (error) {
    // The checks still describe what happened, so a failed run reports them.
    let checks
    try {
      checks = evaluateLiveFontChange(change)
    } catch {
      checks = undefined
    }
    return { error: error.code ?? error.message, message: error.message, ...checks }
  }
}

function composerControls(settled) {
  try {
    return assertComposerControls({
      capture: settled,
      window: settled.window,
      minTarget: Math.floor((platform === 'android' ? 48 : 44) * densityFactor()),
    })
  } catch (error) {
    return { error: error.code, message: error.message }
  }
}

async function proveScreen(name) {
  const screen = SCREENS[name]
  const [target] = scales.steps
  const refs = await coldReferences(name, screen, target)
  const report = { screen: name, control: refs.control, changes: [] }
  for (const [from, to, cold] of [
    [scales.base, target, refs.coldTarget],
    [target, scales.base, refs.coldBase],
  ]) {
    const live = await liveChange(name, screen, from, to)
    let updated
    if (screen.update && to === target) {
      maestro(`maestro/live-font/${screen.update}.yaml`)
      updated = await settle('updated', to, `${name}-${from}-to-${to}-updated`)
    }
    const change = {
      platform,
      androidApi,
      ...live,
      cold,
      ...(updated ? { updated, coldUpdated: refs.coldUpdated } : {}),
      anchors: screen.anchors,
      probes: screen.probes.length
        ? screen.probes
        : [{ id: screen.anchors[0], sizeSp: 16 }],
      requiredControls: screen.controls,
    }
    const verdict = judge(name, screen, change, from, to)
    if (screen.composer) verdict.composer = composerControls(live.settled)
    report.changes.push({ from, to, ...summarize(change, verdict) })
  }
  return report
}

/**
 * Configuration changes other than font scale (R2-03): a live theme change Android handles in
 * place, and locale and density changes that still recreate the Activity. Each records the
 * identity facts and whether the route and its text came back.
 */
async function proveConfigChange(name, kind) {
  const screen = SCREENS[name]
  setScale(scales.base)
  launch()
  maestro(`maestro/live-font/${screen.flow}.yaml`)
  const before = await settle('before', scales.base, `${name}-${kind}-before`)
  const apply = {
    theme: () => adb('shell', 'cmd', 'uimode', 'night', 'yes'),
    locale: () =>
      adb('shell', 'cmd', 'locale', 'set-app-locales', appId, '--locales', 'fr-FR'),
    density: () => adb('shell', 'wm', 'density', '480'),
  }[kind]
  const revert = {
    theme: () => adb('shell', 'cmd', 'uimode', 'night', 'no'),
    locale: () =>
      adb('shell', 'cmd', 'locale', 'set-app-locales', appId, '--locales', ''),
    density: () => adb('shell', 'wm', 'density', 'reset'),
  }[kind]
  if (!apply) throw new Error(`live_font_unknown_config_change:${kind}`)
  try {
    apply()
    const after = await settle('settled', scales.base, `${name}-${kind}-after`)
    const ids = (capture) => new Set(capture.nodes.map((node) => node.id).filter(Boolean))
    return {
      screen: name,
      configChange: kind,
      pids: [before.pid, after.pid],
      activities: [before.identity.activity, after.identity.activity],
      onCreate: [before.identity.onCreate, after.identity.onCreate],
      roots: [before.identity.root, after.identity.root],
      recreated: before.identity.activity !== after.identity.activity,
      remounted: before.identity.root !== after.identity.root,
      anchorsKept: screen.anchors.every((anchor) => ids(after).has(anchor)),
      textNodes: [before.nodes.length, after.nodes.length],
    }
  } finally {
    revert()
  }
}

function densityFactor() {
  const density = /(\d+)\s*$/.exec(adb('shell', 'wm', 'density').trim())
  return density ? Number(density[1]) / 160 : 1
}

function summarize(change, verdict) {
  const probeHeight = (capture, id) => {
    const node = capture.nodes.find((entry) => entry.id === id)
    if (!node) return null
    const match = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(node.bounds)
    return Number(match[4]) - Number(match[2])
  }
  return {
    verdict: verdict.verdict ?? null,
    error: verdict.error ?? null,
    message: verdict.message ?? null,
    baselineReview: verdict.baselineReview ?? false,
    checks: verdict.checks
      ? Object.fromEntries(
          Object.entries(verdict.checks).map(([name, check]) => [name, check.pass])
        )
      : null,
    identity: verdict.checks?.identity ?? {
      pids: [change.before.pid, change.settled.pid],
      activities: [change.before.identity.activity, change.settled.identity.activity],
      onCreate: [change.before.identity.onCreate, change.settled.identity.onCreate],
      roots: [change.before.identity.root, change.settled.identity.root],
    },
    nodes: {
      before: change.before.nodes.length,
      settled: change.settled.nodes.length,
      fullTextBefore: change.before.fullText?.length ?? null,
      fullTextSettled: change.settled.fullText?.length ?? null,
    },
    probes: change.probes.map(({ id }) => ({
      id,
      before: probeHeight(change.before, id),
      settled: probeHeight(change.settled, id),
      cold: probeHeight(change.cold, id),
    })),
    growth: verdict.checks?.growth?.probes ?? null,
    coldParityMisses: verdict.checks?.coldParity?.misses?.length ?? null,
    composer: verdict.composer ?? null,
    scales: {
      os: [change.before.osScale, change.settled.osScale],
      js: [change.before.jsFontScale, change.settled.jsFontScale],
    },
  }
}

const androidApi =
  platform === 'android'
    ? Number(adb('shell', 'getprop', 'ro.build.version.sdk').trim())
    : undefined
const previousScale = readScale()
const started = Date.now()
const results = []
try {
  if (platform === 'android') {
    const flags = adb('shell', 'dumpsys', 'package', appId)
    if (
      build === 'release' &&
      /DEBUGGABLE/.test(flags.split('pkgFlags=')[1]?.split('\n')[0] ?? '')
    )
      throw new Error('non_debuggable_release_required')
  }
  for (const name of screens) {
    if (!SCREENS[name]) throw new Error(`live_font_unknown_screen:${name}`)
    try {
      results.push(
        configChange
          ? await proveConfigChange(name, configChange)
          : await proveScreen(name)
      )
    } catch (error) {
      results.push({ screen: name, error: error.message })
    }
  }
} finally {
  if (platform === 'android') {
    if (previousScale === 'null')
      adb('shell', 'settings', 'delete', 'system', 'font_scale')
    else setScale(previousScale)
  } else setScale(previousScale)
}
const report = {
  platform,
  device,
  build,
  appId,
  label: runLabel,
  reactNativeVersion,
  androidApi,
  configChange: configChange ?? null,
  forcedFixExpected: forceFix,
  wallSeconds: Math.round((Date.now() - started) / 1000),
  results,
}
fs.writeFileSync(
  path.join(out, 'live-font-report.json'),
  JSON.stringify(report, null, 2),
  {
    mode: 0o600,
  }
)
console.log(JSON.stringify(report, null, 2))
