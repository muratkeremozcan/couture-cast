import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'
import { CHECKED_FLOWS } from '../ci/maestro-check-flows.mjs'

const file = 'maestro/story65/open-app.yaml'
const text = fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
const commands = parse(text.split(/^---$/m)[1])
const attempt = commands[0].retry.commands
const isDismissal = (step) =>
  JSON.stringify(step.runFlow?.when) ===
    JSON.stringify({ platform: 'Android', visible: { id: 'android:id/aerr_wait' } }) &&
  JSON.stringify(step.runFlow.commands.map((command) => command.tapOn?.id)) ===
    JSON.stringify(['android:id/aerr_wait'])

test('every attempt starts by dismissing an Android not-responding dialog with Wait', () => {
  assert.ok(isDismissal(attempt[0]))
})

test('the dialog is dismissed again right before the wait for the tab bar', () => {
  const wait = attempt.findIndex(
    (step) => step.extendedWaitUntil?.visible?.id === 'tab-home'
  )
  assert.ok(wait > 0)
  assert.ok(isDismissal(attempt[wait - 1]))
})

test('the flow never closes the app that is not responding and the guard is Android only', () => {
  assert.doesNotMatch(JSON.stringify(commands), /Close app|aerr_close/)
  for (const step of attempt.filter(isDismissal))
    assert.equal(step.runFlow.when.platform, 'Android')
})

test('open-app.yaml is syntax-checked by the pinned Maestro on the iOS build job', () => {
  assert.ok(CHECKED_FLOWS.includes(file))
})
