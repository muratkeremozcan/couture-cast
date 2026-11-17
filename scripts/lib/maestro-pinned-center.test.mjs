// CI run 44068684535 (Mobile e2e (Maestro), mobile-e2e-android (10, signed-out), job
// 133989193086): guest-preview.yaml failed with "No visible element found: id:
// guest-preview-exit". The exit button is the last child of the preview screen, so it sits
// on the bottom scroll edge and can never reach the middle. With `centerElement: true`
// Maestro 2.8 swiped five more times with identical bounds and 100% visibility, about 8 s
// of a 20 s timeout, and one extra scroll on a slow emulator pushed the step past it. The
// fixtures are cut from that run's debug maestro.log.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  describePinnedCenterScroll,
  findPinnedCenterScrolls,
  pinnedCenterScrollCauses,
} from './maestro-pinned-center.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

const fixture = (name) =>
  fs.readFileSync(
    new URL(`./fixtures/maestro-pinned-center/${name}`, import.meta.url),
    'utf8'
  )

const tryLines = (bounds, visibility = '1.0') => [
  '12:00:00.000 [ INFO] maestro.orchestra.Orchestra.scrollUntilVisible: Scrolling try count: 0, DeviceWidth: 1080, DeviceWidth: 2400',
  `12:00:00.000 [ INFO] maestro.orchestra.Orchestra.scrollUntilVisible: Element bounds: ${bounds}`,
  `12:00:00.000 [ INFO] maestro.orchestra.Orchestra.scrollUntilVisible: Visibility Percent: ${visibility}`,
]

const start = (name) =>
  `12:00:00.000 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandStart: ${name} RUNNING`
const finish = (name, status = 'COMPLETED') =>
  `12:00:00.000 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandFinished: ${name} ${status}`
const command = (selector) =>
  `12:00:00.000 [ INFO] maestro.orchestra.Orchestra.scrollUntilVisible: Command centerElement: ScrollUntilVisibleCommand(selector=ElementSelector(${selector}, size=null, below=null), direction=DOWN, centerElement=true, label=null, optional=false).centerElement`

describe('findPinnedCenterScrolls', () => {
  test('flags the guest-preview-exit step of run 44068684535', () => {
    assert.deepEqual(findPinnedCenterScrolls(fixture('guest-preview-exit-pinned.txt')), [
      {
        step: 'Scrolling DOWN until id: guest-preview-exit is visible with speed 40, visibility percentage 100%, timeout 20000 ms, with centering enabled',
        selector: 'id: guest-preview-exit',
        bounds: 'Bounds(x=42, y=2096, width=996, height=115)',
        tries: 5,
      },
    ])
  })

  test('passes steps whose bounds moved between tries or that were accepted on the first try', () => {
    // The same run: fleece-zip moved from y=147 to y=523, undo-swaps from y=2197 to
    // y=1337, and swap-shoes and the labelled assertion were accepted at once.
    assert.deepEqual(findPinnedCenterScrolls(fixture('guest-preview-centered.txt')), [])
  })

  test('names a labelled step by its label and its element by the logged selector', () => {
    const name = 'Mobile analytics diagnostics'
    const log = [
      start(name),
      ...tryLines('Bounds(x=42, y=1707, width=996, height=60)'),
      command('textRegex=Mobile analytics diagnostics, idRegex=null'),
      ...tryLines('Bounds(x=42, y=1707, width=996, height=60)'),
      command('textRegex=Mobile analytics diagnostics, idRegex=null'),
      finish(name),
    ].join('\n')
    assert.deepEqual(findPinnedCenterScrolls(log), [
      {
        step: name,
        selector: 'text: Mobile analytics diagnostics',
        bounds: 'Bounds(x=42, y=1707, width=996, height=60)',
        tries: 2,
      },
    ])
  })

  test('attributes tries to the innermost running step of a nested runFlow', () => {
    const inner = 'Scrolling DOWN until id: comment-body is visible'
    const log = [
      start('Run flow subflows/comments.yaml'),
      start(inner),
      ...tryLines('Bounds(x=0, y=1893, width=10, height=10)'),
      ...tryLines('Bounds(x=0, y=1893, width=10, height=10)'),
      finish(inner),
      finish('Run flow subflows/comments.yaml'),
    ].join('\n')
    assert.deepEqual(
      findPinnedCenterScrolls(log).map(({ step, selector }) => ({ step, selector })),
      [{ step: inner, selector: 'id: comment-body' }]
    )
  })

  test('reads the MaestroCommandRunner log format too', () => {
    // Without `--format junit` (run-google-native.mjs) Maestro logs steps through
    // MaestroCommandRunner.runCommands lambdas, with a metadata line after each start.
    const name =
      'Scrolling DOWN until id: guest-preview-exit is visible with speed 40, visibility percentage 100%, timeout 20000 ms, with centering enabled'
    const runner = (lambda, text) =>
      `12:28:34.348 [ INFO] maestro.cli.runner.MaestroCommandRunner.runCommands$lambda$${lambda}: ${text}`
    const log = [
      runner(0, `${name} RUNNING`),
      runner(11, `${name} metadata CommandMetadata(numberOfRuns=null)`),
      ...tryLines('Bounds(x=42, y=2096, width=996, height=115)'),
      ...tryLines('Bounds(x=42, y=2096, width=996, height=115)'),
      runner(2, `${name} COMPLETED`),
    ].join('\n')
    assert.deepEqual(findPinnedCenterScrolls(log), [
      {
        step: name,
        selector: 'id: guest-preview-exit',
        bounds: 'Bounds(x=42, y=2096, width=996, height=115)',
        tries: 2,
      },
    ])
  })

  test('passes repeated bounds while the element was only partly visible', () => {
    const name = 'Scrolling DOWN until id: half is visible'
    const log = [
      start(name),
      ...tryLines('Bounds(x=0, y=2300, width=10, height=200)', '0.5'),
      ...tryLines('Bounds(x=0, y=2300, width=10, height=200)', '0.5'),
      ...tryLines('Bounds(x=0, y=1200, width=10, height=200)'),
      finish(name),
    ].join('\n')
    assert.deepEqual(findPinnedCenterScrolls(log), [])
  })

  test('keeps separate steps apart even when they share bounds', () => {
    const log = [
      start('Scrolling DOWN until id: a is visible'),
      ...tryLines('Bounds(x=0, y=900, width=10, height=10)'),
      finish('Scrolling DOWN until id: a is visible'),
      start('Scrolling DOWN until id: b is visible'),
      ...tryLines('Bounds(x=0, y=900, width=10, height=10)'),
      finish('Scrolling DOWN until id: b is visible'),
    ].join('\n')
    assert.deepEqual(findPinnedCenterScrolls(log), [])
  })

  test('reads an empty or missing log as nothing to report', () => {
    assert.deepEqual(findPinnedCenterScrolls(''), [])
    assert.deepEqual(findPinnedCenterScrolls(undefined), [])
  })
})

