import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import { parseAllDocuments } from 'yaml'

test('the warmed held flow acquires before every original assertion and releases after all of them', () => {
  const documents = parseAllDocuments(
    fs.readFileSync('maestro/story68/rapid-watermark-held.yaml', 'utf8')
  )
  const commands = documents[1].toJSON()
  assert.equal(commands[0].runScript.env.MAESTRO_RAPID_ACTION, 'acquire')
  assert.equal(commands.at(-1).runScript?.env.MAESTRO_RAPID_ACTION, 'release')
  const held = commands.slice(1, -1)
  assert.equal(held.length, 12)
  assert.equal(held.filter((c) => c.assertVisible === '${MAESTRO_PREPARING}').length, 3)
  assert.equal(
    held.filter((c) => c.assertNotVisible?.id === 'share-card-preview-loaded-.*').length,
    3
  )
  assert.deepEqual(
    held.flatMap((c) =>
      typeof c.assertVisible?.checked === 'boolean' ? [c.assertVisible.checked] : []
    ),
    [true, false, true]
  )
  assert.equal(
    held.some((c) => c.runScript || c.extendedWaitUntil || c.runFlow),
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
