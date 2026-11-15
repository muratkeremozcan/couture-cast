// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 (TEA-8): the signed-out Maestro mode. Running run-maestro.mjs rebuilds shared
// packages at import, so its wiring is read from source; the helpers carry the behavior.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  E2E_TOKEN_ENV_KEYS,
  SIGNED_OUT_FLAG,
  assertAuthModePlatform,
  assertFirstLaunchFlows,
  firstLaunchProblem,
  flowsForAuthMode,
  isGuestPreviewFlow,
  metroEnvForAuthMode,
  resolveMaestroAuthMode,
  selectMaestroFlows,
} from './maestro-auth-mode.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const runner = fs.readFileSync(path.join(root, 'scripts/run-maestro.mjs'), 'utf8')

const discovered = [
  'maestro/analytics.yaml',
  'maestro/guest-preview.yaml',
  'maestro/guest-preview-conversion.yaml',
  'maestro/sanity.yaml',
]
const memberEnv = {
  PATH: '/usr/bin',
  EXPO_PUBLIC_API_BASE_URL: 'http://10.0.2.2:4000',
  EXPO_PUBLIC_E2E_ACCESS_TOKEN: 'member-token',
  EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE: '{"couture-e2e-1":"member-token"}',
  EXPO_PUBLIC_E2E_AUTH_MODE: 'fixture',
}
const firstLaunch = `appId: \${MAESTRO_APP_ID}
name: 'Guest preview'
---
- launchApp:
    appId: \${MAESTRO_APP_ID}
    clearState: true
- runFlow: subflows/open-app.yaml
`

describe('signed-out Metro env', () => {
  test('carries neither token key and forces EXPO_PUBLIC_E2E_AUTH_MODE=real', () => {
    const env = metroEnvForAuthMode('signed-out', memberEnv)
    assert.deepEqual(E2E_TOKEN_ENV_KEYS, [
      'EXPO_PUBLIC_E2E_ACCESS_TOKEN',
      'EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE',
    ])
    for (const key of E2E_TOKEN_ENV_KEYS) assert.equal(key in env, false, key)
    assert.equal(env.EXPO_PUBLIC_E2E_AUTH_MODE, 'real')
    assert.equal(env.EXPO_PUBLIC_API_BASE_URL, 'http://10.0.2.2:4000')
    assert.equal(env.PATH, '/usr/bin')
    // The caller's env is left as it was.
    assert.equal(memberEnv.EXPO_PUBLIC_E2E_ACCESS_TOKEN, 'member-token')
  })

  test('member mode passes the env through with its token', () => {
    assert.deepEqual(metroEnvForAuthMode('member', memberEnv), memberEnv)
    assert.notEqual(metroEnvForAuthMode('member', memberEnv), memberEnv)
  })

  test('an unknown mode throws', () => {
    assert.throws(
      () => metroEnvForAuthMode('guest', memberEnv),
      /Unknown Maestro auth mode/
    )
  })
})

