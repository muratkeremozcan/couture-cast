// Story 6.9 `share-sheet` native command: the fixture share outcomes, the real-sheet smoke and the
// native presenter or receiver test, on the owned device the runner was given. Public output is
// closed: case ids and failure codes, never digests, file names or paths.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile, spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { xcodebuildFailureReport } from './share-card-audit-report.mjs'
import { story68FocusObservationHandler } from './story68-ios-focus-observation.mjs'

export const SHARE_FILE_PATTERN = /^cc69-share-[a-f0-9-]+\.png$/i
export const SHARE_LEASE_MS = 30 * 60_000
// A file written in the same second as the device clock read can read up to a second ahead.
const CLOCK_TOLERANCE_MS = 2_000
const DEV_CLIENT_URL = `couturecast-story68://expo-development-client/?url=${encodeURIComponent('http://127.0.0.1:8089')}`
const FIXTURE_URL = 'couturecast-story68://__story68__/share-card?mode='

export const SHARE_FIXTURE_MODES = Object.freeze([
  'real',
  'share_completed_instagram',
  'share_chosen_pinterest',
  'share_target_other',
  'share_closed',
  'share_not_confirmed',
  'share_failed',
  'share_unavailable',
])

/** Catalog keys under `shareCard` and the Maestro variables the share flows read them from. */
export const SHARE_COPY_ENV = Object.freeze({
  sharing: 'MAESTRO_SHARING',
  shared: 'MAESTRO_SHARED',
  sentToApp: 'MAESTRO_SENT_TO_APP',
  shareClosed: 'MAESTRO_SHARE_CLOSED',
  shareFailed: 'MAESTRO_SHARE_FAILED',
  shareUnavailable: 'MAESTRO_SHARE_UNAVAILABLE',
})

/**
 * The share copy as Maestro text selectors. Maestro matches text as a regular expression, so the
 * copy is escaped and an ellipsis or a question mark in any locale matches itself.
 */
