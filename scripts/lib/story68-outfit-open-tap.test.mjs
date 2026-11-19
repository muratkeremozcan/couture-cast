// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
// Learning path Step 58: Production status and nightly health.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-58-production-status-and-nightly-health
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test, { describe } from 'node:test'
import vm from 'node:vm'
import { parse } from 'yaml'
import { CHECKED_FLOWS } from '../ci/maestro-check-flows.mjs'
import {
  CONDITION_CHECK_MS,
  DEFAULT_FLOW_TIMEOUT_MS,
  FLOW_STARTUP_MS,
  FLOW_TIMEOUT_MARGIN,
  OUTFIT_OPEN_FLOWS,
  OUTFIT_OPEN_POSITION_STEPS,
  OUTFIT_OPEN_POSITION_WAITS_MS,
  OUTFIT_OPEN_POSITION_WORST_CASE_MS,
  OUTFIT_OPEN_TAP_ATTEMPTS,
  OUTFIT_OPEN_TAP_ATTEMPT_MS,
  OUTFIT_OPEN_TAP_WORST_CASE_MS,
  OUTFIT_POSITION_ONLY_FLOWS,
  WAIT_FOR_ANIMATION_CAP_MS,
  flowTimeoutMs,
} from './story68-flow-timeouts.mjs'
import {
  MAESTRO_NOT_VISIBLE_SEARCH_MS,
  MaestroModelStepFailed,
  runMaestroModel,
} from './maestro-flow-model.mjs'

// Nightly run 44078916466 shard 2: open-outfit.yaml tapped the opener clear of the chip bar and the
// tab bar, the app traced opener-press-in then opener-touch-cancel 0.2 s later, and the sheet never
// opened. Nightly run 44298434117 shard 4: the same flow passed its last command and was killed at
// the 120 s default, which the positioning subflow alone (102 s declared) could not fit in.
const dir = new URL('../../maestro/story68/', import.meta.url)
const flowCommands = (name) =>
  parse(fs.readFileSync(new URL(name, dir), 'utf8').split(/^---$/m)[1])
const subflow = 'tap-outfit-open.yaml'
const positioning = 'position-outfit-open.yaml'
const opener = 'outfit-share-card-open'
const title = 'share-card-title'
const [retryStep] = flowCommands(subflow)
const [guard, wait] = retryStep.retry.commands
const fileName = (flow) => flow.split('/').pop()

/** Every tapOn of the opener in a command tree. */
function openerTaps(node) {
  if (Array.isArray(node)) return node.flatMap(openerTaps)
  if (node && typeof node === 'object') {
    if (node.tapOn?.id === opener) return [node]
    return Object.values(node).flatMap(openerTaps)
  }
  return []
}

/** Declared worst case of a command list: waits at their limit, every other step one check. */
function declared(node) {
  if (Array.isArray(node))
    return node.reduce(
      (total, step) => {
        const part = declared(step)
        return { waits: total.waits + part.waits, steps: total.steps + part.steps }
      },
      { waits: 0, steps: 0 }
    )
  if (node === 'waitForAnimationToEnd')
    return { waits: WAIT_FOR_ANIMATION_CAP_MS, steps: 0 }
  if (node?.extendedWaitUntil) return { waits: node.extendedWaitUntil.timeout, steps: 0 }
  // A scroll runs to its timeout, then polls once more.
  if (node?.scrollUntilVisible)
    return { waits: node.scrollUntilVisible.timeout, steps: 1 }
  if (node?.repeat) {
    const body = declared(node.repeat.commands)
    return {
      waits: node.repeat.times * body.waits,
      steps: node.repeat.times * body.steps,
    }
  }
  if (node?.runFlow?.commands) {
    const body = declared(node.runFlow.commands)
    // A `when` other than the platform costs one condition check.
    const check = node.runFlow.when && !node.runFlow.when.platform ? 1 : 0
    return { waits: body.waits, steps: body.steps + check }
  }
  return { waits: 0, steps: 1 }
}
const cost = ({ waits, steps }) => waits + steps * CONDITION_CHECK_MS

