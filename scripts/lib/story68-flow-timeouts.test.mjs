import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CONDITION_CHECK_MS,
  DEFAULT_FLOW_TIMEOUT_MS,
  FLOW_STARTUP_MS,
  FLOW_TIMEOUT_MARGIN,
  OPEN_APP_WORST_CASE_MS,
  flowTimeoutMs,
} from './story68-flow-timeouts.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const openApp = 'maestro/story65/open-app.yaml'

/** Reads the budget inputs straight from the flow so an edited wait cannot drift. */
function declaredOpenAppBudget() {
  const text = fs.readFileSync(new URL(`../../${openApp}`, import.meta.url), 'utf8')
  const lines = text.split('\n')
  const repeatAt = lines.findIndex((line) => /^\s*- repeat:\s*$/.test(line))
  const repeatIndent = lines[repeatAt].search(/\S/)
  const repeatEnd = lines.findIndex(
    (line, index) =>
      index > repeatAt && line.trim() !== '' && line.search(/\S/) <= repeatIndent
  )
  const block = lines.slice(repeatAt, repeatEnd)
  const times = Number(/times:\s*(\d+)/.exec(block.join('\n'))[1])
  const conditions = (part) => part.filter((line) => /^\s*when:\s*$/.test(line)).length
  return {
    waitsMs: [...text.matchAll(/^\s*timeout:\s*(\d+)\s*$/gm)].reduce(
      (total, match) => total + Number(match[1]),
      0
    ),
    attempts: Number(/^\s*maxRetries:\s*(\d+)\s*$/m.exec(text)[1]) + 1,
    checks:
      conditions([...lines.slice(0, repeatAt), ...lines.slice(repeatEnd)]) +
      times * conditions(block),
  }
}

describe('Maestro flow timeouts', () => {
  test('open-app covers its declared worst case with the stated margin', () => {
    const { waitsMs, attempts, checks } = declaredOpenAppBudget()
    assert.deepEqual(
      { waitsMs, attempts, checks },
      { waitsMs: 100_000, attempts: 4, checks: 12 }
    )
    const worst = FLOW_STARTUP_MS + attempts * (waitsMs + checks * CONDITION_CHECK_MS)
    assert.equal(OPEN_APP_WORST_CASE_MS, worst)
    assert.ok(flowTimeoutMs(openApp) >= worst * FLOW_TIMEOUT_MARGIN)
    // The killed CI run: one attempt and a half fit in the old fixed budget.
    assert.ok(flowTimeoutMs(openApp) > 4 * DEFAULT_FLOW_TIMEOUT_MS)
  })

  test('the harness passes each flow its own budget to the Maestro process', () => {
    const harness = fs.readFileSync(`${root}scripts/run-story68-native.mjs`, 'utf8')
    assert.match(harness, /timeout: flowTimeoutMs\(flow\),/)
    assert.doesNotMatch(harness, /timeout: 120_000/)
    assert.equal(flowTimeoutMs('maestro/story68/cancel.yaml'), DEFAULT_FLOW_TIMEOUT_MS)
  })
})