export function shareCopyEnv(catalog) {
  const copy = catalog?.shareCard ?? {}
  return Object.fromEntries(
    Object.entries(SHARE_COPY_ENV).map(([key, name]) => {
      const value = copy[key]
      if (typeof value !== 'string' || !value.trim())
        throw new Error('share_copy_missing')
      return [name, value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')]
    })
  )
}

/**
 * The plan, in run order. Consecutive steps settle on different copy, so a step can never pass on
 * the copy its predecessor left (tap-share.yaml also asserts this). `save` proves the lock was
 * released with a real Save and its original; `handoff` proves the exact preview bytes reached a
 * fresh leased cc69-share file; `relaunch` closes the composer, restarts the app and proves the
 * same file is still leased.
 */
export const SHARE_SHEET_STEPS = Object.freeze({
  ios: Object.freeze([
    { id: 'M-SHARE-FAILED', mode: 'share_failed', flow: 'share-failed.yaml', save: true },
    {
      id: 'M-SHARE-UNAVAILABLE',
      mode: 'share_unavailable',
      flow: 'share-unavailable.yaml',
      save: true,
    },
    {
      id: 'M-SHARE-COMPLETED',
      mode: 'share_completed_instagram',
      flow: 'share-completed.yaml',
    },
    { id: 'M-SHARE-CLOSED', mode: 'share_closed', flow: 'share-closed.yaml' },
    { id: 'M-SHARE-OTHER', mode: 'share_target_other', flow: 'share-other.yaml' },
    { id: 'M-SHARE-SHEET-IOS', mode: 'real', flow: 'share-sheet.yaml', handoff: true },
  ]),
  android: Object.freeze([
    { id: 'M-SHARE-FAILED', mode: 'share_failed', flow: 'share-failed.yaml', save: true },
    {
      id: 'M-SHARE-UNAVAILABLE',
      mode: 'share_unavailable',
      flow: 'share-unavailable.yaml',
      save: true,
    },
    { id: 'M-SHARE-CLOSED', mode: 'share_closed', flow: 'share-closed.yaml' },
    { id: 'M-SHARE-OTHER', mode: 'share_target_other', flow: 'share-other.yaml' },
    {
      id: 'M-SHARE-NOT-CONFIRMED',
      mode: 'share_not_confirmed',
      flow: 'share-not-confirmed.yaml',
    },
    {
      id: 'M-SHARE-CHOSEN',
      mode: 'share_chosen_pinterest',
      flow: 'share-chosen.yaml',
      handoff: true,
      save: true,
      relaunch: true,
    },
    {
      id: 'M-SHARE-SHEET-ANDROID',
      mode: 'real',
      flow: 'share-sheet.yaml',
      handoff: true,
    },
  ]),
})

/** The native test each platform runs after the flows, with the case id it reports. */
export const SHARE_SHEET_NATIVE_CASE = Object.freeze({
  ios: 'N-IOS-PRESENTER-UI',
  android: 'N-AND-RECEIVE',
})

const FRESH_RUNTIME_FLOWS = [
  'maestro/story65/open-app.yaml',
  'maestro/story65/set-locale.yaml',
]
const OPEN_FLOW = 'maestro/story68/open-outfit.yaml'
const CLOSE_FLOW = 'maestro/story68/cancel.yaml'
const SAVE_FLOW = 'maestro/story68/save.yaml'

/** Every Maestro flow the command runs on a platform, in order; the lane budget counts these. */
export function shareSheetFlowRuns(platform) {
  const steps = SHARE_SHEET_STEPS[platform]
  if (!steps) throw new Error('share_sheet_platform_required')
  return [
    ...FRESH_RUNTIME_FLOWS,
    OPEN_FLOW,
    ...steps.flatMap((step) => [
      `maestro/story68/${step.flow}`,
      ...(step.save ? [SAVE_FLOW] : []),
      ...(step.relaunch ? [CLOSE_FLOW, ...FRESH_RUNTIME_FLOWS, OPEN_FLOW] : []),
    ]),
    CLOSE_FLOW,
  ]
}

/**
 * The composer's state from one hierarchy read: the loaded preview's digest and Share's offset
 * below the preview's bottom edge, in the platform's hierarchy units. Only the feedback slot sits
 * between the two, and the offset holds while the composer scrolls, so a changed offset means
 * status or error copy moved Share, the iPad popover anchor.
 */
export function readComposerLayout(hierarchy) {
  let preview
  let share
  const visit = (node) => {
    const id = node?.attributes?.['resource-id'] ?? ''
    const bounds = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(
      node?.attributes?.bounds ?? ''
    )
    if (bounds) {
      const [top, bottom] = [Number(bounds[2]), Number(bounds[4])]
      const digest = /^share-card-preview-loaded-([a-f0-9]{64})$/.exec(id)?.[1]
      if (digest) preview = { digest, bottom }
      if (id === 'share-card-share') share = { top, height: bottom - top }
    }
    for (const child of node?.children ?? []) visit(child)
  }
  visit(JSON.parse(hierarchy))
  if (!preview) throw new Error('loaded_approved_preview_required')
  if (!share || !(share.height > 0)) throw new Error('share_action_required')
  return {
    digest: preview.digest,
    share: { offset: share.top - preview.bottom, height: share.height },
  }
}

/**
 * A step's copy replaced the earlier state's (resting, one line or two) in the reserved feedback
 * slot, so Share kept its frame.
 */
export function assertShareStill(previous, settled) {
  if (
    settled.share.offset !== previous.share.offset ||
    settled.share.height !== previous.share.height
  )
    throw new Error('share_action_moved')
}

/** Save proofs the command runs on a platform; each costs one extract. */
export const shareSheetSaveProofs = (platform) =>
  (SHARE_SHEET_STEPS[platform] ?? []).filter((step) => step.save).length

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Proves one attempt handed off exactly the previewed bytes: exactly one cc69-share file is new
 * since `before`, it is a PNG whose SHA256 equals the preview digest, and its modification time
 * (the lease age) is inside the 30 minute lease. Returns the file name for later lease checks.
 */
export function assertFreshShareFile(store, before, digest) {
  const fresh = store.list().filter((name) => !before.includes(name))
  if (fresh.length !== 1) throw new Error('share_handoff_file_count')
  assertLeasedShareFile(store, fresh[0], digest)
  return fresh[0]
}

/** The named handoff file is still present, unchanged and inside its lease. */
export function assertLeasedShareFile(store, name, digest) {
  if (!SHARE_FILE_PATTERN.test(name) || !store.list().includes(name))
    throw new Error('share_handoff_file_removed')
  const bytes = store.read(name)
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE) || sha256(bytes) !== digest)
    throw new Error('share_handoff_digest_mismatch')
  const age = store.ageMs(name)
  if (!Number.isFinite(age) || age < -CLOCK_TOLERANCE_MS || age >= SHARE_LEASE_MS)
    throw new Error('share_handoff_lease_invalid')
}

