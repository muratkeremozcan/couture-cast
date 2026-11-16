// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 M lane: the runner's flow table against the flow files, the values each flow reads,
// and the checks that decide a flow passed.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  GOOGLE_NATIVE_CAPTURES,
  GOOGLE_NATIVE_FLOWS,
  GOOGLE_NATIVE_FLOW_DIR,
  GOOGLE_NATIVE_PORTS,
  birthdateYearsAgo,
  devClientUrl,
  expectationProblems,
  failingStep,
  flowBirthdate,
  flowEnv,
  googleNativeConsentPolicy,
  googleNativeReversePorts,
  harnessEmail,
  memberBirthdate,
  selectGoogleNativeFlows,
  standInIdentity,
} from './google-native-flows.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const flowDir = path.join(root, GOOGLE_NATIVE_FLOW_DIR)
const strings = {
  back: 'Back',
  cancelled: 'Google sign-in was cancelled.',
  underage: 'You must be 13 or older to use CoutureCast.',
  awaitingGuardian:
    'Your account is waiting for a guardian to approve it. Send the invite below, then sign in again once they approve.',
  email: 'Email',
  sendCode: 'Send sign-in code',
  codeSent: 'Check your email for the sign-in code.',
}

/** Every `${NAME}` a flow and the step files it runs read, minus the ones it declares itself. */
function variablesOf(file, seen = new Set()) {
  if (seen.has(file)) return new Set()
  seen.add(file)
  const text = fs.readFileSync(file, 'utf8')
  const declared = new Set(
    [...text.matchAll(/^ {2}([A-Z_]+):/gm)].map((match) => match[1])
  )
  const used = new Set(
    [...text.matchAll(/\$\{([A-Z_]+)\}/g)]
      .map((match) => match[1])
      .filter((name) => !declared.has(name))
  )
  for (const match of text.matchAll(/runFlow:\s*(\S+\.yaml)/g)) {
    const child = path.resolve(path.dirname(file), match[1])
    // maestro/story65/open-app.yaml is shared; it reads MAESTRO_BACK on iOS only.
    for (const name of variablesOf(child, seen)) used.add(name)
  }
  return used
}

