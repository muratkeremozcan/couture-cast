import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { DEFAULT_FLOW_TIMEOUT_MS, flowTimeoutMs } from '../lib/story68-flow-timeouts.mjs'
import { nativeFlowTimeoutMs, OPEN_APP_FLOW } from './native-ios-flow-budget.mjs'

const OPEN_POST = 'maestro/story68/open-post.yaml'

test('the iOS first flow keeps the fixed 120000 ms budget on every open-app run', () => {
  assert.equal(DEFAULT_FLOW_TIMEOUT_MS, 120_000)
  assert.equal(nativeFlowTimeoutMs(OPEN_APP_FLOW, 'ios'), 120_000)
})

test('other platforms and flows use their derived budget', () => {
  assert.equal(
    nativeFlowTimeoutMs(OPEN_APP_FLOW, 'android'),
    flowTimeoutMs(OPEN_APP_FLOW)
  )
  assert.ok(flowTimeoutMs(OPEN_APP_FLOW) > 120_000)
  assert.equal(nativeFlowTimeoutMs(OPEN_POST, 'ios'), flowTimeoutMs(OPEN_POST))
  assert.equal(nativeFlowTimeoutMs(OPEN_POST, 'ios'), 205_000)
  assert.equal(nativeFlowTimeoutMs('maestro/story68/cancel.yaml', 'ios'), 120_000)
})

test('a missing or unknown platform throws instead of reaching the derived open-app budget', () => {
  for (const platform of [undefined, null, '', ' ', 'web', 'iphone', 'ios2', 42, {}])
    assert.throws(
      () => nativeFlowTimeoutMs(OPEN_APP_FLOW, platform),
      /^Error: native_flow_platform_required$/,
      String(platform)
    )
  // Even a flow without a derived budget needs a known platform.
  assert.throws(
    () => nativeFlowTimeoutMs('maestro/story68/cancel.yaml'),
    /platform_required/
  )
})

test('the platform is normalised explicitly, so case and padding cannot bypass the first-flow budget', () => {
  for (const platform of ['IOS', 'iOS', ' ios ', 'Ios'])
    assert.equal(nativeFlowTimeoutMs(OPEN_APP_FLOW, platform), 120_000, platform)
  assert.equal(
    nativeFlowTimeoutMs(OPEN_APP_FLOW, 'ANDROID'),
    nativeFlowTimeoutMs(OPEN_APP_FLOW, 'android')
  )
})

test('maestro() takes its budget only from the helper and never from a literal', () => {
  const harness = fs.readFileSync(
    fileURLToPath(new URL('../run-story68-native.mjs', import.meta.url)),
    'utf8'
  )
  const body = harness.slice(
    harness.indexOf('function maestro('),
    harness.indexOf('\nasync function signin(')
  )
  assert.ok(body.includes('timeout: nativeFlowTimeoutMs(flow, platform),'))
  assert.doesNotMatch(body, /timeout:(?!\s*nativeFlowTimeoutMs\(flow, platform\))/)
})
