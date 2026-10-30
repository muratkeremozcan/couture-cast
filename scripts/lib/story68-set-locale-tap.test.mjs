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
  SET_LOCALE_FLOW,
  SET_LOCALE_OTHER_STEPS_MS,
  SET_LOCALE_SETTLE_WAIT_MS,
  SET_LOCALE_TAP_ATTEMPTS,
  SET_LOCALE_TAP_ATTEMPT_MS,
  SET_LOCALE_TAP_WORST_CASE_MS,
  flowTimeoutMs,
} from './story68-flow-timeouts.mjs'

const commands = parse(
  fs
    .readFileSync(new URL(`../../${SET_LOCALE_FLOW}`, import.meta.url), 'utf8')
    .split(/^---$/m)[1]
)
const button = { id: 'locale-btn-${MAESTRO_LOCALE}' }
const retryStep = commands.find((step) => step.retry)
const [guard, settled, selected] = retryStep.retry.commands
// Any language button but the target: the id is a full-match regex, and no locale id is a prefix
// of another.
const otherButtons = { id: 'locale-btn-(?!${MAESTRO_LOCALE}).+' }

/** Every tapOn of the language button in a command tree. */
function buttonTaps(node) {
  if (Array.isArray(node)) return node.flatMap(buttonTaps)
  if (node && typeof node === 'object') {
    if (node.tapOn?.id === button.id) return [node]
    return Object.values(node).flatMap(buttonTaps)
  }
  return []
}

test('the language button is tapped only while it reads enabled, then the change must finish and the target stay selected', () => {
  assert.equal(commands.filter((step) => step.retry).length, 1)
  assert.equal(retryStep.retry.maxRetries, SET_LOCALE_TAP_ATTEMPTS - 1)
  assert.equal(retryStep.retry.commands.length, 3)
  assert.deepEqual(guard.runFlow.when, { visible: { ...button, enabled: true } })
  assert.equal(buttonTaps(guard.runFlow.commands).length, 1)
  assert.equal(buttonTaps(commands).length, 1, 'the only tap is the guarded one')
  // Disabled also holds while a change is in flight, and a failed change rolls back. A different
  // button reading enabled again proves the change finished (every button is disabled while it
  // runs); the target still reading disabled then proves it stayed selected, because a rollback
  // enables it again. Only the enabled attribute is read: it is device proven on iOS.
  assert.deepEqual(settled.extendedWaitUntil.visible, { ...otherButtons, enabled: true })
  assert.equal(settled.extendedWaitUntil.timeout, SET_LOCALE_SETTLE_WAIT_MS)
  assert.deepEqual(selected.extendedWaitUntil.visible, { ...button, enabled: false })
  const seconds = selected.extendedWaitUntil.timeout / 1000
  assert.ok(seconds >= 5 && seconds <= 10)
  assert.equal(selected.extendedWaitUntil.timeout, CONDITION_CHECK_MS)
  assert.equal(commands.at(-1), 'waitForAnimationToEnd')
})

test('the product disables a language button that is selected or changing', () => {
  const settings = fs.readFileSync(
    new URL('../../apps/mobile/app/(tabs)/settings.tsx', import.meta.url),
    'utf8'
  )
  assert.match(settings, /disabled=\{isChangingLocale \|\| isSelected\}/)
  assert.match(settings, /disabled: isChangingLocale \|\| isSelected,/)
})

test('the process budget covers the settings opener, the scroll and every tap attempt', () => {
  const opener = parse(
    fs
      .readFileSync(
        new URL('../../maestro/story65/open-settings-tab.yaml', import.meta.url),
        'utf8'
      )
      .split(/^---$/m)[1]
  ).find((step) => step.retry)
  const attempts = opener.retry.maxRetries + 1
  const scroll = commands.find((step) => step.scrollUntilVisible).scrollUntilVisible
  assert.equal(
    SET_LOCALE_OTHER_STEPS_MS,
    attempts * (opener.retry.commands[1].extendedWaitUntil.timeout + 2_000) +
      scroll.timeout +
      2_000
  )
  assert.equal(
    SET_LOCALE_TAP_ATTEMPT_MS,
    CONDITION_CHECK_MS + SET_LOCALE_SETTLE_WAIT_MS + CONDITION_CHECK_MS + 2_000,
    'a guard check, the tap, the settle wait and the selected wait'
  )
  assert.equal(
    SET_LOCALE_TAP_WORST_CASE_MS,
    SET_LOCALE_TAP_ATTEMPTS * SET_LOCALE_TAP_ATTEMPT_MS
  )
  assert.equal(
    flowTimeoutMs(SET_LOCALE_FLOW),
    Math.ceil(
      (FLOW_STARTUP_MS + SET_LOCALE_OTHER_STEPS_MS + SET_LOCALE_TAP_WORST_CASE_MS) *
        FLOW_TIMEOUT_MARGIN
    )
  )
  assert.ok(flowTimeoutMs(SET_LOCALE_FLOW) > DEFAULT_FLOW_TIMEOUT_MS)
})

test('the flow is syntax checked in the iOS build job', () => {
  assert.ok(CHECKED_FLOWS.includes(SET_LOCALE_FLOW))
})
