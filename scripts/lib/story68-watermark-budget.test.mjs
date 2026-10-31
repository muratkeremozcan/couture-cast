// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'
import {
  CONDITION_CHECK_MS,
  DEFAULT_FLOW_TIMEOUT_MS,
  FLOW_STARTUP_MS,
  FLOW_TIMEOUT_MARGIN,
  RELEASE_WATERMARK_OFF_WORST_CASE_MS,
  WATERMARK_ATTEMPT_MS,
  WATERMARK_TAP_ATTEMPTS,
  WATERMARK_WORST_CASE_MS,
  flowTimeoutMs,
} from './story68-flow-timeouts.mjs'

const dir = 'maestro/story68/'
const commandsOf = (name) =>
  parse(
    fs
      .readFileSync(new URL(`../../${dir}${name}`, import.meta.url), 'utf8')
      .split(/^---$/m)[1]
  )

/** One retry attempt: the guard's condition check, then the wait for the switch and its poll. */
function attemptMs(retry) {
  const [guard, wait] = retry.commands
  assert.ok(guard.runFlow?.when, 'the tap sits behind a guard')
  return CONDITION_CHECK_MS + wait.extendedWaitUntil.timeout + CONDITION_CHECK_MS
}

/** The worst case the flow declares: every retry attempt times out, every wait runs its full length. */
function declaredWorstCase(commands) {
  return commands.reduce((total, step) => {
    if (step.retry) return total + (step.retry.maxRetries + 1) * attemptMs(step.retry)
    if (step.extendedWaitUntil) return total + step.extendedWaitUntil.timeout
    if (step.assertVisible || step.assertNotVisible) return total + CONDITION_CHECK_MS
    throw new Error(`unbudgeted step ${Object.keys(step)[0]}`)
  }, FLOW_STARTUP_MS)
}

test('every guarded tap attempt fits the shared attempt budget', () => {
  for (const name of ['watermark.yaml', 'release-watermark-off.yaml'])
    for (const step of commandsOf(name).filter((command) => command.retry)) {
      assert.ok(step.retry.maxRetries + 1 <= WATERMARK_TAP_ATTEMPTS, name)
      assert.ok(attemptMs(step.retry) <= WATERMARK_ATTEMPT_MS, name)
    }
})

test('watermark.yaml budget equals the worst case the flow declares and is above the default', () => {
  const declared = declaredWorstCase(commandsOf('watermark.yaml'))
  assert.equal(WATERMARK_WORST_CASE_MS, declared)
  assert.ok(declared > DEFAULT_FLOW_TIMEOUT_MS)
  assert.ok(flowTimeoutMs(`${dir}watermark.yaml`) >= declared * FLOW_TIMEOUT_MARGIN)
})

test('release-watermark-off.yaml budget equals the worst case the flow declares and is above the default', () => {
  const declared = declaredWorstCase(commandsOf('release-watermark-off.yaml'))
  assert.equal(RELEASE_WATERMARK_OFF_WORST_CASE_MS, declared)
  assert.ok(declared > DEFAULT_FLOW_TIMEOUT_MS)
  assert.ok(
    flowTimeoutMs(`${dir}release-watermark-off.yaml`) >= declared * FLOW_TIMEOUT_MARGIN
  )
})
