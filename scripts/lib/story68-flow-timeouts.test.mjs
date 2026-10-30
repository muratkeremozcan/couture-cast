import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CONDITION_CHECK_MS,
  DEFAULT_FLOW_TIMEOUT_MS,
  EXPO_GO_ATTEMPT_WAIT_MS,
  EXPO_GO_CONDITION_CHECK_MS,
  EXPO_GO_OPEN_ATTEMPTS,
  EXPO_GO_OPEN_ATTEMPT_MS,
  EXPO_GO_OPEN_FLOW,
  EXPO_GO_OPEN_WORST_CASE_MS,
  FLOW_STARTUP_MS,
  FLOW_TIMEOUT_MARGIN,
  OPEN_APP_WORST_CASE_MS,
  OPEN_POST_WORST_CASE_MS,
  WAIT_SETTINGS_FLOWS,
  WAIT_SETTINGS_TURNS,
  WAIT_SETTINGS_WORST_CASE_MS,
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
    // The guarded opener attempt checks the composer title before it lifts and taps.
    const guards = (block.match(/^\s*when:\n\s*notVisible:/gm) ?? []).length
    // Each repeat iteration holds its own swipe; the remaining swipes are single steps.
    return { waits, steps: iterations + (swipes - repeats) + asserts + guards }
  }
  const sum = (parts) =>
    parts.reduce(
      (total, part) => ({
        waits: total.waits + part.waits,
        steps: total.steps + part.steps,
      }),
      { waits: 0, steps: 0 }
    )
  // The guarded opener tap is a retry; every attempt repeats its waits and steps.
  const guarded = (b) => b.startsWith('- retry:')
  const attempts = (b) => Number(/maxRetries:\s*(\d+)/.exec(b)[1]) + 1
  const sharedBlocks = blocks.filter(
    (b) => guarded(b) || !/platform: (iOS|Android)/.test(b)
  )
  const shared = sum(
    sharedBlocks.map((b) => {
      const part = cost(b)
      const n = guarded(b) ? attempts(b) : 1
      return { waits: part.waits * n, steps: part.steps * n }
    })
  )
  const worst = (platform) => {
    const own = sum(
      blocks.filter((b) => !guarded(b) && b.includes(`platform: ${platform}`)).map(cost)
    )
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
    assert.ok(flowTimeoutMs(openPost) <= 300_000)
  })

  test('open-app covers its declared worst case with the stated margin', () => {
    const { waitsMs, attempts, checks } = declaredOpenAppBudget()
    assert.deepEqual(
      { waitsMs, attempts, checks },
      { waitsMs: 100_000, attempts: 4, checks: 17 }
    )
    const worst = FLOW_STARTUP_MS + attempts * (waitsMs + checks * CONDITION_CHECK_MS)
    assert.equal(OPEN_APP_WORST_CASE_MS, worst)
    assert.ok(flowTimeoutMs(openApp) >= worst * FLOW_TIMEOUT_MARGIN)
    // The killed CI run: one attempt and a half fit in the old fixed budget.
    assert.ok(flowTimeoutMs(openApp) > 4 * DEFAULT_FLOW_TIMEOUT_MS)
  })

  test('expo-go-open covers its declared attempts with the margin and uses no optional wait', () => {
    const text = fs.readFileSync(
      new URL(`../../${EXPO_GO_OPEN_FLOW}`, import.meta.url),
      'utf8'
    )
    const attempts = Number(/^\s*maxRetries:\s*(\d+)\s*$/m.exec(text)[1]) + 1
    // The three `when` checks are the budgeted checks of one attempt.
    const checks = (text.match(/^\s*when:\s*$/gm) ?? []).length
    const waits = [...text.matchAll(/^\s*timeout:\s*(\d+)\s*$/gm)].map((m) =>
      Number(m[1])
    )
    assert.equal(EXPO_GO_OPEN_ATTEMPTS, attempts)
    assert.equal(
      EXPO_GO_OPEN_ATTEMPT_MS,
      EXPO_GO_ATTEMPT_WAIT_MS + checks * EXPO_GO_CONDITION_CHECK_MS + 4_000
    )
    // One wait, the named tab-bar wait, and no optional wait that could return early.
    assert.deepEqual(waits, [EXPO_GO_ATTEMPT_WAIT_MS])
    assert.doesNotMatch(text, /optional:/)
    // The project has this long, in waits alone, to show the tab bar.
    assert.ok(attempts * waits[0] >= 180_000)
    const worst = FLOW_STARTUP_MS + attempts * EXPO_GO_OPEN_ATTEMPT_MS
    assert.equal(EXPO_GO_OPEN_WORST_CASE_MS, worst)
    assert.ok(flowTimeoutMs(EXPO_GO_OPEN_FLOW) >= worst * FLOW_TIMEOUT_MARGIN)
    // The killed CI run: open-app.yaml hit the fixed 120 s with the project still loading.
    assert.ok(flowTimeoutMs(EXPO_GO_OPEN_FLOW) > 2 * DEFAULT_FLOW_TIMEOUT_MS)
    // A project that never loads names its failure on the wait, not on the kill.
    assert.match(text, /label: 'expo_go_project_not_loaded'/)
  })

  test('the harness passes each flow its own budget to the Maestro process', () => {
    const harness = fs.readFileSync(`${root}scripts/run-story68-native.mjs`, 'utf8')
    assert.match(
      harness,
      /timeout: (?:flowTimeoutMs|nativeFlowTimeoutMs)\(flow(?:, platform)?\),/
    )
    assert.doesNotMatch(harness, /timeout: 120_000/)
    // maestro() hands the process (and the iOS deadline worker) only the derived budget.
    const body = harness.slice(
      harness.indexOf('function maestro('),
      harness.indexOf('\nasync function signin(')
    )
    assert.match(
      body,
      /timeout: (?:flowTimeoutMs|nativeFlowTimeoutMs)\(flow(?:, platform)?\),/
    )
    assert.doesNotMatch(
      body,
      /timeout:(?!\s*(?:flowTimeoutMs|nativeFlowTimeoutMs)\(flow(?:, platform)?\),)/
    )
    assert.equal(flowTimeoutMs('maestro/story68/cancel.yaml'), DEFAULT_FLOW_TIMEOUT_MS)
  })

  test('the settings wait subflow count bound and the process budgets of its flows agree', () => {
    const wait = fs.readFileSync(
      new URL('../../maestro/story65/wait-notification-settings.yaml', import.meta.url),
      'utf8'
    )
    assert.equal(Number(/times:\s*(\d+)/.exec(wait)[1]), WAIT_SETTINGS_TURNS)
    assert.equal(WAIT_SETTINGS_FLOWS.length, 3)
    for (const flow of WAIT_SETTINGS_FLOWS) {
      const text = fs.readFileSync(new URL(`../../${flow}`, import.meta.url), 'utf8')
      assert.match(text, /runFlow: wait-notification-settings\.yaml/, flow)
      assert.ok(
        flowTimeoutMs(flow) >=
          Math.ceil(
            (DEFAULT_FLOW_TIMEOUT_MS + WAIT_SETTINGS_WORST_CASE_MS) * FLOW_TIMEOUT_MARGIN
          ),
        flow
      )
      assert.ok(flowTimeoutMs(flow) > DEFAULT_FLOW_TIMEOUT_MS, flow)
    }
  })
})
