// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import { parseAllDocuments } from 'yaml'
import { holdLimitMs } from './story68-rapid-watermark.mjs'

test('the warmed held flow acquires before every original assertion and releases after all of them', () => {
  const documents = parseAllDocuments(
    fs.readFileSync('maestro/story68/rapid-watermark-held.yaml', 'utf8')
  )
  const commands = documents[1].toJSON()
  assert.equal(commands[0].runScript.env.MAESTRO_RAPID_ACTION, 'acquire')
  assert.equal(commands.at(-1).runScript?.env.MAESTRO_RAPID_ACTION, 'release')
  const held = commands.slice(1, -1)
  // Only the opener may be pressed again (a cancelled touch starts no prepare request), and
  // only while the composer is closed; the retry carries the first Preparing check itself.
  const [opener, ...presses] = held
  assert.equal(opener.retry.maxRetries, 2)
  assert.deepEqual(opener.retry.commands, [
    {
      runFlow: {
        when: { notVisible: { id: 'share-card-title' } },
        commands: [{ tapOn: { id: 'outfit-share-card-open', index: 0 } }],
      },
    },
    { extendedWaitUntil: { visible: '${MAESTRO_PREPARING}', timeout: 5000 } },
  ])
  // Two lost presses and the third that lands still end well inside the 30 s hold.
  assert.ok(3 * opener.retry.commands[1].extendedWaitUntil.timeout <= holdLimitMs / 2)
  assert.equal(presses.length, 10)
  assert.equal(
    presses.filter((c) => c.assertVisible === '${MAESTRO_PREPARING}').length,
    2
  )
  assert.equal(
    presses.filter((c) => c.assertNotVisible?.id === 'share-card-preview-loaded-.*')
      .length,
    3
  )
  assert.deepEqual(
    presses.flatMap((c) =>
      typeof c.assertVisible?.checked === 'boolean' ? [c.assertVisible.checked] : []
    ),
    [true, false, true]
  )
  // The watermark presses run against the held source, so nothing between them may wait or retry.
  assert.equal(
    presses.some((c) => c.runScript || c.extendedWaitUntil || c.runFlow || c.retry),
    false
  )
})
test('the actual Maestro script uses only its declared host acquire/release route and fails closed on HTTP error', () => {
  const script = fs.readFileSync('maestro/story68/rapid-watermark-control.js', 'utf8')
  for (const action of ['acquire', 'release']) {
    const calls = []
    vm.runInNewContext(script, {
      MAESTRO_RAPID_ACTION: action,
      MAESTRO_RAPID_CONTROL_URL: 'http://127.0.0.1:12345/one-shot',
      http: {
        post: (url) => {
          calls.push(url)
          return { status: 200 }
        },
      },
    })
    assert.deepEqual(calls, [`http://127.0.0.1:12345/one-shot/${action}`])
  }
  assert.throws(
    () =>
      vm.runInNewContext(script, {
        MAESTRO_RAPID_ACTION: 'release',
        MAESTRO_RAPID_CONTROL_URL: 'http://127.0.0.1:12345/one-shot',
        http: { post: () => ({ status: 503 }) },
      }),
    /Rapid watermark control failed/
  )
})
