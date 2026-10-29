import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { talkbackFlowStrings } from './story67-talkback-env.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const english = JSON.parse(
  fs.readFileSync(path.join(root, 'apps/mobile/assets/locales/en-US.json'), 'utf8')
)
// The runner adds these per call (run-story67-talkback.mjs): the app id and call env.
const runnerProvided = ['MAESTRO_APP_ID', 'MAESTRO_EMAIL', 'MAESTRO_TARGET']

/** Every variable a flow or any flow it includes interpolates. */
function variablesOf(file, seen = new Set()) {
  if (seen.has(file)) return new Set()
  seen.add(file)
  const text = fs.readFileSync(file, 'utf8')
  const names = new Set([...text.matchAll(/\$\{(MAESTRO_[A-Z_]+)\}/g)].map((m) => m[1]))
  for (const [, included] of text.matchAll(/^\s*-?\s*runFlow:\s*(\S+\.yaml)\s*$/gm))
    for (const name of variablesOf(path.resolve(path.dirname(file), included), seen))
      names.add(name)
  return names
}

describe('TalkBack runner Maestro environment', () => {
  test('carries the English back label open-app.yaml interpolates', () => {
    assert.equal(talkbackFlowStrings(english).MAESTRO_BACK, english.common.back)
    assert.ok(english.common.back.length > 0)
  })

  test('defines every variable of the flows the runner starts', () => {
    const flows = [
      'maestro/story65/open-app.yaml',
      ...fs
        .readdirSync(path.join(root, 'maestro/story67'))
        .filter((name) => name.endsWith('.yaml'))
        .map((name) => `maestro/story67/${name}`),
    ]
    const supplied = new Set([
      ...Object.keys(talkbackFlowStrings(english)),
      ...runnerProvided,
    ])
    for (const flow of flows)
      for (const name of variablesOf(path.join(root, flow)))
        assert.ok(supplied.has(name), `${flow} needs ${name}`)
  })
})
