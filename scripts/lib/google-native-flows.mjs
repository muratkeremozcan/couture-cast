// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
//
// Story 6.17 M lane: what each Google sign-in device flow (maestro/google-sign-in/) needs from
// its runner (scripts/run-google-native.mjs) and what the runner proves after it. Pure, so
// scripts/lib/google-native-flows.test.mjs holds the table to the flow files without a device.
//
// Not a flow: google-unverified-refused. GoTrue refuses an unverified provider address only
// with autoconfirm off (spike S0); local Supabase runs `enable_confirmations = false`, so there
// it confirms the address and signs the identity in. The refusal copy is proved by
// U-CALLBACK-ROUTES and the native-session unit tests (TEA-11), and hosted autoconfirm is pinned
// off by H-SETTINGS.
import { randomUUID } from 'node:crypto'

export const GOOGLE_NATIVE_APP_ID = 'com.couturecast.story65'
export const GOOGLE_NATIVE_FLOW_DIR = 'maestro/google-sign-in'

/**
 * Off the web lane's 4077/4087/3077, story 6.8's 4088/8089 and a developer's 4000/8081, so this
 * lane can run beside any of them.
 */
export const GOOGLE_NATIVE_PORTS = Object.freeze({
  api: 4079,
  weatherDouble: 4089,
  opsCapture: 4329,
  metro: 8091,
  /** Only keys the API launcher's stack record; nothing serves it. */
  web: 3079,
})

/** What `maestro/google-sign-in/google-preview-conversion.yaml` proposes. */
export const GOOGLE_PREVIEW_PROPOSAL = Object.freeze({
  runs_cold_warm: 'cold',
  wind_tolerance: 'low',
  precip_preparedness: 'high',
})

/**
 * Each flow and its plan:
 * - `deny`: the queued identity answers `error=access_denied`, a closed chooser.
 * - `member`: the runner creates the app account for the address first.
 * - `birthdate`: `adult` or `under13`, typed on the finish step.
 * - `otpEmail`: a second recorded address the flow requests an email code for.
 * - `expect`: what the run proves afterwards. `appUsers` is the address's app user count in
 *   the isolated database, `authUser` whether local Auth still holds a user for it, `keycloak`
 *   that user's stand-in identity, `comfort` the saved preview proposal.
 */
export const GOOGLE_NATIVE_FLOWS = Object.freeze([
  {
    name: 'google-new-account',
    birthdate: 'adult',
    expect: { appUsers: 1, authUser: true, keycloak: true },
  },
  {
    name: 'google-existing-member',
    member: true,
    expect: { appUsers: 1, sameAppUser: true, authUser: true, keycloak: true },
  },
  {
    name: 'google-cancel-chooser',
    deny: true,
    otpEmail: true,
    expect: { appUsers: 0, authUser: false },
  },
  {
    name: 'google-finish-relaunch',
    expect: { appUsers: 0, authUser: false },
  },
  {
    name: 'google-finish-android-back',
    expect: { appUsers: 0, authUser: false },
  },
  {
    name: 'google-signup-door-cancel',
    expect: { appUsers: 0, authUser: false },
  },
  {
    name: 'google-under13',
    birthdate: 'under13',
    expect: { appUsers: 0, authUser: false },
  },
  {
    name: 'google-preview-conversion',
    birthdate: 'adult',
    expect: { appUsers: 1, authUser: true, keycloak: true, comfort: true },
  },
])

/**
 * `--screens <dir>`: flows under maestro/google-sign-in/screens/ that capture the signup door,
 * the finish step form, the under-13 outcome and a teen's guardian step, in light and dark mode.
 * Their addresses are recorded and cleaned up like the flows'; they prove nothing about state.
 */
export const GOOGLE_NATIVE_SCREEN_MODES = Object.freeze(['light', 'dark'])
export const GOOGLE_NATIVE_CAPTURES = Object.freeze([
  { name: 'screens/capture-under13', birthdate: 'under13' },
  { name: 'screens/capture-teen', birthdate: 'teen' },
])

/** The flows a `--flows a,b` argument names, in table order; every name must exist. */
export function selectGoogleNativeFlows(argument) {
  if (!argument) return [...GOOGLE_NATIVE_FLOWS]
  const wanted = argument
    .split(',')
    .map((name) => name.trim().replace(/\.ya?ml$/, ''))
    .filter(Boolean)
  const unknown = wanted.filter(
    (name) => !GOOGLE_NATIVE_FLOWS.some((flow) => flow.name === name)
  )
  if (unknown.length) throw new Error(`Unknown Google device flow: ${unknown.join(', ')}`)
  return GOOGLE_NATIVE_FLOWS.filter((flow) => wanted.includes(flow.name))
}

/**
 * A birthdate `age` years and half a year before `now`, so the age holds whatever the date (the
 * web lane's rule, playwright/tests/google-sign-in-real-session.spec.ts).
 */
export function birthdateYearsAgo(age, now = new Date()) {
  const birthday = Date.UTC(
    now.getUTCFullYear() - age,
    now.getUTCMonth(),
    now.getUTCDate()
  )
  return new Date(birthday - 182 * 86_400_000).toISOString().slice(0, 10)
}