/** The app's `cache/share-cards` handoff files on the owned simulator, read from its container. */
export function iosShareFileStore(ctx) {
  const directory = () =>
    path.join(
      ctx
        .run('xcrun', ['simctl', 'get_app_container', ctx.device, ctx.appId, 'data'])
        .trim(),
      'Library/Caches/share-cards'
    )
  const file = (name) => {
    if (!SHARE_FILE_PATTERN.test(name)) throw new Error('share_handoff_file_removed')
    return path.join(directory(), name)
  }
  return {
    list: () => {
      const dir = directory()
      return fs.existsSync(dir)
        ? fs
            .readdirSync(dir)
            .filter((name) => SHARE_FILE_PATTERN.test(name))
            .sort()
        : []
    },
    read: (name) => fs.readFileSync(file(name)),
    // The simulator shares the host clock.
    ageMs: (name) => Date.now() - fs.statSync(file(name)).mtimeMs,
  }
}

/** The same files on the owned emulator, read through `run-as` in the debuggable app's sandbox. */
export function androidShareFileStore(ctx, execute = spawnSync) {
  const shell = (args) =>
    ctx.run(ctx.adb, ['-s', ctx.device, 'shell', 'run-as', ctx.appId, ...args])
  const relative = (name) => {
    if (!SHARE_FILE_PATTERN.test(name)) throw new Error('share_handoff_file_removed')
    return `cache/share-cards/${name}`
  }
  return {
    // `cache` always exists; `cache/share-cards` only after the first share or save.
    list: () =>
      shell(['find', 'cache', '-maxdepth', '2', '-name', "'cc69-share-*.png'"])
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^cache\/share-cards\/[^/]+$/.test(line))
        .map((line) => line.slice('cache/share-cards/'.length))
        .filter((name) => SHARE_FILE_PATTERN.test(name))
        .sort(),
    read: (name) => {
      const result = execute(
        ctx.adb,
        ['-s', ctx.device, 'exec-out', 'run-as', ctx.appId, 'cat', relative(name)],
        { maxBuffer: 30 * 1024 * 1024, timeout: 60_000 }
      )
      if (result.status !== 0 || result.error)
        throw new Error('share_handoff_file_removed')
      return Buffer.from(result.stdout)
    },
    ageMs: (name) => {
      const modified = Number(shell(['stat', '-c', '%Y', relative(name)]).trim())
      const now = Number(
        ctx.run(ctx.adb, ['-s', ctx.device, 'shell', 'date', '+%s']).trim()
      )
      return (now - modified) * 1000
    },
  }
}

/** The share-card-native-share Android namespace, read from the module's own Gradle file. */
export function shareModuleNamespace(root) {
  for (const name of ['build.gradle', 'build.gradle.kts']) {
    const file = path.join(
      root,
      'apps/mobile/modules/share-card-native-share/android',
      name
    )
    if (!fs.existsSync(file)) continue
    const match = /^\s*namespace\s*=?\s*["']([A-Za-z][\w.]*)["']/m.exec(
      fs.readFileSync(file, 'utf8')
    )
    if (match) return match[1]
  }
  throw new Error('share_receive_namespace_required')
}

