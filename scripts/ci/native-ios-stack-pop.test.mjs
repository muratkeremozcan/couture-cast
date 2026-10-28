import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { iosStackPopTaps, recordIosStackPop } from './native-ios-stack-pop.mjs'

const row = (status, selector) => ({
  metadata: { status, evaluatedCommand: { tapOnElement: { selector } } },
})
const outputWith = (t, rows) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-stack-pop-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.mkdirSync(path.join(directory, 'run'))
  fs.writeFileSync(path.join(directory, 'run', 'commands.json'), JSON.stringify(rows))
  return directory
}

test('only completed taps on the exact Back label are counted', (t) => {
  const output = outputWith(t, [
    row('COMPLETED', { textRegex: 'Back' }),
    row('SKIPPED', { textRegex: 'Back' }),
    row('COMPLETED', { textRegex: 'Back to home' }),
    row('COMPLETED', { idRegex: 'BackButton' }),
    row('COMPLETED', { text: 'Back' }),
  ])
  assert.equal(iosStackPopTaps(output), 2)
})

test('the receipt names the tapped element and tolerates a missing or malformed trace', (t) => {
  const output = outputWith(t, [row('COMPLETED', { textRegex: 'Back' })])
  const lines = []
  const record = recordIosStackPop({
    platform: 'ios',
    flow: 'maestro/story65/open-app.yaml',
    output,
    directory: output,
    log: (line) => lines.push(line),
  })
  assert.equal(
    recordIosStackPop({
      platform: 'android',
      flow: record.flow,
      output,
      directory: output,
    }),
    null
  )
  assert.equal(
    recordIosStackPop({
      platform: 'ios',
      flow: 'maestro/other.yaml',
      output,
      directory: output,
    }),
    null
  )
  assert.deepEqual(record.element, { kind: 'text', value: 'Back' })
  assert.equal(record.completedTaps, 1)
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(output, 'native-ios-stack-pop.json')))
      .completedTaps,
    1
  )
  assert.match(lines[0], /iosStackPop/)
  fs.writeFileSync(path.join(output, 'run', 'commands.json'), '{not json')
  assert.equal(iosStackPopTaps(output), 0)
  assert.equal(iosStackPopTaps(path.join(output, 'missing')), 0)
})
