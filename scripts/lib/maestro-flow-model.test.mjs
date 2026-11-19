// Learning path Step 58: Production status and nightly health.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-58-production-status-and-nightly-health
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MODEL_READ_MS,
  MODEL_TAP_MS,
  MaestroModelStepFailed,
  runMaestroModel,
} from './maestro-flow-model.mjs'

const lookupMs = 3 * MODEL_READ_MS

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

test('a retry block runs maxRetries + 1 times, restarting at its first command', () => {
  const s = screen({ button: 0 })
  assert.throws(
    () =>
      runMaestroModel(
        [{ retry: { maxRetries: 2, commands: [{ tapOn: { id: 'button' } }, failing] } }],
        s,
        { lookupMs }
      ),
    (error) => error instanceof MaestroModelStepFailed && /never/.test(error.message)
  )
  assert.equal(s.presses.length, 3)
})

test('retry defaults to one retry and caps maxRetries at 3, as the pinned Maestro does', () => {
  for (const [maxRetries, presses] of [
    [undefined, 2],
    [0, 1],
    [3, 4],
    [5, 4],
    ['2', 3],
  ]) {
    const s = screen({ button: 0 })
    const retry = { commands: [{ tapOn: { id: 'button' } }, failing] }
    if (maxRetries !== undefined) retry.maxRetries = maxRetries
    assert.throws(
      () => runMaestroModel([{ retry }], s, { lookupMs }),
      MaestroModelStepFailed
    )
    assert.equal(s.presses.length, presses, `maxRetries ${maxRetries}`)
  }
})

test('a retry block that passes on a later attempt passes the flow', () => {
  const s = screen({ button: 0, done: 5_000 })
  const elapsed = runMaestroModel(
    [
      {
        retry: {
          maxRetries: 3,
          commands: [
            { tapOn: { id: 'button' } },
            { extendedWaitUntil: { visible: { id: 'done' }, timeout: 2_000 } },
          ],
        },
      },
    ],
    s,
    { lookupMs }
  )
  assert.equal(s.presses.length, 2)
  assert.ok(elapsed >= 5_000)
})

test('when: notVisible passes at once for an absent element and fails after the window for a shown one', () => {
  const run = (shownFrom) => {
    const s = screen(shownFrom)
    const elapsed = runMaestroModel(
      [
        {
          runFlow: {
            when: { visible: { id: 'button' }, notVisible: { id: 'sheet' } },
            commands: [{ tapOn: { id: 'button' } }],
          },
        },
      ],
      s,
      { lookupMs }
    )
    return { presses: s.presses.length, elapsed }
  }
  // Two reads (button shown, sheet absent), then the tap's lookup read and the press.
  assert.deepEqual(run({ button: 0 }), {
    presses: 1,
    elapsed: 3 * MODEL_READ_MS + MODEL_TAP_MS,
  })
  // The sheet stays shown: notVisible reads for its whole window, and nothing is pressed.
  assert.deepEqual(run({ button: 0, sheet: 0 }), {
    presses: 0,
    elapsed: MODEL_READ_MS + lookupMs,
  })
  // No button within the window: the condition fails before notVisible is read.
  assert.deepEqual(run({}), { presses: 0, elapsed: lookupMs })
})

test('tapOn fails when its element never shows; optional turns only that failure into a pass', () => {
  assert.throws(
    () => runMaestroModel([{ tapOn: { id: 'missing' } }], screen(), { lookupMs }),
    (error) =>
      error instanceof MaestroModelStepFailed &&
      error.message === 'tapOn missing: not visible' &&
      error.elapsedMs === lookupMs
  )
  const s = screen({ next: 0 })
  runMaestroModel(
    [{ tapOn: { id: 'missing', optional: true } }, { tapOn: { id: 'next' } }],
    s,
    { lookupMs }
  )
  assert.deepEqual(
    s.presses.map(({ id }) => id),
    ['next']
  )
})

test('an unknown command, key, selector or condition throws instead of being skipped', () => {
  for (const commands of [
    [{ scrollUntilVisible: { element: { id: 'a' } } }],
    [{ tapOn: { id: 'a', index: 2 } }],
    [{ tapOn: { text: 'Open' } }],
    [{ runFlow: { when: { platform: 'iOS' }, commands: [] } }],
    [{ runFlow: { file: 'other.yaml' } }],
    [{ extendedWaitUntil: { notVisible: { id: 'a' }, timeout: 1_000 } }],
    [{ extendedWaitUntil: { visible: { id: 'a' } } }],
    [{ retry: { maxRetries: -1, commands: [] } }],
    [{ tapOn: { id: 'a' }, assertVisible: { id: 'a' } }],
    ['waitForAnimationToEnd'],
  ])
    assert.throws(
      () => runMaestroModel(commands, screen({ a: 0 }), { lookupMs }),
      /maestro_model_unsupported/,
      JSON.stringify(commands)
    )
})
