// Learning path Step 58: Production status and nightly health.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-58-production-status-and-nightly-health
//
// These pin the model's implemented subset of the pinned Maestro 2.8.0 rules against the model's
// own virtual clock. They prove the model applies the rules its header cites (taken from Maestro
// commit b63727604c3f28fd97504d4f2d04371bad63e509); they cannot prove a real Maestro run times
// out where the model does.
import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { MAESTRO_PINNED_VERSION } from '../maestro-version.mjs'
import {
  MAESTRO_LOOKUP_MS,
  MAESTRO_MODEL_VERSION,
  MAESTRO_NOT_VISIBLE_SEARCH_MS,
  MAESTRO_OPTIONAL_LOOKUP_MS,
  MaestroModelStepFailed,
  runMaestroModel,
} from './maestro-flow-model.mjs'

const timing = { readMs: 100, settleMs: 300, pressMs: 50 }

/** A screen whose elements show from a fixed time, recording every press. */
function screen(shownFrom = {}) {
  const presses = []
  return {
    presses,
    isVisible: (id, at) => at >= (shownFrom[id] ?? Infinity),
    press: (id, at) => presses.push({ id, at }),
  }
}
const failing = { extendedWaitUntil: { visible: { id: 'never' }, timeout: 2_000 } }

describe('runMaestroModel', () => {
  describe('pinned release and constants', () => {
    test('model: its rules were read from the Maestro release the repository pins', () => {
      // A bump of MAESTRO_PINNED_VERSION fails here until the rules above are read again from the new
      // release and MAESTRO_MODEL_VERSION moves with them.
      assert.equal(MAESTRO_MODEL_VERSION, MAESTRO_PINNED_VERSION)
    })
    test('model: the pinned constants are the 17 s lookup, the 7 s optional lookup and the 500 ms notVisible search', () => {
      assert.deepEqual(
        [MAESTRO_LOOKUP_MS, MAESTRO_OPTIONAL_LOOKUP_MS, MAESTRO_NOT_VISIBLE_SEARCH_MS],
        [17_000, 7_000, 500]
      )
    })
  })
  describe('retry', () => {
    test('model: a retry block runs maxRetries + 1 times, restarting at its first command', () => {
      const s = screen({ button: 0 })
      assert.throws(
        () =>
          runMaestroModel(
            [
              {
                retry: {
                  maxRetries: 2,
                  commands: [{ tapOn: { id: 'button' } }, failing],
                },
              },
            ],
            s,
            timing
          ),
        (error) => error instanceof MaestroModelStepFailed && /never/.test(error.message)
      )
      assert.equal(s.presses.length, 3)
    })
    test('model: maxRetries reads as an integer (a non-integer reads as 1), caps at 3, and a negative runs nothing', () => {
      for (const [maxRetries, presses] of [
        [undefined, 2],
        [0, 1],
        [3, 4],
        [5, 4],
        ['2', 3],
        ['two', 2],
      ]) {
        const s = screen({ button: 0 })
        const retry = { commands: [{ tapOn: { id: 'button' } }, failing] }
        if (maxRetries !== undefined) retry.maxRetries = maxRetries
        assert.throws(
          () => runMaestroModel([{ retry }], s, timing),
          MaestroModelStepFailed
        )
        assert.equal(s.presses.length, presses, `maxRetries ${maxRetries}`)
      }
      const s = screen({ button: 0 })
      runMaestroModel(
        [{ retry: { maxRetries: -1, commands: [{ tapOn: { id: 'button' } }, failing] } }],
        s,
        timing
      )
      assert.equal(s.presses.length, 0)
    })
  })
  describe('tapOn', () => {
    test('model: a tap reads once, settles, presses once and settles again', () => {
      const s = screen({ button: 0 })
      const elapsed = runMaestroModel([{ tapOn: { id: 'button' } }], s, timing)
      const pressedAt = timing.readMs + timing.settleMs + timing.pressMs
      assert.deepEqual(s.presses, [{ id: 'button', at: pressedAt }])
      assert.equal(elapsed, pressedAt + timing.settleMs)
    })
    test('model: tapOn looks up for 17 s, 7 s when optional, and optional turns only that failure into a pass', () => {
      assert.throws(
        () => runMaestroModel([{ tapOn: { id: 'missing' } }], screen(), timing),
        (error) =>
          error instanceof MaestroModelStepFailed &&
          error.message === 'tapOn missing: not visible' &&
          // The 17 s of reads, then the ElementNotFound read.
          error.elapsedMs === MAESTRO_LOOKUP_MS + timing.readMs
      )
      const s = screen({ next: 0 })
      const elapsed = runMaestroModel(
        [{ tapOn: { id: 'missing', optional: true } }, { tapOn: { id: 'next' } }],
        s,
        timing
      )
      assert.deepEqual(
        s.presses.map(({ id }) => id),
        ['next']
      )
      // The optional lookup gave up at 7 s and read once more for ElementNotFound; the later tap's
      // window shrank by that time and still read.
      assert.equal(
        s.presses[0].at,
        MAESTRO_OPTIONAL_LOOKUP_MS + 2 * timing.readMs + timing.settleMs + timing.pressMs
      )
      assert.equal(elapsed, s.presses[0].at + timing.settleMs)
    })
  })
  describe('lookup windows', () => {
    test('model: a window shrinks by the time since the last tap, and a zero window still reads once', () => {
      // After the tap, an optional 2 s wait that misses (2 s of reads, then its ElementNotFound and
      // AssertionFailure reads) leaves a second 2 s wait no time: it reads exactly once.
      const tapped = timing.readMs + 2 * timing.settleMs + timing.pressMs
      const missed = 2_000 + 2 * timing.readMs
      const commands = [
        { tapOn: { id: 'button' } },
        { extendedWaitUntil: { visible: { id: 'gap' }, timeout: 2_000, optional: true } },
        { extendedWaitUntil: { visible: { id: 'late' }, timeout: 2_000 } },
      ]
      // The one read lands at tapped + the missed wait + one read: shown by then, the wait passes.
      const passes = screen({ button: 0, late: tapped + missed + timing.readMs })
      assert.equal(
        runMaestroModel(commands, passes, timing),
        tapped + missed + timing.readMs
      )
      // Shown one millisecond later, the single read misses it and the wait fails after its two
      // report reads.
      const misses = screen({ button: 0, late: tapped + missed + timing.readMs + 1 })
      assert.throws(
        () => runMaestroModel(commands, misses, timing),
        (error) =>
          error instanceof MaestroModelStepFailed &&
          error.elapsedMs === tapped + missed + 3 * timing.readMs
      )
    })
  })
  describe('when', () => {
    test('model: when-notVisible runs nested 500 ms lookups and passes only on one that misses the element', () => {
      const guarded = [
        {
          runFlow: {
            when: { visible: { id: 'button' }, notVisible: { id: 'sheet' } },
            commands: [{ tapOn: { id: 'button' } }],
          },
        },
      ]
      // Sheet absent: one visible read, one nested search of 500 ms of reads and its ElementNotFound
      // read, then the tap.
      const absent = screen({ button: 0 })
      runMaestroModel(guarded, absent, timing)
      const searched = timing.readMs + MAESTRO_NOT_VISIBLE_SEARCH_MS + timing.readMs
      assert.deepEqual(absent.presses, [
        { id: 'button', at: searched + timing.readMs + timing.settleMs + timing.pressMs },
      ])
      // Sheet shown throughout: nested searches find it until the 7 s window (less the visible read)
      // is spent, and nothing is pressed.
      const shown = screen({ button: 0, sheet: 0 })
      const elapsed = runMaestroModel(guarded, shown, timing)
      assert.equal(shown.presses.length, 0)
      assert.equal(elapsed, MAESTRO_OPTIONAL_LOOKUP_MS)
      // No button within 7 s: the condition fails, after its ElementNotFound read, before notVisible
      // is read.
      const none = screen({})
      assert.equal(
        runMaestroModel(guarded, none, timing),
        MAESTRO_OPTIONAL_LOOKUP_MS + timing.readMs
      )
      assert.equal(none.presses.length, 0)
    })
  })
  describe('unsupported input', () => {
    test('model: an unknown command, key, selector or condition throws instead of being skipped', () => {
      for (const commands of [
        [{ scrollUntilVisible: { element: { id: 'a' } } }],
        [{ tapOn: { id: 'a', index: 2 } }],
        [{ tapOn: { text: 'Open' } }],
        [{ runFlow: { when: { platform: 'iOS' }, commands: [] } }],
        [{ runFlow: { file: 'other.yaml' } }],
        [{ extendedWaitUntil: { notVisible: { id: 'a' }, timeout: 1_000 } }],
        [{ tapOn: { id: 'a' }, assertVisible: { id: 'a' } }],
        ['waitForAnimationToEnd'],
      ])
        assert.throws(
          () => runMaestroModel(commands, screen({ a: 0 }), timing),
          /maestro_model_unsupported/,
          JSON.stringify(commands)
        )
      assert.throws(
        () =>
          runMaestroModel(
            [{ extendedWaitUntil: { visible: { id: 'a' } } }],
            screen({ a: 0 }),
            timing
          ),
        /maestro_model_extended_wait_timeout/
      )
      assert.throws(
        () => runMaestroModel([], screen(), { ...timing, readMs: 0 }),
        /maestro_model_read_ms/
      )
    })
  })
})
