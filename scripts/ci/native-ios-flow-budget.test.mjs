import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { DEFAULT_FLOW_TIMEOUT_MS, flowTimeoutMs } from '../lib/story68-flow-timeouts.mjs'
import {
  IOS_FIRST_FLOW_TIMEOUT_MS,
  nativeFlowTimeoutMs,
  OPEN_APP_FLOW,
} from './native-ios-flow-budget.mjs'

const OPEN_POST = 'maestro/story68/open-post.yaml'

test('the iOS first flow keeps one fixed 240000 ms budget on every open-app run', () => {
  // Story 6.15: measured on the iOS 26.5 simulator (native-ios-flow-budget.mjs header).
  assert.equal(IOS_FIRST_FLOW_TIMEOUT_MS, 240_000)
  assert.equal(nativeFlowTimeoutMs(OPEN_APP_FLOW, 'ios'), 240_000)
  // The derived default for other flows is unchanged.
  assert.equal(DEFAULT_FLOW_TIMEOUT_MS, 120_000)
  // The fixed gate stays far below the derived open-app worst case, so it still fails fast.
  assert.ok(flowTimeoutMs(OPEN_APP_FLOW) > 4 * IOS_FIRST_FLOW_TIMEOUT_MS)
})

test('other platforms and flows use their derived budget', () => {
  assert.equal(
    nativeFlowTimeoutMs(OPEN_APP_FLOW, 'android'),
    flowTimeoutMs(OPEN_APP_FLOW)
  )
  assert.ok(flowTimeoutMs(OPEN_APP_FLOW) > 120_000)
  assert.equal(nativeFlowTimeoutMs(OPEN_POST, 'ios'), flowTimeoutMs(OPEN_POST))
  assert.equal(nativeFlowTimeoutMs(OPEN_POST, 'ios'), 283_750)
  assert.equal(nativeFlowTimeoutMs('maestro/story68/cancel.yaml', 'ios'), 120_000)
})

test('the Expo Go proof opener takes its derived budget on iOS, not the first-flow budget', () => {
  const expoGoOpen = 'maestro/story68/expo-go-open.yaml'
  assert.equal(nativeFlowTimeoutMs(expoGoOpen, 'ios'), flowTimeoutMs(expoGoOpen))
  assert.equal(nativeFlowTimeoutMs(expoGoOpen, 'ios'), 410_000)
  const harness = fs.readFileSync(
    fileURLToPath(new URL('../run-story68-native.mjs', import.meta.url)),
    'utf8'
  )
  const proof = harness.slice(harness.indexOf("} else if (command === 'expo-go-proof')"))
  assert.ok(proof.indexOf(`maestro('${expoGoOpen}')`) > -1)
  assert.ok(
    proof.indexOf(`maestro('${expoGoOpen}')`) <
      proof.indexOf("maestro('maestro/story68/expo-go-unavailable.yaml')")
  )
  assert.doesNotMatch(
    proof.slice(0, proof.indexOf("maestro('maestro/story68/expo-go-unavailable.yaml')")),
    /story65\/open-app\.yaml/
  )
})

test('the Expo Go proof builds the launch bundle before it opens the exp:// link', () => {
  const harness = fs.readFileSync(
    fileURLToPath(new URL('../run-story68-native.mjs', import.meta.url)),
    'utf8'
  )
  const open = harness.slice(harness.indexOf('function openUrl(url)'))
  assert.match(
    open.slice(0, open.indexOf("if (platform === 'ios')")),
    /url\.startsWith\(EXPO_GO_URL\)\) warmLaunchBundle\(\)/
  )
  const proof = harness.slice(harness.indexOf("} else if (command === 'expo-go-proof')"))
  assert.ok(proof.indexOf('openUrl(EXPO_GO_URL)') > -1)
  assert.match(harness, /const EXPO_GO_URL = 'exp:\/\/127\.0\.0\.1:8089'/)
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
    assert.equal(nativeFlowTimeoutMs(OPEN_APP_FLOW, platform), 240_000, platform)
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