describe('describePinnedCenterScroll', () => {
  test('names the step, the element, the bounds and the cause', () => {
    const [finding] = findPinnedCenterScrolls(fixture('guest-preview-exit-pinned.txt'))
    assert.equal(
      describePinnedCenterScroll(finding),
      'scrollUntilVisible step "Scrolling DOWN until id: guest-preview-exit is visible with speed 40, visibility percentage 100%, timeout 20000 ms, with centering enabled" (id: guest-preview-exit) stayed at Bounds(x=42, y=2096, width=996, height=115) with 100% visibility for 5 tries: centerElement was set on an element pinned to a scroll edge, so it can never be centered and every swipe is wasted; remove centerElement from this step'
    )
  })
})

describe('pinnedCenterScrollCauses', () => {
  /** @type {string | undefined} */
  let debugRoot
  afterEach(() => {
    if (debugRoot) fs.rmSync(debugRoot, { recursive: true, force: true })
    debugRoot = undefined
  })
  const writeLog = (...segments) => {
    debugRoot ??= fs.mkdtempSync(path.join(os.tmpdir(), 'pinned-center-'))
    const file = path.join(debugRoot, ...segments, 'logs', 'maestro.log')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, fixture('guest-preview-exit-pinned.txt'))
    return file
  }
  const [pinned] = findPinnedCenterScrolls(fixture('guest-preview-exit-pinned.txt'))

  test('reads an iOS flow from the -shard-N folder a split run files it under', () => {
    // run-maestro-shards.mjs hands an iOS run two or more simulators and --shard-split, so
    // Maestro 2.8 names every flow folder "<title>-shard-<N>" (TestDebugReporter).
    writeLog('2026-11-17_100000', 'Guest preview journey-shard-2')
    assert.deepEqual(
      pinnedCenterScrollCauses({
        debugRoot,
        flowTitle: 'Guest preview journey',
        startedAtMs: 0,
        finished: true,
      }),
      [describePinnedCenterScroll(pinned)]
    )
  })

  test('reads the Google runner layout, one flattened folder per flow', () => {
    // run-google-native.mjs: --debug-output <maestroDir>/<label> --flatten-debug-output.
    writeLog('google-preview-conversion', 'Google preview conversion')
    assert.equal(
      pinnedCenterScrollCauses({
        debugRoot,
        flowTitle: 'Google preview conversion',
        startedAtMs: 0,
        finished: true,
      }).length,
      1
    )
  })

  test('fails a finished flow whose debug log is missing, by name', () => {
    debugRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pinned-center-'))
    assert.deepEqual(
      pinnedCenterScrollCauses({
        debugRoot,
        flowTitle: 'share-card-export',
        startedAtMs: 0,
        finished: true,
      }),
      [
        `pinned-center check: Maestro finished the flow but left no debug log for "share-card-export" under ${debugRoot}, so its scrollUntilVisible steps went unchecked`,
      ]
    )
  })

  test('adds nothing for a flow Maestro never finished', () => {
    // A killed flow has no report and already failed with the kill as its cause (R28).
    debugRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pinned-center-'))
    assert.deepEqual(
      pinnedCenterScrollCauses({
        debugRoot,
        flowTitle: 'share-card-export',
        startedAtMs: 0,
        finished: false,
      }),
      []
    )
  })

  test("never reads a log an earlier run left as this run's", () => {
    const file = writeLog('2026-11-16_100000', 'Guest preview journey')
    fs.utimesSync(file, 1_000, 1_000)
    assert.deepEqual(
      pinnedCenterScrollCauses({
        debugRoot,
        flowTitle: 'Guest preview journey',
        startedAtMs: 2_000_000,
        finished: true,
      }),
      [
        `pinned-center check: Maestro finished the flow but left no debug log for "Guest preview journey" under ${debugRoot}, so its scrollUntilVisible steps went unchecked`,
      ]
    )
  })
})

