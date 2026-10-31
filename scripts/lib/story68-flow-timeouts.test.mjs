import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { shareSheetFlowRuns, shareSheetSaveProofs } from './story69-share-sheet.mjs'
import {
  CONDITION_CHECK_MS,
  DEFAULT_FLOW_TIMEOUT_MS,
  EXPO_GO_CONDITION_CHECK_MS,
  EXPO_GO_CONDITION_CHECKS,
  EXPO_GO_OPEN_FLOW,
  EXPO_GO_OPEN_WAITS_MS,
  EXPO_GO_TAP_MS,
  EXPO_GO_TAPS,
  EXPO_GO_OPEN_WORST_CASE_MS,
  FLOW_STARTUP_MS,
  FLOW_TIMEOUT_MARGIN,
  OPEN_APP_WORST_CASE_MS,
  OPEN_POST_WORST_CASE_MS,
  SHARE_SHEET_DISMISS_MS,
  SHARE_SHEET_DISMISS_WAIT_MS,
  SHARE_SHEET_EXTRACT_ESTIMATE_MS,
  SHARE_SHEET_FLOW,
  SHARE_SHEET_FLOW_ESTIMATE_MS,
  ANDROID_SHARE_LANE_BASE_MS,
  SHARE_SHEET_LANE_HEADROOM_MS,
  SHARE_SHEET_NATIVE_TEST_ESTIMATE_MS,
  SHARE_TAP_ATTEMPTS,
  SHARE_TAP_ATTEMPT_MS,
  SHARE_TAP_FLOWS,
  SHARE_TAP_SCROLL_MS,
  SHARE_TAP_WORST_CASE_MS,
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

  test('expo-go-open runs each declared wait once and covers them with the margin', () => {
    const text = fs.readFileSync(
      new URL(`../../${EXPO_GO_OPEN_FLOW}`, import.meta.url),
      'utf8'
    )
    const commands = text.replace(/^\s*#.*$/gm, '')
    const waits = [...commands.matchAll(/^\s*timeout:\s*(\d+)\s*$/gm)].map((m) =>
      Number(m[1])
    )
    // One `when` check guards the open-prompt tap; the second tap is the sheet backdrop.
    const checks = (commands.match(/^\s*when:\s*$/gm) ?? []).length
    const taps = (commands.match(/^\s*- tapOn:/gm) ?? []).length
    assert.deepEqual(waits, [...EXPO_GO_OPEN_WAITS_MS])
    assert.equal(checks, EXPO_GO_CONDITION_CHECKS)
    assert.equal(taps, EXPO_GO_TAPS)
    // A wait Maestro runs again returns at once (run 41019906459), so none may be in a loop.
    assert.doesNotMatch(commands, /^\s*-?\s*(?:retry|repeat):/m)
    // Only the open prompt may be absent; the project load and the dismissed sheet are named.
    assert.equal((commands.match(/optional: true/g) ?? []).length, 1)
    assert.match(commands, /label: 'expo_go_project_not_loaded'/)
    assert.match(commands, /label: 'expo_go_developer_menu_left_open'\s*$/)
    // The developer-menu sheet is not in the hierarchy, so nothing may wait on its text.
    assert.doesNotMatch(commands, /developer menu|Continue|Connected to/)
    const worst =
      FLOW_STARTUP_MS +
      waits.reduce((total, wait) => total + wait, 0) +
      checks * EXPO_GO_CONDITION_CHECK_MS +
      taps * EXPO_GO_TAP_MS
    assert.equal(EXPO_GO_OPEN_WORST_CASE_MS, worst)
    assert.ok(flowTimeoutMs(EXPO_GO_OPEN_FLOW) >= worst * FLOW_TIMEOUT_MARGIN)
    // The killed CI run: open-app.yaml hit the fixed 120 s with the project still loading.
    assert.ok(flowTimeoutMs(EXPO_GO_OPEN_FLOW) > 2 * DEFAULT_FLOW_TIMEOUT_MS)
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

// U-HARNESS-TIMEOUTS (Story 6.9): every share flow has its own derived budget, the budgets match
// what the flows declare, and the share-sheet command fits the headroom of each lane that runs it.
describe('Story 6.9 share flow timeouts', () => {
  const dir = new URL('../../maestro/story68/', import.meta.url)
  const commands = (name) =>
    parse(fs.readFileSync(new URL(name, dir), 'utf8').split(/^---$/m)[1])
  const shareFlows = fs
    .readdirSync(dir)
    .filter((name) => /^share-.*\.yaml$/.test(name))
    .map((name) => `maestro/story68/${name}`)
    .sort()

  test('every share-*.yaml flow has a budget above the default that covers its Share tap', () => {
    assert.deepEqual(shareFlows, [...SHARE_TAP_FLOWS, SHARE_SHEET_FLOW].sort())
    for (const flow of SHARE_TAP_FLOWS) {
      assert.equal(
        flowTimeoutMs(flow),
        Math.ceil(
          (DEFAULT_FLOW_TIMEOUT_MS + SHARE_TAP_WORST_CASE_MS) * FLOW_TIMEOUT_MARGIN
        ),
        flow
      )
      const text = fs.readFileSync(`${root}${flow}`, 'utf8')
      assert.match(text, /file: tap-share\.yaml/, `${flow} taps through tap-share`)
      assert.equal(
        (text.match(/file: tap-share\.yaml/g) ?? []).length,
        1,
        `${flow}: one tap`
      )
    }
    assert.equal(
      flowTimeoutMs(SHARE_SHEET_FLOW),
      Math.ceil(
        (DEFAULT_FLOW_TIMEOUT_MS + SHARE_TAP_WORST_CASE_MS + SHARE_SHEET_DISMISS_MS) *
          FLOW_TIMEOUT_MARGIN
      )
    )
    for (const flow of shareFlows)
      assert.ok(flowTimeoutMs(flow) > DEFAULT_FLOW_TIMEOUT_MS, flow)
  })

  test('tap-share declares exactly the scroll, settle and retry the budget counts', () => {
    const [precondition, scroll, settle, retry, ...rest] = commands('tap-share.yaml')
    assert.deepEqual(rest, [])
    assert.equal(precondition.assertNotVisible, '${MAESTRO_SHARE_OUTCOME}')
    assert.equal(scroll.scrollUntilVisible.element.id, 'share-card-share')
    assert.equal(
      SHARE_TAP_SCROLL_MS,
      scroll.scrollUntilVisible.timeout + 3 * CONDITION_CHECK_MS
    )
    assert.equal(settle, 'waitForAnimationToEnd')
    assert.equal(retry.retry.maxRetries + 1, SHARE_TAP_ATTEMPTS)
    const [guard, wait] = retry.retry.commands
    assert.deepEqual(guard.runFlow.when, {
      visible: { id: 'share-card-share', enabled: true },
      notVisible: '${MAESTRO_SHARING}|${MAESTRO_SHARE_OUTCOME}',
    })
    assert.deepEqual(guard.runFlow.commands, [{ tapOn: { id: 'share-card-share' } }])
    assert.equal(
      wait.extendedWaitUntil.visible,
      '${MAESTRO_SHARING}|${MAESTRO_SHARE_OUTCOME}'
    )
    assert.equal(
      SHARE_TAP_ATTEMPT_MS,
      2 * CONDITION_CHECK_MS + wait.extendedWaitUntil.timeout + CONDITION_CHECK_MS
    )
  })

  test('share-sheet declares the same scroll and retry on Android and the counted dismissal', () => {
    const steps = commands('share-sheet.yaml')
    const scroll = steps.find((step) => step.scrollUntilVisible)
    assert.equal(
      SHARE_TAP_SCROLL_MS,
      scroll.scrollUntilVisible.timeout + 3 * CONDITION_CHECK_MS
    )
    // The iOS real sheet runs in ShareCardShareSheetUITests; the flow has no iOS branch.
    assert.equal(
      steps.some((step) => step.runFlow?.when?.platform === 'iOS'),
      false
    )
    for (const platform of ['Android']) {
      const branch = steps.find((step) => step.runFlow?.when?.platform === platform)
        .runFlow.commands
      const retry = branch.find((step) => step.retry).retry
      assert.equal(retry.maxRetries + 1, SHARE_TAP_ATTEMPTS, platform)
      const wait = retry.commands.find((step) => step.extendedWaitUntil).extendedWaitUntil
      assert.equal(
        SHARE_TAP_ATTEMPT_MS,
        2 * CONDITION_CHECK_MS + wait.timeout + CONDITION_CHECK_MS,
        platform
      )
      // Dismissal: the steps after the retry, each one condition check, plus the declared wait.
      const dismissal = branch.slice(branch.findIndex((step) => step.retry) + 1)
      const waits = dismissal
        .map((step) => step.extendedWaitUntil?.timeout ?? 0)
        .reduce((total, value) => total + value, 0)
      const checks = dismissal.reduce((total, step) => total + (step.runFlow ? 2 : 1), 0)
      assert.equal(waits, SHARE_SHEET_DISMISS_WAIT_MS, platform)
      assert.ok(
        waits + checks * CONDITION_CHECK_MS <= SHARE_SHEET_DISMISS_MS,
        `${platform}: ${checks} checks`
      )
    }
  })

  test('the share-sheet command fits the measured headroom of android36-interaction and iOS shard 1', () => {
    for (const platform of ['android', 'ios']) {
      const flows = shareSheetFlowRuns(platform)
      for (const flow of flows) assert.ok(fs.existsSync(`${root}${flow}`), flow)
      const estimate =
        flows.length * SHARE_SHEET_FLOW_ESTIMATE_MS +
        shareSheetSaveProofs(platform) * SHARE_SHEET_EXTRACT_ESTIMATE_MS +
        SHARE_SHEET_NATIVE_TEST_ESTIMATE_MS[platform]
      assert.ok(
        estimate <= SHARE_SHEET_LANE_HEADROOM_MS[platform],
        `${platform}: ${estimate} ms of ${SHARE_SHEET_LANE_HEADROOM_MS[platform]} ms`
      )
    }
    // The headroom is what the lane's own limit leaves after its measured run.
    const workflow = parse(
      fs.readFileSync(`${root}.github/workflows/pr-share-card-native.yml`, 'utf8')
    )
    const interaction = workflow.jobs['android36-interaction'].strategy.matrix.include[0]
    assert.equal(interaction.suite, 'interaction')
    assert.equal(
      SHARE_SHEET_LANE_HEADROOM_MS.android,
      interaction.journey_timeout * 60_000 - ANDROID_SHARE_LANE_BASE_MS
    )
    // The interaction lane runs share-sheet and the Release font proof and nothing else after
    // sign-in; the rapid watermark, TalkBack and fallback focus proofs run in android36-controls.
    const script = fs.readFileSync(`${root}scripts/ci/share-card-android.sh`, 'utf8')
    const branch = script.slice(
      script.indexOf('  interaction)'),
      script.indexOf(';;', script.indexOf('  interaction)'))
    )
    assert.match(branch, /^ {4}native share-sheet$/m)
    assert.match(branch, /share-card-android-release-font\.sh/)
    assert.doesNotMatch(branch, /rapid-watermark|a11y|fallback-focus/)
    assert.equal(
      workflow.jobs['android36-controls'].strategy.matrix.include[0].suite,
      'controls'
    )
    assert.equal(
      SHARE_SHEET_LANE_HEADROOM_MS.ios,
      workflow.jobs['ios-shard']['timeout-minutes'] * 60_000 - 49 * 60_000
    )
  })
})