describe('tap-outfit-open.yaml shape', () => {
  test('tap-outfit-open taps the opener only while the sheet is closed, and waits for its title', () => {
    assert.equal(flowCommands(subflow).length, 1)
    assert.equal(retryStep.retry.maxRetries, 3)
    assert.deepEqual(guard.runFlow.when, {
      visible: { id: opener },
      notVisible: { id: title },
    })
    assert.deepEqual(guard.runFlow.commands, [{ tapOn: { id: opener } }])
    assert.equal(
      openerTaps(flowCommands(subflow)).length,
      1,
      'the only tap is the guarded one'
    )
    assert.deepEqual(wait.extendedWaitUntil.visible, { id: title })
    assert.ok(
      wait.extendedWaitUntil.timeout >= 5000 && wait.extendedWaitUntil.timeout <= 10000
    )
  })
})

describe('behavior under the Maestro model', () => {
  // Behavior of the real tap-outfit-open.yaml under the pinned Maestro's retry, `when`, lookup and
  // tap rules (maestro-flow-model.mjs), against an opener whose presses are scripted: `lands` names
  // the press numbers the app receives (the others are cancelled, as 44078916466 shard 2 traced), and
  // the title draws `titleAfterMs` after the first received press. A device cannot cancel a touch on
  // demand, so these faults run here; the device lanes prove the happy path on real hardware. Each
  // case runs under two timings: a quick device, and a loaded one at the iOS settle cap.
  const TIMINGS = [
    { readMs: 250, settleMs: 400, pressMs: 100 },
    { readMs: 1_500, settleMs: 3_000, pressMs: 500 },
  ]
  function outfitOpener({ lands, titleAfterMs }) {
    const presses = []
    let titleFrom = Infinity
    return {
      presses,
      received: () => presses.filter((press) => press.received).length,
      isVisible: (id, at) =>
        id === opener ? true : id === title ? at >= titleFrom : false,
      press: (id, at) => {
        assert.equal(id, opener)
        const received = lands.includes(presses.length + 1)
        presses.push({ at, received })
        if (received && titleFrom === Infinity) titleFrom = at + titleAfterMs
      },
    }
  }
  const runSubflow = (screen, timing) =>
    runMaestroModel(flowCommands(subflow), screen, timing)
  const readsSpanning = (windowMs, { readMs }) => readMs * Math.ceil(windowMs / readMs)

  /**
   * How long after a received press the next attempt's guard last reads the screen, when the title
   * has not drawn by the end of the wait. Derived here from the pinned rules, independently of the
   * model: the press settles, the wait reads for its whole timeout (the tap was the last interaction,
   * so nothing shrinks it), then the guard's windows have shrunk to zero, so `visible` reads once
   * and `notVisible` runs one nested 500 ms search.
   */
  const guardLastReadAfterPress = (timing) =>
    timing.settleMs +
    readsSpanning(wait.extendedWaitUntil.timeout, timing) +
    timing.readMs +
    readsSpanning(MAESTRO_NOT_VISIBLE_SEARCH_MS, timing)

  test('behavior: a cancelled first press is pressed again, and the second press opens the sheet', () => {
    for (const timing of TIMINGS) {
      const screen = outfitOpener({ lands: [2], titleAfterMs: 300 })
      const elapsed = runSubflow(screen, timing)
      assert.equal(screen.presses.length, 2, JSON.stringify(timing))
      assert.equal(screen.received(), 1)
      assert.ok(elapsed <= OUTFIT_OPEN_TAP_WORST_CASE_MS, `${elapsed}`)
    }
  })

  test('behavior: a title drawn after the wait but by the guard read stops a second press', () => {
    // The first press lands, the wait gives up, and the title draws in time for the next attempt's
    // guard: it reads the opener, finds the title in its nested search, and skips the tap.
    for (const timing of TIMINGS) {
      const titleAfterMs = guardLastReadAfterPress(timing)
      assert.ok(
        titleAfterMs > timing.settleMs + wait.extendedWaitUntil.timeout,
        'the title draws after the wait gave up'
      )
      const screen = outfitOpener({ lands: [1], titleAfterMs })
      runSubflow(screen, timing)
      assert.equal(screen.presses.length, 1, JSON.stringify(timing))
    }
  })

  test('limit: a title drawn after the guard read gets a second press, so the guard is not a no-double-tap proof', () => {
    // One millisecond past the guard's last read, the guard sees no title and presses again. Nothing
    // in the subflow can rule this out for a title that draws arbitrarily late; what a press on an
    // opening sheet does is the device lanes' question.
    for (const timing of TIMINGS) {
      const screen = outfitOpener({
        lands: [1],
        titleAfterMs: guardLastReadAfterPress(timing) + 1,
      })
      runSubflow(screen, timing)
      assert.equal(screen.presses.length, 2, JSON.stringify(timing))
    }
  })

  test('behavior: an opener that never receives a press fails the flow after four presses, inside its budget', () => {
    for (const timing of TIMINGS) {
      const screen = outfitOpener({ lands: [], titleAfterMs: 0 })
      assert.throws(
        () => runSubflow(screen, timing),
        (error) =>
          error instanceof MaestroModelStepFailed &&
          error.message ===
            `extendedWaitUntil ${title}: not visible after ${wait.extendedWaitUntil.timeout} ms` &&
          error.elapsedMs <= OUTFIT_OPEN_TAP_WORST_CASE_MS
      )
      assert.equal(
        screen.presses.length,
        OUTFIT_OPEN_TAP_ATTEMPTS,
        JSON.stringify(timing)
      )
      assert.equal(screen.received(), 0)
    }
  })
})