// ASSUMPTION (workstream B owns the module): Expo autolinking names a local module's Gradle
// project after its directory, as it does for `:accessibility-focus`, so the androidTest APK is
// share-card-native-share-debug-androidTest.apk and the test class is
// `<namespace>.ShareCardShareReceiveTest`, run by AndroidJUnitRunner from `<namespace>.test`.
export const SHARE_RECEIVE_GRADLE_TASK =
  ':share-card-native-share:assembleDebugAndroidTest'
export const SHARE_RECEIVE_APK =
  'apps/mobile/modules/share-card-native-share/android/build/outputs/apk/androidTest/debug/share-card-native-share-debug-androidTest.apk'
export const SHARE_RECEIVE_TEST_CLASS = 'ShareCardShareReceiveTest'

/** Passes only an instrumentation run that reported at least one test and nothing else. */
export function assertShareReceiveInstrumentation(log) {
  const ok = /^OK \((\d+) tests?\)\s*$/m.exec(log)
  if (
    !ok ||
    Number(ok[1]) < 1 ||
    /FAILURES!!!|INSTRUMENTATION_FAILED|INSTRUMENTATION_RESULT: shortMsg=|Process crashed/.test(
      log
    )
  )
    throw new Error('share_receive_android_test_failed')
  return { tests: Number(ok[1]) }
}

/** The closed shape of a failed instrumentation run: counts only, no test output. */
export function shareReceiveFailureSummary(log) {
  const run = /^Tests run: (\d+),\s+Failures: (\d+)/m.exec(log)
  return {
    testsRun: run ? Number(run[1]) : null,
    failures: run ? Number(run[2]) : null,
    crashed: /Process crashed|INSTRUMENTATION_RESULT: shortMsg=/.test(log),
    instrumentationFailed: /INSTRUMENTATION_FAILED/.test(log),
  }
}

export const SHARE_SHEET_UITEST_CLASS = 'ShareCardShareSheetUITests'
export const SHARE_SHEET_UITEST_MARKERS = Object.freeze([
  'CC69_PRESENTER_ANCHOR_PASS',
  'CC69_PRESENTER_CLOSED_PASS',
])

/**
 * The xcodegen spec for the presenter XCUITest, generated beside the copied sources so no
 * generated native project is edited. Every `ShareCardShareSheet*.swift` in native-tests is a
 * source, and `share-sheet-fixture.json` carries the localized copy the test may read.
 */
export function shareSheetUITestProject(sources) {
  return [
    'name: ShareCardShareSheet',
    'options:',
    '  deploymentTarget:',
    "    iOS: '17.0'",
    'targets:',
    `  ${SHARE_SHEET_UITEST_CLASS}:`,
    '    type: bundle.ui-testing',
    '    platform: iOS',
    '    sources:',
    ...sources.map((source) => `      - ${source}`),
    '      - path: share-sheet-fixture.json',
    '        buildPhase: resources',
    '    settings:',
    '      base:',
    '        PRODUCT_BUNDLE_IDENTIFIER: com.couturecast.story68.sharesheettests',
    '        GENERATE_INFOPLIST_FILE: YES',
    "        SWIFT_VERSION: '5.0'",
    '        INFOPLIST_KEY_NSAppTransportSecurity_NSAllowsLocalNetworking: YES',
    "        CODE_SIGN_IDENTITY: '-'",
    '        CODE_SIGNING_ALLOWED: YES',
    '        CODE_SIGNING_REQUIRED: NO',
    'schemes:',
    '  ShareCardShareSheet:',
    '    build:',
    '      targets:',
    `        ${SHARE_SHEET_UITEST_CLASS}: all`,
    '    test:',
    '      targets:',
    `        - ${SHARE_SHEET_UITEST_CLASS}`,
    '',
  ].join('\n')
}

/**
 * Passes only a result bundle in which every test case belongs to the presenter class and passed,
 * with at least one case and none failed or skipped.
 */
