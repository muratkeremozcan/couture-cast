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
  OPEN_POST_WORST_CASE_MS,
  flowTimeoutMs,
} from './story68-flow-timeouts.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const openApp = 'maestro/story65/open-app.yaml'
const openPost = 'maestro/story68/open-post.yaml'

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

/** Declared worst case of open-post.yaml per platform, summed from every wait and walk step. */
function declaredOpenPostWorstCase() {
  const text = fs.readFileSync(new URL(`../../${openPost}`, import.meta.url), 'utf8')
  const blocks = text.split(/^(?=- )/m).slice(1)
  const cost = (block) => {
    const waits = [...block.matchAll(/^\s*timeout:\s*(\d+)\s*$/gm)].reduce(
      (total, match) => total + Number(match[1]),
      0
    )
    const iterations = [...block.matchAll(/^\s*times:\s*(\d+)\s*$/gm)].reduce(
      (total, match) => total + Number(match[1]),
      0
    )
    const repeats = (block.match(/^\s*times:/gm) ?? []).length
    const swipes = (block.match(/^\s*- swipe:/gm) ?? []).length
    const asserts = (block.match(/^\s*-? ?assert(?:Not)?Visible:/gm) ?? []).length
    // Each repeat iteration holds its own swipe; the remaining swipes are single steps.
    return { waits, steps: iterations + (swipes - repeats) + asserts }
  }
  const sum = (parts) =>
    parts.reduce(
      (total, part) => ({
        waits: total.waits + part.waits,
        steps: total.steps + part.steps,
      }),
      { waits: 0, steps: 0 }
    )
  const shared = sum(blocks.filter((b) => !/platform: (iOS|Android)/.test(b)).map(cost))
  const worst = (platform) => {
    const own = sum(blocks.filter((b) => b.includes(`platform: ${platform}`)).map(cost))
    return (
      FLOW_STARTUP_MS +
      shared.waits +
      own.waits +
      (shared.steps + own.steps) * CONDITION_CHECK_MS
    )
  }
  return { ios: worst('iOS'), android: worst('Android') }
}

describe('Maestro flow timeouts', () => {
  test('open-post covers every declared wait and walk step on both platforms with the margin', () => {
    const { ios, android } = declaredOpenPostWorstCase()
    assert.equal(OPEN_POST_WORST_CASE_MS, Math.max(ios, android))
    assert.ok(flowTimeoutMs(openPost) >= Math.max(ios, android) * FLOW_TIMEOUT_MARGIN)
    // The old 38-iteration walk could not be covered by any sane budget.
    assert.ok(flowTimeoutMs(openPost) <= 240_000)
  })

  test('open-app covers its declared worst case with the stated margin', () => {
    const { waitsMs, attempts, checks } = declaredOpenAppBudget()
    assert.deepEqual(
      { waitsMs, attempts, checks },
      { waitsMs: 100_000, attempts: 4, checks: 15 }
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