describe('flow selection', () => {
  test('guest preview flows are the root guest-preview*.yaml files, in any path form', () => {
    for (const flow of [
      'maestro/guest-preview.yaml',
      'maestro/guest-preview-conversion.yml',
      './maestro/guest-preview-x.yaml',
      'guest-preview.yaml',
    ])
      assert.equal(isGuestPreviewFlow(flow), true, flow)
    for (const flow of [
      'maestro/sanity.yaml',
      'maestro/my-guest-preview.yaml',
      'maestro/guest-preview.yaml.bak',
    ])
      assert.equal(isGuestPreviewFlow(flow), false, flow)
  })

  test('signed-out discovery selects only the guest preview flows', () => {
    assert.deepEqual(
      selectMaestroFlows({ mode: 'signed-out', requested: [], discovered }),
      ['maestro/guest-preview.yaml', 'maestro/guest-preview-conversion.yaml']
    )
  })

  test('member discovery excludes every guest preview flow', () => {
    assert.deepEqual(selectMaestroFlows({ mode: 'member', requested: [], discovered }), [
      'maestro/analytics.yaml',
      'maestro/sanity.yaml',
    ])
    assert.deepEqual(flowsForAuthMode(discovered, 'member'), [
      'maestro/analytics.yaml',
      'maestro/sanity.yaml',
    ])
  })

  test('a requested member flow in signed-out mode throws and names it', () => {
    assert.throws(
      () =>
        selectMaestroFlows({
          mode: 'signed-out',
          requested: ['maestro/guest-preview.yaml', 'maestro/sanity.yaml'],
          discovered,
        }),
      /Signed-out mode runs only maestro\/guest-preview\*\.yaml flows; these need the member bundle: maestro\/sanity\.yaml\./
    )
  })

  test('a requested guest flow in member mode throws and names it', () => {
    assert.throws(
      () =>
        selectMaestroFlows({
          mode: 'member',
          requested: ['maestro/sanity.yaml', 'maestro/guest-preview.yaml'],
          discovered,
        }),
      /Guest preview flows run only in signed-out mode \(--signed-out\), never in a member bundle: maestro\/guest-preview\.yaml\./
    )
  })

  test('requested flows of the right mode run as requested', () => {
    assert.deepEqual(
      selectMaestroFlows({
        mode: 'signed-out',
        requested: ['maestro/guest-preview-conversion.yaml'],
        discovered,
      }),
      ['maestro/guest-preview-conversion.yaml']
    )
    assert.deepEqual(
      selectMaestroFlows({
        mode: 'member',
        requested: ['maestro/sanity.yaml'],
        discovered,
      }),
      ['maestro/sanity.yaml']
    )
  })

  test('signed-out discovery with no guest flow throws', () => {
    assert.throws(
      () =>
        selectMaestroFlows({
          mode: 'signed-out',
          requested: [],
          discovered: ['maestro/sanity.yaml'],
        }),
      /Signed-out mode found no maestro\/guest-preview\*\.yaml flow to run/
    )
  })

  test('the mode comes from the --signed-out flag and defaults to member', () => {
    assert.equal(SIGNED_OUT_FLAG, '--signed-out')
    assert.equal(
      resolveMaestroAuthMode(['maestro/guest-preview.yaml', '--signed-out']),
      'signed-out'
    )
    assert.equal(resolveMaestroAuthMode(['maestro/sanity.yaml', '--ci']), 'member')
    assert.equal(resolveMaestroAuthMode([]), 'member')
  })
})

describe('first launch', () => {
  test('a flow that opens with launchApp and clearState: true passes', () => {
    assert.equal(firstLaunchProblem(firstLaunch), undefined)
    assert.doesNotThrow(() =>
      assertFirstLaunchFlows(['maestro/guest-preview.yaml'], () => firstLaunch)
    )
  })

  test('a flow without clearState: true on its first launchApp is named', () => {
    const kept = firstLaunch.replace('clearState: true', 'clearState: false')
    assert.equal(
      firstLaunchProblem(kept),
      'its first launchApp does not set clearState: true'
    )
    const bare = firstLaunch.replace(/- launchApp:\n.*\n.*\n/, '- launchApp\n')
    assert.equal(
      firstLaunchProblem(bare),
      'its first launchApp does not set clearState: true'
    )
    const later = firstLaunch.replace(
      '- launchApp:',
      '- runFlow: subflows/open-app.yaml\n- launchApp:'
    )
    assert.equal(firstLaunchProblem(later), 'its first command is not launchApp')
    assert.equal(firstLaunchProblem('appId: x\n---\n'), 'the flow has no commands')
    assert.match(firstLaunchProblem('- launchApp: [\n'), /^the flow is not valid YAML/)
  })

  test('assertFirstLaunchFlows lists every offending flow', () => {
    const sources = {
      'maestro/guest-preview.yaml': firstLaunch,
      'maestro/guest-preview-a.yaml': firstLaunch.replace(
        'clearState: true',
        'clearState: false'
      ),
      'maestro/guest-preview-b.yaml': '- tapOn: x\n',
    }
    assert.throws(
      () => assertFirstLaunchFlows(Object.keys(sources), (flow) => sources[flow]),
      (error) =>
        /maestro\/guest-preview-a\.yaml: its first launchApp does not set clearState: true/.test(
          error.message
        ) &&
        /maestro\/guest-preview-b\.yaml: its first command is not launchApp/.test(
          error.message
        ) &&
        !/maestro\/guest-preview\.yaml:/.test(error.message)
    )
  })

  test('signed-out mode runs on one Android device; member mode on either platform', () => {
    assert.doesNotThrow(() => assertAuthModePlatform('signed-out', 'android'))
    assert.throws(
      () => assertAuthModePlatform('signed-out', 'ios'),
      /Android only \(got 'ios'\)/
    )
    assert.throws(
      () => assertAuthModePlatform('signed-out', 'android', true),
      /Signed-out mode drives one device/
    )
    assert.doesNotThrow(() => assertAuthModePlatform('member', 'ios', true))
  })
})