describe('google-preview-conversion.yaml centerElement steps', () => {
  test('moved between tries or were accepted on the first try in CI run 44082557117', () => {
    // Android google sign-in lane, flow google-preview-conversion: thermal-cold and
    // rain-high were accepted at once, wind-low moved from y=1843 to y=744 and
    // create-account from y=2190 to y=1574. Runs 44013989992 and 44008122141 agree, so the
    // four steps keep centerElement.
    assert.deepEqual(
      findPinnedCenterScrolls(fixture('google-preview-conversion-centered.txt')),
      []
    )
    const flow = fs.readFileSync(
      path.join(root, 'maestro/google-sign-in/google-preview-conversion.yaml'),
      'utf8'
    )
    assert.equal(flow.match(/centerElement: true/g)?.length, 4)
  })
})

describe('runner wiring', () => {
  // Executing a runner starts a device lane, so the wiring is read from source.
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
  const body = (source, name) => {
    const start = source.indexOf(`const ${name} = `)
    assert.notEqual(start, -1, name)
    return source.slice(start, source.indexOf('\n}\n', start))
  }
  const at = (text, needle) => {
    const index = text.indexOf(needle)
    assert.notEqual(index, -1, needle)
    return index
  }
  const runner = read('scripts/run-maestro.mjs')

  test('the iOS sharded path checks each flow against the suite report, by title', () => {
    const sharded = body(runner, 'runShardedFlows')
    const guarded = sharded.search(
      /failPinnedCenterScrolls\(flowPath, suiteStartedAt, flowFailures, \{\s*suiteReport: report,?\s*\}\)/
    )
    assert.notEqual(guarded, -1)
    assert.ok(at(sharded, 'recordShardedSuiteOutcome(') < guarded)
    const guard = body(runner, 'failPinnedCenterScrolls')
    assert.match(guard, /reportedAs = suiteReport \? flowTitle : undefined/)
    assert.match(
      guard,
      /failFlowWithCause\(flowPath, cause, flowFailures, \{ reportedAs \}\)/
    )
  })

  test('a flow that wrote its report but left no debug log fails', () => {
    const guard = body(runner, 'failPinnedCenterScrolls')
    assert.match(
      guard,
      /finished: suiteReport\s+\? reportedNames\(suiteReport\)\.has\(flowTitle\)\s+: flowReportWritten\(flowPath\)/
    )
  })

  test('the guest conversion verify flow runs the guard on its private debug output', () => {
    const verify = body(runner, 'runGuestVerifyFlow')
    const guard = at(verify, 'pinnedCenterScrollCauses({')
    assert.ok(at(verify, 'await runPrivateMaestro(') < guard)
    assert.ok(
      guard < at(verify, 'fs.rmSync(privateDir, { recursive: true, force: true })')
    )
    assert.match(verify, /debugRoot: privateDir,/)
    assert.match(
      verify,
      /if \(causes\.length > 0\) throw new Error\(causes\.join\('; '\)\)/
    )
  })

  test("the Google native runner adds the guard causes to each flow's problems", () => {
    const google = read('scripts/run-google-native.mjs')
    const runFlow = google.slice(at(google, 'const runFlow = async'))
    const guard = at(runFlow, 'pinnedCenterScrollCauses({')
    assert.ok(at(runFlow, 'const maestro = run(') < guard)
    assert.ok(guard < at(runFlow, 'const result = {'))
    assert.match(runFlow, /debugRoot: maestroDir,/)
    assert.match(runFlow, /finished: maestro\.status === 0,/)
    assert.match(runFlow, /const problems = \[\s*\.\.\.expectation,\s*\.\.\.guardCauses/)
  })
})
