import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'
import { CHECKED_FLOWS } from '../ci/maestro-check-flows.mjs'

const file = 'maestro/story68/toggle-once.yaml'
const text = fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
// A Maestro flow is a config document, then the command list.
const commands = parse(text.split(/^---$/m)[1])
const previous = 'share-card-preview-loaded-${MAESTRO_PREVIOUS_PREVIEW}'
const tapped = (steps) =>
  JSON.stringify(steps ?? []).includes('"tapOn":{"id":"share-card-watermark"}')

test('the flow checks the previous preview, retries a toggle that did not register, then waits for the new one', () => {
  assert.deepEqual(commands[0], { assertVisible: { id: previous } })
  const retry = commands[1].retry
  assert.ok(retry && retry.maxRetries >= 2 && retry.maxRetries <= 4)
  assert.deepEqual(
    commands.slice(2).map((step) => Object.keys(step)[0]),
    ['extendedWaitUntil', 'assertNotVisible']
  )
})

test('the watermark is tapped only while the previous digest is on screen, so a late press is not undone', () => {
  const [guarded, wait] = commands[1].retry.commands
  assert.deepEqual(guarded.runFlow.when, { visible: { id: previous } })
  assert.ok(tapped(guarded.runFlow.commands))
  // No tap anywhere else in the flow: every retry goes through the guard.
  assert.equal(JSON.stringify(commands).split('share-card-watermark').length - 1, 1)
  assert.deepEqual(wait.extendedWaitUntil.notVisible, { id: previous })
})

test('each attempt waits long enough for a slow host to answer and the retries stay inside the flow budget', () => {
  const [, wait] = commands[1].retry.commands
  const { timeout } = wait.extendedWaitUntil
  assert.ok(timeout >= 5000 && timeout <= 10000, String(timeout))
  const { maxRetries } = commands[1].retry
  // Worst case: every attempt times out, then the 20 s wait for the new preview.
  assert.ok((maxRetries + 1) * timeout + 20000 < 100000)
})

test('the flow is syntax-checked by the pinned Maestro on the iOS build job', () => {
  assert.ok(CHECKED_FLOWS.includes(file))
})
