// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'
import { CHECKED_FLOWS } from '../ci/maestro-check-flows.mjs'
import {
  CONDITION_CHECK_MS,
  DEFAULT_FLOW_TIMEOUT_MS,
  FLOW_STARTUP_MS,
  FLOW_TIMEOUT_MARGIN,
  SAVE_TAP_ATTEMPTS,
  SAVE_TAP_ATTEMPT_MS,
  SAVE_TAP_FLOWS,
  SAVE_TAP_WORST_CASE_MS,
  flowTimeoutMs,
} from './story68-flow-timeouts.mjs'

const dir = new URL('../../maestro/story68/', import.meta.url)
const flowCommands = (name) =>
  parse(fs.readFileSync(new URL(name, dir), 'utf8').split(/^---$/m)[1])
const subflow = 'tap-save.yaml'
const save = 'share-card-save'
const [retryStep] = flowCommands(subflow)
const [guard, wait] = retryStep.retry.commands

/** Every tapOn of Save in a command tree. */
function saveTaps(node) {
  if (Array.isArray(node)) return node.flatMap(saveTaps)
  if (node && typeof node === 'object') {
    if (node.tapOn?.id === save) return [node]
    return Object.values(node).flatMap(saveTaps)
  }
  return []
}

test('tap-save taps Save only while it reads enabled and its effect is not on screen, and waits for the effect', () => {
  assert.equal(flowCommands(subflow).length, 1)
  assert.ok(retryStep.retry.maxRetries >= 2 && retryStep.retry.maxRetries <= 4)
  assert.deepEqual(guard.runFlow.when, {
    visible: { id: save, enabled: true },
    notVisible: '${MAESTRO_SAVE_EFFECT}',
  })
  assert.equal(saveTaps(guard.runFlow.commands).length, 1)
  assert.equal(
    saveTaps(flowCommands(subflow)).length,
    1,
    'the only tap is the guarded one'
  )
  assert.deepEqual(wait.extendedWaitUntil.visible, '${MAESTRO_SAVE_EFFECT}')
  assert.ok(
    wait.extendedWaitUntil.timeout >= 5000 && wait.extendedWaitUntil.timeout <= 10000
  )
})

test('every flow that taps Save once runs tap-save with an effect and no bare first tap', () => {
  for (const flow of SAVE_TAP_FLOWS) {
    const name = flow.split('/').pop()
    const commands = flowCommands(name)
    const call = commands.find((step) => step.runFlow?.file === subflow)
    assert.ok(call, `${name} runs ${subflow}`)
    assert.match(
      call.runFlow.env.MAESTRO_SAVE_EFFECT,
      /MAESTRO_(SAVING|SAVED|PERMANENT)|Don/
    )
    // The call is the first command: nothing taps Save before it.
    assert.equal(commands[0], call, `${name}: tap-save comes first`)
  }
})

test('audit: no story68 flow taps Save outside tap-save, except the second tap of pending.yaml', () => {
  const bare = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.yaml') && name !== subflow)
    .flatMap((name) => saveTaps(flowCommands(name)).map(() => name))
  // pending.yaml presses Save again on purpose while the first save is running.
  assert.deepEqual(bare, ['pending.yaml'])
})

test('the process budget covers the guarded tap on top of the default flow budget', () => {
  const attempts = retryStep.retry.maxRetries + 1
  assert.ok(attempts <= SAVE_TAP_ATTEMPTS)
  // Guard (two condition checks), the wait for the effect and its poll.
  const attempt =
    2 * CONDITION_CHECK_MS + wait.extendedWaitUntil.timeout + CONDITION_CHECK_MS
  assert.ok(attempt <= SAVE_TAP_ATTEMPT_MS)
  assert.equal(SAVE_TAP_WORST_CASE_MS, SAVE_TAP_ATTEMPTS * SAVE_TAP_ATTEMPT_MS)
  for (const flow of SAVE_TAP_FLOWS)
    assert.ok(
      flowTimeoutMs(flow) >=
        (DEFAULT_FLOW_TIMEOUT_MS + attempts * attempt) * FLOW_TIMEOUT_MARGIN,
      flow
    )
})

test("each flow's own declared waits fit the default budget that the subflow budget is added to", () => {
  const cost = (node) => {
    if (Array.isArray(node)) return node.reduce((sum, step) => sum + cost(step), 0)
    if (node && typeof node === 'object') {
      if (node.extendedWaitUntil) return node.extendedWaitUntil.timeout
      if (node.runFlow?.file) return 0
      if (node.runFlow) return CONDITION_CHECK_MS + cost(node.runFlow.commands)
      return CONDITION_CHECK_MS
    }
    return 0
  }
  for (const flow of SAVE_TAP_FLOWS) {
    const own = FLOW_STARTUP_MS + cost(flowCommands(flow.split('/').pop()))
    assert.ok(own <= DEFAULT_FLOW_TIMEOUT_MS, `${flow}: ${own}`)
  }
})

test('tap-save and its callers are syntax-checked by the pinned Maestro on the iOS build job', () => {
  for (const flow of [`maestro/story68/${subflow}`, ...SAVE_TAP_FLOWS])
    assert.ok(CHECKED_FLOWS.includes(flow), flow)
})
