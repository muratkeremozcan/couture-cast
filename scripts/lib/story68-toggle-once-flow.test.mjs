// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
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

// Every flow that taps the watermark switch once and then waits on what the tap changes. Run
// 40898729331 shard 1 (watermark.yaml): the tap completed, the app logged no prepare for it and
// the switch stayed checked, the same dropped press as toggle-once.
const watermarkSwitch = 'share-card-watermark'
const flowsDir = new URL('../../maestro/story68/', import.meta.url)
const flowCommands = (name) =>
  parse(fs.readFileSync(new URL(name, flowsDir), 'utf8').split(/^---$/m)[1])
/** The tapOn nodes of the watermark switch anywhere in a command tree, with their parents. */
function watermarkTaps(node, parents = []) {
  if (Array.isArray(node)) return node.flatMap((child) => watermarkTaps(child, parents))
  if (node && typeof node === 'object') {
    if (node.tapOn?.id === watermarkSwitch) return [{ node, parents }]
    return Object.values(node).flatMap((child) =>
      watermarkTaps(child, [...parents, node])
    )
  }
  return []
}
const state = (checked) => ({ id: watermarkSwitch, checked })
const guardedTap = (commands, from) => {
  const retries = commands.filter((step) => step.retry)
  return retries.filter((step) => {
    const [guard, wait] = step.retry.commands
    return (
      JSON.stringify(guard.runFlow?.when) === JSON.stringify({ visible: state(from) }) &&
      tapped(guard.runFlow?.commands) &&
      JSON.stringify(wait.extendedWaitUntil?.visible) === JSON.stringify(state(!from)) &&
      wait.extendedWaitUntil.timeout >= 5000 &&
      wait.extendedWaitUntil.timeout <= 10000 &&
      step.retry.maxRetries >= 2 &&
      step.retry.maxRetries <= 4
    )
  })
}

test('watermark.yaml taps OFF then ON, each inside a retry that waits for the switch to flip and taps only from its start state', () => {
  const commands = flowCommands('watermark.yaml')
  assert.equal(guardedTap(commands, true).length, 1, 'OFF tap')
  assert.equal(guardedTap(commands, false).length, 1, 'ON tap')
  // Both taps are the only ones in the flow, so every press goes through a guard.
  assert.equal(watermarkTaps(commands).length, 2)
})

test('watermark.yaml keeps its assertions: ON digest first, a new digest for OFF, the ON digest again after ON', () => {
  const text = fs.readFileSync(new URL('watermark.yaml', flowsDir), 'utf8')
  const commands = flowCommands('watermark.yaml')
  assert.deepEqual(commands[0], {
    assertVisible: { id: 'share-card-preview-loaded-${MAESTRO_ON_PREVIEW}' },
  })
  assert.deepEqual(commands[1], { assertVisible: state(true) })
  assert.match(
    text,
    /notVisible:\s+id: share-card-preview-loaded-\$\{MAESTRO_ON_PREVIEW\}\s+timeout: 20000/
  )
  assert.match(
    text,
    /assertNotVisible:\s+id: share-card-preview-loaded-\$\{MAESTRO_ON_PREVIEW\}/
  )
  const last = commands.slice(-2)
  assert.deepEqual(last[0].extendedWaitUntil.visible, {
    id: 'share-card-preview-loaded-${MAESTRO_ON_PREVIEW}',
  })
  assert.equal(last[0].extendedWaitUntil.timeout, 20000)
  assert.deepEqual(last[1], { assertVisible: { id: 'share-card-save' } })
})

test('release-watermark-off.yaml turns the switch off through the same guarded retry', () => {
  const commands = flowCommands('release-watermark-off.yaml')
  assert.equal(guardedTap(commands, true).length, 1)
  assert.equal(watermarkTaps(commands).length, 1)
})

test('no flow taps the watermark switch outside a guard, except the timed rapid flow', () => {
  // rapid-watermark-held.yaml presses the switch back to back while the preview is held in
  // `preparing`. Each press supersedes a prepare request that must leave the held source
  // within 12 s of arriving, so a guard read per press would spend that budget; it asserts
  // each press immediately instead.
  const timedExceptions = new Set(['rapid-watermark-held.yaml'])
  const names = fs
    .readdirSync(flowsDir)
    .filter((name) => name.endsWith('.yaml'))
    .filter((name) =>
      fs.readFileSync(new URL(name, flowsDir), 'utf8').includes(watermarkSwitch)
    )
  assert.ok(
    names.includes('watermark.yaml') && names.includes('rapid-watermark-held.yaml')
  )
  for (const name of names) {
    if (timedExceptions.has(name)) continue
    const taps = watermarkTaps(flowCommands(name))
    for (const { parents } of taps)
      assert.ok(
        parents.some((parent) => {
          const visible = parent.runFlow?.when?.visible
          // The switch's own state, or the pre-tap digest toggle-once.yaml is handed.
          return (
            (visible?.id === watermarkSwitch && typeof visible.checked === 'boolean') ||
            visible?.id === previous
          )
        }),
        `${name}: a watermark tap is outside a state guard`
      )
  }
})

test('the guarded watermark flows are syntax-checked by the pinned Maestro on the iOS build job', () => {
  for (const name of ['watermark.yaml', 'release-watermark-off.yaml'])
    assert.ok(CHECKED_FLOWS.includes(`maestro/story68/${name}`), name)
})