export function assertShareSheetUITestResult(summary, tree) {
  const tests = []
  const visit = (node) => {
    if (node?.nodeType === 'Test Case') tests.push(node)
    for (const child of node?.children ?? []) visit(child)
  }
  for (const node of tree?.testNodes ?? []) visit(node)
  if (
    summary?.result !== 'Passed' ||
    !(summary.totalTestCount >= 1) ||
    summary.passedTests !== summary.totalTestCount ||
    (summary.failedTests ?? 0) !== 0 ||
    (summary.skippedTests ?? 0) !== 0 ||
    tests.length !== summary.totalTestCount ||
    tests.some(
      (test) =>
        !String(test.nodeIdentifier ?? '').startsWith(`${SHARE_SHEET_UITEST_CLASS}/`) ||
        test.result !== 'Passed'
    )
  )
    throw new Error('share_sheet_ios_uitest_failed')
  return { tests: tests.length }
}

const CLOSED_CODES = Object.freeze([
  'share_copy_missing',
  'share_composition_changed',
  'share_handoff_file_count',
  'share_handoff_file_removed',
  'share_handoff_digest_mismatch',
  'share_handoff_lease_invalid',
  'share_sheet_ios_uitest_failed',
  'share_receive_android_test_failed',
  'share_receive_namespace_required',
  'share_sheet_platform_required',
  'loaded_approved_preview_required',
  'share_action_required',
  'share_action_moved',
  'share_save_proof_failed',
])

/** A failure as one closed code; flow failures keep only their class, never the flow output. */
export function closedShareSheetFailure(error) {
  const message = error instanceof Error ? error.message : ''
  if (CLOSED_CODES.includes(message)) return message
  if (message.startsWith('native_flow_failed:')) return 'native_flow_failed'
  return 'share_sheet_failed'
}

function recorded(ctx, binary, args, name, { timeout, env = {} }) {
  const execute = ctx.spawnSync ?? spawnSync
  const file = path.join(ctx.directory, name)
  const fd = fs.openSync(file, 'w', 0o600)
  let result
  try {
    result = execute(binary, args, {
      cwd: ctx.root,
      env: { ...process.env, ...env },
      stdio: ['ignore', fd, fd],
      detached: true,
      timeout,
      killSignal: 'SIGTERM',
    })
  } finally {
    fs.closeSync(fd)
  }
  if (result.error?.code === 'ETIMEDOUT' && result.pid) {
    try {
      process.kill(-result.pid, 'SIGKILL')
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
  return { ok: !result.error && result.status === 0, log: fs.readFileSync(file, 'utf8') }
}

/**
 * The share module's test-build anchor report, `Documents/cc69-share-anchor.json` in the owned
 * app's container, served read-only at `/share-anchor`: 404 before the first presentation, the
 * closed record after it, 503 for anything malformed or outside the owned container.
 */
export function shareAnchorHandler({
  device,
  appId,
  readContainer,
  readFile = fs.readFileSync,
}) {
  if (appId !== 'com.couturecast.story68' || !/^[A-Fa-f0-9-]{36}$/.test(device))
    throw new Error('owned_ios_share_anchor_required')
  return (request, response) => {
    if (request.url !== '/share-anchor') return false
    if (request.method !== 'GET') {
      response.writeHead(405).end()
      return true
    }
    const serve = (container) => {
      try {
        const directory = String(container).trim()
        if (
          !path.isAbsolute(directory) ||
          !directory.includes(`/Devices/${device}/data/Containers/Data/Application/`)
        )
          throw new Error('owned_container_required')
        let text
        try {
          text = readFile(
            path.join(directory, 'Documents/cc69-share-anchor.json'),
            'utf8'
          )
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
          response.writeHead(404).end()
          return
        }
        const record = JSON.parse(text)
        const rect = record.sourceRect
        if (
          !/^[a-f0-9-]{36}$/i.test(record.session) ||
          !Number.isSafeInteger(record.sequence) ||
          record.sequence < 0 ||
          ![
            'presented',
            'mainThread',
            'sourceViewSet',
            'sourceViewIsPresenterView',
          ].every((key) => typeof record[key] === 'boolean') ||
          !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rect?.[key]))
        )
          throw new Error('invalid_record')
        response
          .writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          })
          .end(
            JSON.stringify({
              session: record.session,
              sequence: record.sequence,
              presented: record.presented,
              mainThread: record.mainThread,
              sourceViewSet: record.sourceViewSet,
              sourceViewIsPresenterView: record.sourceViewIsPresenterView,
              sourceRect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
            })
          )
      } catch {
        response.writeHead(503).end()
      }
    }
    try {
      const container = readContainer()
      if (typeof container?.then === 'function')
        container.then(serve, () => response.writeHead(503).end())
      else serve(container)
    } catch {
      response.writeHead(503).end()
    }
    return true
  }
}

