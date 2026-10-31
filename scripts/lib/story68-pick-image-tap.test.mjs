// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'
import { CHECKED_FLOWS } from '../ci/maestro-check-flows.mjs'
import {
  CONDITION_CHECK_MS,
  FLOW_STARTUP_MS,
  FLOW_TIMEOUT_MARGIN,
  PICK_IMAGE_FLOW,
  PICK_IMAGE_GUARDED_STEPS,
  PICK_IMAGE_OTHER_STEPS_MS,
  PICK_IMAGE_TAP_ATTEMPTS,
  PICK_IMAGE_TAP_ATTEMPT_MS,
  PICK_IMAGE_TAP_WORST_CASE_MS,
  flowTimeoutMs,
} from './story68-flow-timeouts.mjs'

const commands = parse(
  fs
    .readFileSync(new URL(`../../${PICK_IMAGE_FLOW}`, import.meta.url), 'utf8')
    .split(/^---$/m)[1]
)
const opener = 'community-pick-image-button'
const retryStep = commands.find((step) => step.retry)
const [guard, wait] = retryStep.retry.commands

/** Every tapOn of the opener in a command tree. */
function openerTaps(node) {
  if (Array.isArray(node)) return node.flatMap(openerTaps)
  if (node && typeof node === 'object') {
    if (node.tapOn?.id === opener) return [node]
    return Object.values(node).flatMap(openerTaps)
  }
  return []
}

test('the picker opener is tapped only while it reads enabled and the picker is not up, after the sheet is pulled to its top, and the tap waits for Cancel', () => {
  assert.equal(commands.filter((step) => step.retry).length, 1)
  assert.ok(retryStep.retry.maxRetries >= 2 && retryStep.retry.maxRetries <= 4)
  assert.deepEqual(guard.runFlow.when, {
    visible: { id: opener, enabled: true },
    notVisible: 'Cancel',
  })
  assert.equal(openerTaps(guard.runFlow.commands).length, 1)
  assert.equal(openerTaps(commands).length, 1, 'the only tap is the guarded one')
  // The tap is the last guarded command, right after the scroll has settled, and every
  // command before that wait is a swipe that drags the sheet's content down to its top.
  const steps = guard.runFlow.commands
  assert.equal(steps.at(-1).tapOn.id, opener)
  assert.equal(steps.at(-2), 'waitForAnimationToEnd')
  const swipes = steps.slice(0, -2)
  assert.ok(swipes.length >= 2)
  for (const step of swipes) {
    const y = (point) => Number.parseFloat(point.split(',')[1])
    assert.ok(step.swipe, 'only swipes precede the settle wait')
    assert.ok(y(step.swipe.end) > y(step.swipe.start), 'a swipe drags the content down')
  }
  assert.equal(steps.length, PICK_IMAGE_GUARDED_STEPS)
  assert.equal(wait.extendedWaitUntil.visible, 'Cancel')
  assert.ok(
    wait.extendedWaitUntil.timeout >= 5000 && wait.extendedWaitUntil.timeout <= 10000
  )
})

test('the process budget covers the guarded tap and every other step', () => {
  const attempts = retryStep.retry.maxRetries + 1
  assert.ok(attempts <= PICK_IMAGE_TAP_ATTEMPTS)
  // Guard (two condition checks), each guarded command, the wait for Cancel and its poll.
  const attempt =
    (2 + guard.runFlow.commands.length + 1) * CONDITION_CHECK_MS +
    wait.extendedWaitUntil.timeout
  assert.ok(attempt <= PICK_IMAGE_TAP_ATTEMPT_MS)
  assert.equal(
    PICK_IMAGE_TAP_WORST_CASE_MS,
    PICK_IMAGE_TAP_ATTEMPTS * PICK_IMAGE_TAP_ATTEMPT_MS
  )
  // Every other command costs one condition check plus its declared wait.
  const cost = (node) => {
    if (Array.isArray(node)) return node.reduce((sum, step) => sum + cost(step), 0)
    if (node && typeof node === 'object') {
      if (node.retry) return 0
      if (node.extendedWaitUntil) return node.extendedWaitUntil.timeout
      if (node.runFlow) return CONDITION_CHECK_MS + cost(node.runFlow.commands)
      return CONDITION_CHECK_MS
    }
    return 0
  }
  const others = cost(commands)
  assert.ok(others <= PICK_IMAGE_OTHER_STEPS_MS, `other steps: ${others}`)
  assert.ok(
    flowTimeoutMs(PICK_IMAGE_FLOW) >=
      (FLOW_STARTUP_MS + others + attempts * attempt) * FLOW_TIMEOUT_MARGIN
  )
})

test('the flow is syntax-checked by the pinned Maestro on the iOS build job', () => {
  assert.ok(CHECKED_FLOWS.includes(PICK_IMAGE_FLOW))
})
