// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Story 6.5 sign-in, step 1 (maestro/story65/signin-request.yaml). Nightly iOS run 44532964440
// shard 3 tapped Send and waited 20 s for "code sent" while the owned Auth proxy saw no code
// request at all (`authOtp: []`) and the code field never rendered. The flow could not say
// whether the address missed the field (it was picked by label index 1, the hazard
// signin-verify.yaml already left on iOS) or the Send tap was lost (tap-save.yaml's finding).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'
import { CHECKED_FLOWS } from '../ci/maestro-check-flows.mjs'
// A namespace import, so a missing budget reads as a failed assertion, not a load error.
import * as timeouts from './story68-flow-timeouts.mjs'

const FLOW = 'maestro/story65/signin-request.yaml'
const source = fs.readFileSync(new URL(`../../${FLOW}`, import.meta.url), 'utf8')
const commands = parse(source.split(/^---$/m)[1])
const app = fs.readFileSync(
  new URL('../../apps/mobile/app/signin.tsx', import.meta.url),
  'utf8'
)
const EMAIL_ID = 'signin-email-input'
const SUBMIT_ID = 'signin-submit'
const STATUS = { id: 'signin-status', text: '.+' }

const platformBranch = (platform) =>
  commands.find((step) => step.runFlow?.when?.platform === platform)?.runFlow.commands ??
  []
const indexOf = (predicate) => commands.findIndex(predicate)
const isSendTap = (node) =>
  node?.tapOn !== undefined &&
  (node.tapOn === '${MAESTRO_SEND}' ||
    node.tapOn?.text === '${MAESTRO_SEND}' ||
    node.tapOn?.id === SUBMIT_ID)
/** Every Send tap in a command tree. */
function sendTaps(node) {
  if (Array.isArray(node)) return node.flatMap(sendTaps)
  if (node && typeof node === 'object')
    return isSendTap(node) ? [node] : Object.values(node).flatMap(sendTaps)
  return []
}
const gateIndex = indexOf(
  (step) => step.extendedWaitUntil?.visible === '${MAESTRO_EMAIL}'
)
const retryIndex = indexOf((step) => sendTaps(step.retry ?? null).length > 0)

test('iOS taps the email field by its testID; Android keeps the label match', () => {
  assert.deepEqual(platformBranch('iOS'), [{ tapOn: { id: EMAIL_ID } }])
  assert.deepEqual(platformBranch('Android'), [
    { tapOn: { text: '${MAESTRO_EMAIL_LABEL}', index: 1 } },
  ])
  // No unconditional label-index tap is left for iOS to take.
  assert.equal(
    indexOf((step) => step.tapOn?.text === '${MAESTRO_EMAIL_LABEL}'),
    -1
  )
  // Both branches tap the field before anything is typed.
  const typed = indexOf((step) => step?.inputText !== undefined)
  for (const platform of ['iOS', 'Android'])
    assert.ok(typed > indexOf((step) => step.runFlow?.when?.platform === platform))
})

test('the whole address must be in the field before Send is pressed', () => {
  const typed = indexOf((step) => step.inputText === '${MAESTRO_EMAIL}')
  assert.ok(typed >= 0, 'the flow types the address')
  assert.ok(gateIndex > typed, 'the address gate follows the typing')
  const gate = commands[gateIndex].extendedWaitUntil
  assert.ok(gate.timeout >= 5000 && gate.timeout <= 15000)
  assert.match(gate.label ?? '', /address/i)
  assert.ok(retryIndex > gateIndex, 'Send is pressed after the gate')
  assert.equal(
    sendTaps(commands.slice(0, gateIndex)).length,
    0,
    'no Send tap before the gate'
  )
})