const execFileText = promisify(execFile)
/**
 * The owned app's data container, looked up asynchronously once and kept, so a starved host never
 * blocks the loop that answers the XCUITest (see withIosFocusObservation). A failed lookup is
 * forgotten and the next request asks again.
 */
function cachedContainer(ctx) {
  const lookup =
    ctx.readContainer ??
    (async () =>
      (
        await execFileText(
          'xcrun',
          ['simctl', 'get_app_container', ctx.device, ctx.appId, 'data'],
          { timeout: 60_000 }
        )
      ).stdout)
  let pending
  return () => {
    const attempt = (pending ??= Promise.resolve()
      .then(lookup)
      .catch((error) => {
        if (pending === attempt) pending = undefined
        throw error
      }))
    return attempt
  }
}

/**
 * The loopback ingress ShareCardShareSheetUITests talks to while it runs: `/fixture?mode=` for the
 * share modes (as the a11y runner serves its own modes), `/focus-observation` for the posted
 * focus request and `/share-anchor` for the presenter's anchor report.
 */
export async function withShareFixtureIngress(
  ctx,
  work,
  port = ctx.fixturePort ?? 63068
) {
  const readContainer = cachedContainer(ctx)
  const routes = [
    story68FocusObservationHandler({
      device: ctx.device,
      appId: ctx.appId,
      readContainer,
    }),
    shareAnchorHandler({ device: ctx.device, appId: ctx.appId, readContainer }),
  ]
  const server = createServer((request, response) => {
    if (routes.some((route) => route(request, response))) return
    const url = new URL(request.url, 'http://127.0.0.1')
    const mode = url.searchParams.get('mode')
    if (url.pathname !== '/fixture' || !SHARE_FIXTURE_MODES.includes(mode)) {
      response.writeHead(400).end()
      return
    }
    try {
      ctx.openUrl(`${FIXTURE_URL}${mode}`)
      response.writeHead(200).end()
    } catch {
      response.writeHead(503).end()
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  try {
    return await work(server.address().port)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

/** N-IOS-PRESENTER-UI: ShareCardShareSheetUITests against the installed dev client. */
export async function runShareSheetUITest(ctx) {
  const generated = path.join(ctx.directory, 'share-sheet-project')
  fs.mkdirSync(generated, { recursive: true, mode: 0o700 })
  const tests = path.join(ctx.root, 'apps/mobile/native-tests')
  const sources = fs
    .readdirSync(tests)
    .filter((name) => /^ShareCardShareSheet\w*\.swift$/.test(name))
    .sort()
  if (!sources.includes(`${SHARE_SHEET_UITEST_CLASS}.swift`))
    throw new Error('share_sheet_ios_uitest_failed')
  for (const name of sources)
    fs.copyFileSync(path.join(tests, name), path.join(generated, name))
  const copy = ctx.catalog.shareCard
  fs.writeFileSync(
    path.join(generated, 'share-sheet-fixture.json'),
    JSON.stringify({
      share: copy.share,
      sharing: copy.sharing,
      shareClosed: copy.shareClosed,
      save: copy.save,
      title: copy.title,
      cancel: copy.cancel,
    }),
    { mode: 0o600 }
  )
  fs.writeFileSync(
    path.join(generated, 'project.yml'),
    shareSheetUITestProject(sources),
    { mode: 0o600 }
  )
  ctx.run('xcodegen', [
    'generate',
    '--spec',
    path.join(generated, 'project.yml'),
    '--project',
    generated,
  ])
  const args = [
    '-project',
    path.join(generated, 'ShareCardShareSheet.xcodeproj'),
    '-scheme',
    'ShareCardShareSheet',
    '-destination',
    `platform=iOS Simulator,id=${ctx.device}`,
    '-collect-test-diagnostics',
    'never',
    '-derivedDataPath',
    path.join(ctx.directory, 'share-sheet-build'),
    'CODE_SIGN_IDENTITY=-',
    'CODE_SIGNING_ALLOWED=YES',
    'CODE_SIGNING_REQUIRED=NO',
  ]
  const build = recorded(
    ctx,
    'xcodebuild',
    ['build-for-testing', ...args],
    'share-sheet-ios-build.log',
    { timeout: 600_000 }
  )
  if (!build.ok) {
    console.log(
      JSON.stringify({ iosShareSheetFailure: xcodebuildFailureReport(build.log) })
    )
    throw new Error('share_sheet_ios_uitest_failed')
  }
  const result = path.join(ctx.directory, `share-sheet-ios-${Date.now()}.xcresult`)
  // The XCUITest asks for fixture modes over loopback while xcodebuild runs, so the run is
  // asynchronous and the event loop stays free to answer it.
  const log = await withShareFixtureIngress(ctx, () =>
    recordedAsync(
      ctx,
      ['test-without-building', ...args, '-resultBundlePath', result],
      'share-sheet-ios.log'
    )
  )
  // Each phase of the test prints its marker once it passed; a run without both proved nothing.
  if (!log.ok || SHARE_SHEET_UITEST_MARKERS.some((marker) => !log.log.includes(marker))) {
    console.log(
      JSON.stringify({ iosShareSheetFailure: xcodebuildFailureReport(log.log) })
    )
    throw new Error('share_sheet_ios_uitest_failed')
  }
  const summary = JSON.parse(
    ctx.run('xcrun', ['xcresulttool', 'get', 'test-results', 'summary', '--path', result])
  )
  const tree = JSON.parse(
    ctx.run('xcrun', ['xcresulttool', 'get', 'test-results', 'tests', '--path', result])
  )
  return assertShareSheetUITestResult(summary, tree)
}

function recordedAsync(ctx, args, name, timeout = 300_000) {
  const spawnChild = ctx.spawn ?? spawn
  const file = path.join(ctx.directory, name)
  const fd = fs.openSync(file, 'w', 0o600)
  return new Promise((resolve, reject) => {
    const child = spawnChild('xcodebuild', args, {
      cwd: ctx.root,
      stdio: ['ignore', fd, fd],
      detached: true,
    })
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') reject(error)
      }
    }, timeout)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, log: fs.readFileSync(file, 'utf8') })
    })
  }).finally(() => fs.closeSync(fd))
}