describe('run-maestro.mjs wiring', () => {
  const at = (needle) => {
    const index = runner.indexOf(needle)
    assert.notEqual(index, -1, needle)
    return index
  }

  test('the mode comes from the CLI and selects the flows before any setup', () => {
    at('const AUTH_MODE = resolveMaestroAuthMode(cliArgs)')
    assert.match(
      runner,
      /const flowsToRun = selectMaestroFlows\(\{\n {2}mode: AUTH_MODE,\n {2}requested: FLOW_PATHS,\n {2}discovered: discoverFlows\(\),\n\}\)/
    )
    const firstLaunchGuard = at('if (SIGNED_OUT)\n  assertFirstLaunchFlows(flowsToRun,')
    assert.ok(firstLaunchGuard > at('const flowsToRun ='))
    assert.ok(firstLaunchGuard < at('const run = async () => {'))
  })

  test('Metro starts with the mode env and --clear, and a signed-out run never reuses one', () => {
    assert.match(
      runner,
      /spawn\('npm', \['run', 'start:mobile:server'\], \{[^}]*env: metroEnvForAuthMode\(AUTH_MODE, \{/
    )
    const server = fs.readFileSync(
      path.join(root, 'scripts/start-mobile-server.sh'),
      'utf8'
    )
    assert.match(server, /^ARGS=\(--clear /m)
    const reuse = runner.slice(at('const resolveExpoServerReuse = async'))
    assert.ok(
      reuse.indexOf('if (SIGNED_OUT) {') < reuse.indexOf('findRunningExpoServer(')
    )
    assert.match(
      runner,
      /buildPortPairs\(target\.platform, metroPort\)\.filter\(\n\s+\(pair\) => !SIGNED_OUT \|\| pair\.health === `http:\/\/127\.0\.0\.1:\$\{metroPort\}`/
    )
  })

  test('a signed-out run creates no fixture member and bakes no token', () => {
    const run = runner.slice(at('const run = async () => {'))
    assert.match(
      run,
      /mobileIdentity = await provisionMobileFixture\(\n\s+apiSetupBaseUrl,\n\s+mobileApiBaseUrl,\n\s+mobileIdentities\n\s+\)/
    )
    assert.equal(run.includes('createMobileIdentities('), false)
    assert.equal(run.includes('applyMobileFixtureEnv('), false)
    const provision = runner.slice(at('const provisionMobileFixture = async ('))
    const signedOut = provision.slice(
      provision.indexOf('if (SIGNED_OUT) {'),
      provision.indexOf('return undefined')
    )
    assert.ok(signedOut.length > 0)
    assert.ok(
      provision.indexOf('return undefined') < provision.indexOf('createMobileIdentities(')
    )
    assert.equal(signedOut.includes('EXPO_PUBLIC_E2E_ACCESS_TOKEN'), false)
    assert.match(signedOut, /process\.env\.EXPO_PUBLIC_API_BASE_URL = mobileApiBaseUrl/)
    assert.ok(
      run.indexOf(
        'assertAuthModePlatform(AUTH_MODE, target.platform, PARALLEL_DEVICES)'
      ) > 0
    )
  })
})