describe('callers and budgets', () => {
  test('every flow that opens the sheet runs tap-outfit-open once, after positioning, with no bare tap', () => {
    for (const flow of OUTFIT_OPEN_FLOWS) {
      const commands = flowCommands(fileName(flow))
      const calls = commands.filter((step) => step.runFlow === subflow)
      assert.equal(calls.length, 1, `${flow} runs ${subflow} once`)
      assert.equal(openerTaps(commands).length, 0, `${flow}: no bare opener tap`)
      const positioned = commands.findIndex((step) => step.runFlow?.file === positioning)
      assert.ok(
        positioned > -1 && positioned < commands.indexOf(calls[0]),
        `${flow} positions first`
      )
    }
  })

  test('audit: no story68 flow taps the opener outside tap-outfit-open, except the pinned held tap', () => {
    const bare = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.yaml') && name !== subflow)
      .flatMap((name) => openerTaps(flowCommands(name)).map(() => name))
    // rapid-watermark-held.yaml presses the opener where rapid-ready-outfit.yaml left it, its command
    // list pinned by its own tests; release-open-outfit.yaml is the Android Release proof.
    assert.deepEqual(bare.sort(), [
      'rapid-watermark-held.yaml',
      'release-open-outfit.yaml',
    ])
  })

  test('the positioning budget equals what position-outfit-open declares and covers the Android branch', () => {
    const ios = declared(flowCommands(positioning))
    assert.deepEqual(ios, {
      waits: OUTFIT_OPEN_POSITION_WAITS_MS,
      steps: OUTFIT_OPEN_POSITION_STEPS,
    })
    assert.equal(OUTFIT_OPEN_POSITION_WORST_CASE_MS, cost(ios))
    for (const flow of [...OUTFIT_OPEN_FLOWS, ...OUTFIT_POSITION_ONLY_FLOWS]) {
      const android = flowCommands(fileName(flow)).find(
        (step) => step.runFlow?.when?.platform === 'Android'
      )
      assert.ok(android, `${flow} has an Android branch`)
      assert.ok(
        cost(declared(android.runFlow.commands)) <= OUTFIT_OPEN_POSITION_WORST_CASE_MS,
        `${flow}: Android positioning fits`
      )
    }
  })

  test('the process budget covers the default, the positioning and the guarded tap with the margin', () => {
    const attempts = retryStep.retry.maxRetries + 1
    assert.equal(attempts, OUTFIT_OPEN_TAP_ATTEMPTS)
    // Guard (two condition checks), the wait for the title and its poll.
    assert.equal(
      OUTFIT_OPEN_TAP_ATTEMPT_MS,
      2 * CONDITION_CHECK_MS + wait.extendedWaitUntil.timeout + CONDITION_CHECK_MS
    )
    assert.equal(OUTFIT_OPEN_TAP_WORST_CASE_MS, attempts * OUTFIT_OPEN_TAP_ATTEMPT_MS)
    for (const flow of OUTFIT_OPEN_FLOWS)
      assert.equal(
        flowTimeoutMs(flow),
        Math.ceil(
          (DEFAULT_FLOW_TIMEOUT_MS +
            OUTFIT_OPEN_POSITION_WORST_CASE_MS +
            OUTFIT_OPEN_TAP_WORST_CASE_MS) *
            FLOW_TIMEOUT_MARGIN
        ),
        flow
      )
    for (const flow of OUTFIT_POSITION_ONLY_FLOWS)
      assert.equal(
        flowTimeoutMs(flow),
        Math.ceil(
          (DEFAULT_FLOW_TIMEOUT_MS + OUTFIT_OPEN_POSITION_WORST_CASE_MS) *
            FLOW_TIMEOUT_MARGIN
        ),
        flow
      )
  })

  test("each flow's own steps outside the subflows fit the default budget they are added to", () => {
    for (const flow of [...OUTFIT_OPEN_FLOWS, ...OUTFIT_POSITION_ONLY_FLOWS]) {
      const own = flowCommands(fileName(flow)).filter(
        (step) => !step.runFlow?.when?.platform && step.runFlow !== subflow
      )
      const total = FLOW_STARTUP_MS + cost(declared(own))
      assert.ok(total <= DEFAULT_FLOW_TIMEOUT_MS, `${flow}: ${total}`)
    }
  })

  test('tap-outfit-open and its callers are syntax-checked by the pinned Maestro on the iOS build job', () => {
    for (const flow of [`maestro/story68/${subflow}`, ...OUTFIT_OPEN_FLOWS])
      assert.ok(CHECKED_FLOWS.includes(flow), flow)
  })
})