/** N-AND-RECEIVE: the module's receiving-Activity androidTest on the owned emulator. */
export function runShareReceiveTest(ctx) {
  const namespace = shareModuleNamespace(ctx.root)
  const env = {
    ...ctx.read('public-build-env.json'),
    ANDROID_SERIAL: ctx.device,
    ANDROID_HOME: process.env.ANDROID_HOME ?? path.dirname(path.dirname(ctx.adb)),
  }
  ctx.run(
    path.join(ctx.root, 'apps/mobile/android/gradlew'),
    [
      '-p',
      path.join(ctx.root, 'apps/mobile/android'),
      SHARE_RECEIVE_GRADLE_TASK,
      '--max-workers=2',
    ],
    env
  )
  ctx.run(ctx.adb, [
    '-s',
    ctx.device,
    'install',
    '-r',
    '-t',
    path.join(ctx.root, SHARE_RECEIVE_APK),
  ])
  const instrument = recorded(
    ctx,
    ctx.adb,
    [
      '-s',
      ctx.device,
      'shell',
      'am',
      'instrument',
      '-w',
      '-e',
      'class',
      `${namespace}.${SHARE_RECEIVE_TEST_CLASS}`,
      `${namespace}.test/androidx.test.runner.AndroidJUnitRunner`,
    ],
    'share-receive-android.log',
    { timeout: 300_000 }
  )
  try {
    if (!instrument.ok) throw new Error('share_receive_android_test_failed')
    return assertShareReceiveInstrumentation(instrument.log)
  } catch (error) {
    // The instrumentation output stays private; the job log gets counts only.
    console.log(
      JSON.stringify({
        androidShareReceiveFailure: shareReceiveFailureSummary(instrument.log),
      })
    )
    throw error
  }
}