export function flowBirthdate(flow, now = new Date()) {
  if (flow.birthdate === 'under13') return birthdateYearsAgo(10, now)
  if (flow.birthdate === 'teen') return birthdateYearsAgo(14, now)
  if (flow.birthdate === 'adult') return birthdateYearsAgo(30, now)
  return undefined
}

/** The harness address shape cleanup accepts (scripts/e2e-real-session/harness.mjs). */
export const harnessEmail = (uuid = randomUUID) => `story65-real-${uuid()}@example.test`

/** The stand-in identity the mock answers the flow's authorize with. */
export function standInIdentity(flow, email, uuid = randomUUID) {
  return {
    sub: `stand-in-${uuid()}`,
    email,
    email_verified: true,
    name: 'Stand In',
    ...(flow.deny ? { deny: true } : {}),
  }
}

/**
 * The development client link that loads this run's Metro. `disableOnboarding=1` finishes the
 * dev menu onboarding for the launch, as the network-timeout lane does.
 */
export function devClientUrl(metroPort = GOOGLE_NATIVE_PORTS.metro) {
  const metro = encodeURIComponent(`http://127.0.0.1:${metroPort}`)
  return `exp+couture-cast://expo-development-client/?url=${metro}&disableOnboarding=1`
}

/**
 * The loopback ports the device must reach through `adb reverse`: the API, Metro, local
 * Supabase (the app's Auth client and GoTrue's own callback, both at `supabaseUrl`) and the
 * mock OIDC provider GoTrue sends the browser to.
 */
export function googleNativeReversePorts(supabaseUrl, mockOidcPort) {
  const supabase = new URL(supabaseUrl)
  const supabasePort = Number(
    supabase.port || (supabase.protocol === 'https:' ? 443 : 80)
  )
  return [
    ...new Set([
      GOOGLE_NATIVE_PORTS.api,
      GOOGLE_NATIVE_PORTS.metro,
      supabasePort,
      mockOidcPort,
    ]),
  ]
}

/**
 * The `-e` values a flow reads. `strings` holds the en-US copy the flows assert on, from the
 * app's own catalogs.
 */
export function flowEnv(flow, { email, otpEmail, strings, now = new Date() }) {
  const env = {
    MAESTRO_APP_ID: GOOGLE_NATIVE_APP_ID,
    // maestro/story65/open-app.yaml reads it in its iOS branch only.
    MAESTRO_BACK: strings.back,
    GOOGLE_EMAIL: email,
  }
  const birthdate = flowBirthdate(flow, now)
  if (birthdate) env.BIRTHDATE = birthdate
  if (flow.birthdate === 'under13') env.UNDERAGE_TEXT = strings.underage
  if (flow.deny) env.CANCELLED_TEXT = strings.cancelled
  if (flow.otpEmail) {
    if (!otpEmail) throw new Error(`${flow.name} needs an email code address`)
    Object.assign(env, {
      OTP_EMAIL: otpEmail,
      EMAIL_LABEL: strings.email,
      SEND_CODE: strings.sendCode,
      CODE_SENT: strings.codeSent,
    })
  }
  return env
}

/**
 * Why the observed state breaks the flow's expectations; an empty list means it holds.
 *
 * @param {{ expect: Record<string, unknown> }} flow
 * @param {{
 *   appUserIds: string[]
 *   memberId?: string
 *   authUser: { exists: boolean; providers: string[] }
 *   comfort?: Record<string, unknown> | null
 * }} observed
 */
export function expectationProblems(flow, observed) {
  const { expect } = flow
  const problems = []
  if (observed.appUserIds.length !== expect.appUsers)
    problems.push(
      `the address has ${observed.appUserIds.length} app user(s), expected ${expect.appUsers}`
    )
  if (expect.sameAppUser && observed.appUserIds[0] !== observed.memberId)
    problems.push('the signed-in app user is not the account created before the flow')
  if (observed.authUser.exists !== expect.authUser)
    problems.push(
      expect.authUser
        ? 'local Auth holds no user for the address'
        : 'local Auth still holds a user for the address'
    )
  if (expect.keycloak && !observed.authUser.providers.includes('keycloak'))
    problems.push('the Auth user carries no stand-in (keycloak) identity')
  if (expect.comfort) {
    const row = observed.comfort
    if (!row) problems.push('no comfort preferences row exists for the converted account')
    else
      for (const [column, value] of Object.entries(GOOGLE_PREVIEW_PROPOSAL))
        if (row[column] !== value)
          problems.push(`comfort ${column} is ${String(row[column])}, expected ${value}`)
  }
  return problems
}

/**
 * The line of Maestro output that names the failing step, or undefined. Maestro prints each
 * command with a status mark and closes a failed flow with the reason.
 */
export function failingStep(output) {
  const lines = output.split('\n').map((line) => line.trim())
  const failed = lines.filter((line) =>
    /(FAILED|Assertion is false|Element not found|is not visible|Timed out|Unable to)/i.test(
      line
    )
  )
  return failed.at(-1) || undefined
}
