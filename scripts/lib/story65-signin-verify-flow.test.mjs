import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const flow = fs.readFileSync(
  new URL('../../maestro/story65/signin-verify.yaml', import.meta.url),
  'utf8'
)
const app = fs.readFileSync(
  new URL('../../apps/mobile/app/signin.tsx', import.meta.url),
  'utf8'
)

test('iOS taps the sign-in code field by its testID after it is on screen', () => {
  const ios = flow.slice(flow.indexOf('platform: iOS'), flow.indexOf('platform: Android'))
  assert.match(ios, /extendedWaitUntil:\s+visible:\s+id: 'signin-code-input'/)
  assert.match(ios, /tapOn:\s+id: 'signin-code-input'/)
  assert.doesNotMatch(ios, /index:/)
})

test('Android keeps the label match and no step types before the field is tapped', () => {
  const android = flow.slice(flow.indexOf('platform: Android'), flow.indexOf('inputText'))
  assert.match(android, /text: \$\{MAESTRO_CODE_LABEL\}\s+index: 1/)
  assert.ok(flow.indexOf('inputText') > flow.indexOf('waitForAnimationToEnd'))
})

test('the field carries the testID the flow and the failure projection read', () => {
  assert.match(app, /testID="signin-code-input"/)
})

test('the sign-in trace records lengths and outcome classes, never the code', () => {
  assert.match(app, /traceShareCardOpener\('signin-code-change', next\.length\)/)
  assert.match(app, /traceShareCardOpener\('signin-verify-press', code\.length\)/)
  assert.doesNotMatch(app, /traceShareCardOpener\([^)]*(code|next)[,)]/)
})

test('the settings load after sign-in traces only closed outcome names', () => {
  const settings = fs.readFileSync(
    new URL('../../apps/mobile/app/notification-settings.tsx', import.meta.url),
    'utf8'
  )
  const calls = [...settings.matchAll(/traceShareCardOpener\(([^)]*)\)/g)].map(
    (m) => m[1]
  )
  assert.ok(calls.length >= 4)
  for (const call of calls)
    assert.match(call, /^'prefs-[a-z-]+'$|^token \? 'prefs-stale' : 'prefs-token-null'$/)
})

test('the settings wait ends at the controls or at the Try again id, with no clock deciding', () => {
  const wait = fs.readFileSync(
    new URL('../../maestro/story65/wait-notification-settings.yaml', import.meta.url),
    'utf8'
  )
  assert.match(wait, /while:\s+notVisible: \$\{MAESTRO_ENABLED\}/)
  assert.match(
    wait,
    /id: 'notification-settings-retry'[\s\S]*assertVisible: \$\{MAESTRO_ENABLED\}/
  )
  assert.match(wait, /^- assertVisible: \$\{MAESTRO_ENABLED\}$/m)
  for (const flow of [
    'signin-verify',
    'notification-settings-loaded',
    'session-restore',
  ]) {
    const text = fs.readFileSync(
      new URL(`../../maestro/story65/${flow}.yaml`, import.meta.url),
      'utf8'
    )
    assert.match(text, /runFlow: wait-notification-settings\.yaml/, flow)
    assert.doesNotMatch(text, /visible: \$\{MAESTRO_ENABLED\}\s+timeout: 30000/, flow)
  }
  const screen = fs.readFileSync(
    new URL('../../apps/mobile/app/notification-settings.tsx', import.meta.url),
    'utf8'
  )
  assert.match(screen, /testID="notification-settings-retry"/)
})