function freshRuntime(ctx) {
  if (ctx.platform === 'ios')
    ctx.run('xcrun', ['simctl', 'terminate', ctx.device, ctx.appId])
  else ctx.run(ctx.adb, ['-s', ctx.device, 'shell', 'am', 'force-stop', ctx.appId])
  ctx.openUrl(DEV_CLIENT_URL)
  ctx.maestro(FRESH_RUNTIME_FLOWS[0])
  ctx.maestro(FRESH_RUNTIME_FLOWS[1], { MAESTRO_LOCALE: 'en-US' })
}

/**
 * Runs the plan for the runner's platform. `ctx` carries the runner's owned-device helpers:
 * maestro, run, openUrl, read, privateJson, composerLayout, captureApproved, extract and the
 * en-US catalog. The runner signs in before this command; a fresh runtime starts it, so it does
 * not depend on what ran before it in the lane.
 */
export async function runStory69ShareSheet(ctx) {
  const report = { platform: ctx.platform, passed: false, cases: [] }
  const name = `native-share-sheet-${ctx.platform}.json`
  ctx.privateJson(name, report)
  try {
    const steps = SHARE_SHEET_STEPS[ctx.platform]
    if (!steps) throw new Error('share_sheet_platform_required')
    const env = shareCopyEnv(ctx.catalog)
    const store =
      ctx.store ??
      (ctx.platform === 'ios' ? iosShareFileStore(ctx) : androidShareFileStore(ctx))
    const fixture = (mode) => ctx.openUrl(`${FIXTURE_URL}${mode}`)
    const mark = (id) => {
      report.cases.push(id)
      ctx.privateJson(name, report)
    }
    freshRuntime(ctx)
    fixture('real')
    ctx.maestro(OPEN_FLOW)
    for (const step of steps) {
      fixture(step.mode)
      const previous = ctx.composerLayout()
      const digest = previous.digest
      const before = step.handoff ? store.list() : []
      ctx.maestro(`maestro/story68/${step.flow}`, env)
      const settled = ctx.composerLayout()
      // The digest covers the composition and the watermark choice.
      if (settled.digest !== digest) throw new Error('share_composition_changed')
      assertShareStill(previous, settled)
      const handoff = step.handoff
        ? assertFreshShareFile(store, before, digest)
        : undefined
      if (step.save) {
        ctx.captureApproved()
        ctx.maestro(SAVE_FLOW)
        try {
          ctx.extract()
        } catch (error) {
          throw new Error('share_save_proof_failed', { cause: error })
        }
        // Save's settlement cleanup and the cc68 orphan sweep leave the share lease alone.
        if (handoff) assertLeasedShareFile(store, handoff, digest)
      }
      if (step.relaunch) {
        ctx.maestro(CLOSE_FLOW)
        freshRuntime(ctx)
        assertLeasedShareFile(store, handoff, digest)
        fixture('real')
        ctx.maestro(OPEN_FLOW)
      }
      mark(step.id)
    }
    fixture('real')
    ctx.maestro(CLOSE_FLOW)
    if (ctx.platform === 'ios') await runShareSheetUITest(ctx)
    else runShareReceiveTest(ctx)
    mark(SHARE_SHEET_NATIVE_CASE[ctx.platform])
    report.passed = true
    ctx.privateJson(name, report)
    console.log(JSON.stringify({ shareSheet: report }))
  } catch (error) {
    report.code = closedShareSheetFailure(error)
    ctx.privateJson(name, report)
    console.log(JSON.stringify({ shareSheet: report }))
    throw error
  }
}