describe('evidence', () => {
  test('a passing iOS flow hands its progressive Maestro log to the timing receipt, which counts opener presses', () => {
    // Runs the runner's real maestro() to a passing exit with every device seam stubbed, and reads
    // what it gives recordIosCommandTimings.
    const source = fs.readFileSync(
      new URL('../run-story68-native.mjs', import.meta.url),
      'utf8'
    )
    const start = source.indexOf('function maestro(')
    const end = source.indexOf('\nasync function signin(', start)
    const progressLog = 'Tap on id: outfit-share-card-open RUNNING (stub log)'
    const timings = []
    const files = new Map([['/owned/runtime/maestro-ios-1/maestro.log', progressLog]])
    const context = {
      platform: 'ios',
      path,
      directory: '/owned/runtime',
      root: '/owned/repo',
      device: 'owned-device',
      maestroBinary: 'maestro',
      Date: { now: () => 1 },
      requireDevice: () => undefined,
      logSize: () => 0,
      scheduleIosInFlowSample: () => false,
      withNativeTransport: (work) => work(),
      reverse: () => undefined,
      spawnIosFlow: () => ({ status: 0, stdout: '', stderr: '' }),
      iosDriverGlobalArgs: () => [],
      iosDriverTestArgs: () => [],
      DRIVER_HOST_PORT_ARG: '--driver-host-port',
      MAESTRO_ANDROID_DRIVER_PORT: 17001,
      process: { env: {} },
      localeEnv: () => ({ MAESTRO_BACK: 'Back' }),
      nativeFlowTimeoutMs: () => 120_000,
      fs: {
        mkdirSync: () => undefined,
        existsSync: (file) => files.has(file),
        readFileSync: (file) => files.get(file),
        writeFileSync: () => undefined,
        rmSync: () => undefined,
      },
      recordIosFlowTiming: () => undefined,
      shouldRetryIosSnapshot: () => false,
      recordIosDriverFlow: () => null,
      recordIosCommandTimings: (options) => timings.push(options),
      recordIosStackPop: () => undefined,
    }
    vm.runInNewContext(
      `(${source.slice(start, end)})("maestro/story68/open-outfit.yaml")`,
      context
    )
    assert.equal(timings.length, 1)
    assert.equal(timings[0].progressLog, progressLog)
    assert.equal(timings[0].flow, 'maestro/story68/open-outfit.yaml')
  })
})