describe('Google device flow table', () => {
  test('names every flow file under maestro/google-sign-in and nothing else', () => {
    const files = fs
      .readdirSync(flowDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
      .map((entry) => entry.name.replace(/\.yaml$/, ''))
      .sort()
    assert.deepEqual(files, GOOGLE_NATIVE_FLOWS.map((flow) => flow.name).sort())
  })

  test('gives every flow each value it reads', () => {
    for (const flow of GOOGLE_NATIVE_FLOWS) {
      const env = flowEnv(flow, {
        email: 'a@example.test',
        otpEmail: 'b@example.test',
        strings,
      })
      const missing = [...variablesOf(path.join(flowDir, `${flow.name}.yaml`))].filter(
        (name) => !(name in env)
      )
      assert.deepEqual(missing, [], `${flow.name} reads values the runner never passes`)
    }
  })

  test('gives every screen capture flow each value it reads', () => {
    for (const flow of GOOGLE_NATIVE_CAPTURES) {
      const env = {
        ...flowEnv(flow, { email: 'a@example.test', strings }),
        SCREEN_MODE: 'dark',
      }
      assert.ok(env.BIRTHDATE, `${flow.name} types a birthdate`)
      const missing = [...variablesOf(path.join(flowDir, `${flow.name}.yaml`))].filter(
        (name) => !(name in env)
      )
      assert.deepEqual(missing, [], `${flow.name} reads values the runner never passes`)
    }
  })

  test('runs the flows the --flows argument names, in table order', () => {
    const required = GOOGLE_NATIVE_FLOWS.filter(
      (flow) => flow.policy === 'required_13_15'
    )
    assert.equal(
      selectGoogleNativeFlows(undefined).length,
      GOOGLE_NATIVE_FLOWS.length - required.length
    )
    assert.deepEqual(
      selectGoogleNativeFlows('google-under13.yaml, google-new-account').map(
        (flow) => flow.name
      ),
      ['google-new-account', 'google-under13']
    )
    assert.throws(() => selectGoogleNativeFlows('google-unverified-refused'), /Unknown/)
  })

  // Guardian consent is off by default (owner ruling 2026-11-16); the waiting-teen flow runs only
  // in a lane started with GUARDIAN_CONSENT_POLICY=required_13_15.
  test('each lane runs only its own policy flows', () => {
    assert.equal(googleNativeConsentPolicy({}), 'off')
    assert.equal(
      googleNativeConsentPolicy({ GUARDIAN_CONSENT_POLICY: 'required_13_15' }),
      'required_13_15'
    )
    const off = selectGoogleNativeFlows(undefined, 'off').map((flow) => flow.name)
    assert.ok(off.includes('google-off-new-teen'))
    assert.ok(off.includes('google-off-pending-teen'))
    assert.ok(!off.includes('google-teen-resign'))
    assert.deepEqual(
      selectGoogleNativeFlows(undefined, 'required_13_15').map((flow) => flow.name),
      ['google-teen-resign']
    )
    assert.throws(
      () => selectGoogleNativeFlows('google-teen-resign', 'off'),
      /Not a off flow \(set GUARDIAN_CONSENT_POLICY to run it\): google-teen-resign/
    )
    assert.throws(
      () => selectGoogleNativeFlows('google-off-new-teen', 'required_13_15'),
      /Not a required_13_15 flow/
    )
  })

  test('the consent-off flows seed and expect the right teen', () => {
    const now = new Date('2026-11-15T12:00:00Z')
    const flow = (name) => GOOGLE_NATIVE_FLOWS.find((row) => row.name === name)
    assert.equal(flowBirthdate(flow('google-off-new-teen'), now), '2012-05-17')
    assert.equal(memberBirthdate(flow('google-off-pending-teen'), now), '2012-05-17')
    const base = {
      appUserIds: ['u1'],
      memberId: 'u1',
      authUser: { exists: true, providers: ['keycloak'] },
    }
    assert.deepEqual(
      expectationProblems(flow('google-off-new-teen'), {
        ...base,
        compliance: { accountStatus: 'active', guardianConsentRequired: false },
      }),
      []
    )
    assert.deepEqual(
      expectationProblems(flow('google-off-new-teen'), {
        ...base,
        compliance: {
          accountStatus: 'pending_guardian_consent',
          guardianConsentRequired: true,
        },
      }),
      ['the new teen account is not active']
    )
  })
})

describe('Google device flow values', () => {
  test('an under-13 birthdate is ten and a half years back, an adult one thirty', () => {
    const now = new Date('2026-11-15T12:00:00Z')
    assert.equal(birthdateYearsAgo(10, now), '2016-05-17')
    const under13 = flowEnv(
      GOOGLE_NATIVE_FLOWS.find((flow) => flow.name === 'google-under13'),
      { email: 'a@example.test', strings, now }
    )
    assert.equal(under13.BIRTHDATE, '2016-05-17')
    assert.equal(under13.UNDERAGE_TEXT, strings.underage)
    const adult = flowEnv(
      GOOGLE_NATIVE_FLOWS.find((flow) => flow.name === 'google-new-account'),
      { email: 'a@example.test', strings, now }
    )
    assert.equal(adult.BIRTHDATE, '1996-05-17')
  })

  test('only the cancel flow queues a deny identity and needs an email code address', () => {
    const cancel = GOOGLE_NATIVE_FLOWS.find(
      (flow) => flow.name === 'google-cancel-chooser'
    )
    assert.equal(standInIdentity(cancel, 'a@example.test', () => 'u').deny, true)
    assert.throws(
      () => flowEnv(cancel, { email: 'a@example.test', strings }),
      /email code/
    )
    for (const flow of GOOGLE_NATIVE_FLOWS.filter((row) => row !== cancel))
      assert.equal('deny' in standInIdentity(flow, 'a@example.test', () => 'u'), false)
  })

  test('addresses match the shape cleanup accepts', () => {
    assert.match(
      harnessEmail(),
      /^story65-real-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@example\.test$/
    )
  })

  test('the dev client link loads this run Metro with the onboarding finished', () => {
    assert.equal(
      devClientUrl(8091),
      'exp+couture-cast://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8091&disableOnboarding=1'
    )
  })

  test('the device reaches the API, Metro, Supabase and the mock', () => {
    assert.deepEqual(googleNativeReversePorts('http://127.0.0.1:54321', 53052), [
      GOOGLE_NATIVE_PORTS.api,
      GOOGLE_NATIVE_PORTS.metro,
      54321,
      53052,
    ])
  })
})

describe('Google device flow checks', () => {
  const flow = (name) => GOOGLE_NATIVE_FLOWS.find((row) => row.name === name)
  const keycloakUser = { exists: true, providers: ['keycloak'] }

  test('a new account needs one app user and a keycloak Auth user', () => {
    assert.deepEqual(
      expectationProblems(flow('google-new-account'), {
        appUserIds: ['u1'],
        authUser: keycloakUser,
      }),
      []
    )
    assert.equal(
      expectationProblems(flow('google-new-account'), {
        appUserIds: [],
        authUser: { exists: true, providers: ['email'] },
      }).length,
      2
    )
  })

  test('the teen flow seeds a 14-year-old and passes the guardian copy', () => {
    const teen = flow('google-teen-resign')
    const now = new Date('2026-11-15T12:00:00Z')
    assert.equal(memberBirthdate(teen, now), '2012-05-17')
    assert.equal(memberBirthdate(flow('google-existing-member'), now), '1990-06-15')
    assert.equal(memberBirthdate(flow('google-new-account'), now), undefined)
    const env = flowEnv(teen, { email: 'a@example.test', strings })
    assert.equal(env.AWAITING_TEXT, strings.awaitingGuardian)
    assert.equal(env.BIRTHDATE, undefined)
  })

  test('the teen flow fails once the account stops waiting on consent', () => {
    const observed = {
      appUserIds: ['u1'],
      memberId: 'u1',
      authUser: keycloakUser,
    }
    assert.deepEqual(
      expectationProblems(flow('google-teen-resign'), {
        ...observed,
        compliance: {
          accountStatus: 'pending_guardian_consent',
          guardianConsentRequired: true,
        },
      }),
      []
    )
    for (const compliance of [
      null,
      { accountStatus: 'active', guardianConsentRequired: false },
      { accountStatus: 'pending_guardian_consent', guardianConsentRequired: false },
    ])
      assert.deepEqual(
        expectationProblems(flow('google-teen-resign'), { ...observed, compliance }),
        ['the teen account no longer waits on guardian consent']
      )
  })

  test('an existing member must stay the account made before the flow', () => {
    assert.match(
      expectationProblems(flow('google-existing-member'), {
        appUserIds: ['other'],
        memberId: 'u1',
        authUser: keycloakUser,
      }).join(),
      /not the account created/
    )
  })

  test('a refusal or cancel must leave no Auth user and no app user', () => {
    for (const name of [
      'google-under13',
      'google-finish-relaunch',
      'google-signup-door-cancel',
      'google-cancel-chooser',
    ])
      assert.deepEqual(
        expectationProblems(flow(name), {
          appUserIds: ['u1'],
          authUser: keycloakUser,
        }),
        [
          'the address has 1 app user(s), expected 0',
          'local Auth still holds a user for the address',
        ]
      )
  })

  test('the conversion needs the proposal in the comfort row', () => {
    const observed = (comfort) => ({
      appUserIds: ['u1'],
      authUser: keycloakUser,
      comfort,
    })
    assert.deepEqual(
      expectationProblems(
        flow('google-preview-conversion'),
        observed({
          runs_cold_warm: 'cold',
          wind_tolerance: 'low',
          precip_preparedness: 'high',
        })
      ),
      []
    )
    assert.deepEqual(
      expectationProblems(
        flow('google-preview-conversion'),
        observed({
          runs_cold_warm: 'neutral',
          wind_tolerance: 'low',
          precip_preparedness: 'high',
        })
      ),
      ['comfort runs_cold_warm is neutral, expected cold']
    )
    assert.match(
      expectationProblems(flow('google-preview-conversion'), observed(null)).join(),
      /no comfort preferences row/
    )
  })

  test('the failing step is the last failure line Maestro printed', () => {
    assert.equal(
      failingStep(
        'Launch app... COMPLETED\nAssert that id: finish-signup-birthdate is visible... FAILED\nDone'
      ),
      'Assert that id: finish-signup-birthdate is visible... FAILED'
    )
    assert.equal(failingStep('all COMPLETED'), undefined)
  })
})