test('Send is tapped only while it reads enabled and no status shows, then waits for a status', () => {
  assert.ok(retryIndex >= 0, 'the Send tap sits in a retry')
  const { retry } = commands[retryIndex]
  assert.ok(retry.maxRetries >= 2 && retry.maxRetries <= 4)
  const [guard, wait] = retry.commands
  assert.deepEqual(guard.runFlow.when, {
    visible: { id: SUBMIT_ID, enabled: true },
    notVisible: STATUS,
  })
  assert.deepEqual(guard.runFlow.commands, [{ tapOn: { id: SUBMIT_ID } }])
  assert.equal(sendTaps(commands).length, 1, 'the only Send tap is the guarded one')
  assert.deepEqual(wait.extendedWaitUntil.visible, STATUS)
  assert.ok(
    wait.extendedWaitUntil.timeout >= 5000 && wait.extendedWaitUntil.timeout <= 10000
  )
  // A failure message is a status too, so it is never pressed through: the outcome is asserted.
  assert.deepEqual(commands.at(-1), { assertVisible: '${MAESTRO_CODE_SENT}' })
  assert.equal(retryIndex, commands.length - 2)
})

test('the process budget covers the guarded Send on top of the default flow budget', () => {
  const { retry } = commands[retryIndex] ?? { retry: { maxRetries: 0, commands: [] } }
  const attempts = retry.maxRetries + 1
  const wait = retry.commands[1]?.extendedWaitUntil?.timeout ?? 0
  // Guard (two condition checks), the wait for a status and its poll.
  const attempt = 2 * timeouts.CONDITION_CHECK_MS + wait + timeouts.CONDITION_CHECK_MS
  assert.ok(attempts <= timeouts.SEND_CODE_TAP_ATTEMPTS)
  assert.ok(attempt <= timeouts.SEND_CODE_TAP_ATTEMPT_MS)
  assert.equal(
    timeouts.SEND_CODE_TAP_WORST_CASE_MS,
    timeouts.SEND_CODE_TAP_ATTEMPTS * timeouts.SEND_CODE_TAP_ATTEMPT_MS
  )
  assert.ok(
    timeouts.flowTimeoutMs(FLOW) >=
      (timeouts.DEFAULT_FLOW_TIMEOUT_MS + timeouts.SEND_CODE_TAP_WORST_CASE_MS) *
        timeouts.FLOW_TIMEOUT_MARGIN
  )
})

test("the flow's own declared waits fit the default budget the guarded Send is added to", () => {
  const cost = (node) => {
    if (Array.isArray(node)) return node.reduce((sum, step) => sum + cost(step), 0)
    if (node && typeof node === 'object') {
      if (node.retry) return 0
      if (node.extendedWaitUntil) return node.extendedWaitUntil.timeout
      if (node.runFlow?.commands)
        return timeouts.CONDITION_CHECK_MS + cost(node.runFlow.commands)
      return timeouts.CONDITION_CHECK_MS
    }
    return 0
  }
  const own = timeouts.FLOW_STARTUP_MS + cost(commands)
  assert.ok(own <= timeouts.DEFAULT_FLOW_TIMEOUT_MS, `${own}`)
})

test('signin-request is syntax-checked by the pinned Maestro on the iOS build job', () => {
  assert.ok(CHECKED_FLOWS.includes(FLOW))
})

test('the screen carries the ids the flow and the failure projection read', () => {
  assert.match(app, /testID="signin-email-input"/)
  assert.match(app, /testID="signin-submit"/)
  assert.match(app, /testID="signin-status"/)
})

test('the request path traces focus, the press with a length and a closed outcome, never the address', () => {
  assert.match(app, /onFocus=\{\(\) => traceShareCardOpener\('signin-email-focus'\)\}/)
  assert.match(app, /traceShareCardOpener\('signin-request-press', email\.length\)/)
  assert.match(app, /traceShareCardOpener\('signin-request-ok'\)/)
  assert.match(app, /`signin-request-\$\{reason\}`/)
  assert.doesNotMatch(app, /traceShareCardOpener\([^)]*\bemail[,)]/)
})
