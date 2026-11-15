import path from 'node:path'
import { createRequire } from 'node:module'

/**
 * Story 6.16 (TEA-8): the two auth modes a Maestro run can take.
 *
 * `member`, the default, bakes a fixture member's token into the Metro bundle
 * (`EXPO_PUBLIC_E2E_ACCESS_TOKEN`, or `EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE`
 * on a sharded run). In `__DEV__`, `apps/mobile/src/lib/mobile-auth.ts` returns
 * that token before it asks the native session, so a member bundle can never be
 * signed out and a sign-out step inside a flow proves nothing.
 *
 * `signed-out` starts Metro with both token keys removed and
 * `EXPO_PUBLIC_E2E_AUTH_MODE=real`, so the app resolves only its real native
 * session, and runs only the guest preview flows, each from a cleared device.
 * A guest flow never runs in a member bundle and a member flow never runs in a
 * signed-out one: either misroute throws before any setup.
 */
export const MAESTRO_AUTH_MODES = ['member', 'signed-out']

/** The run-maestro.mjs flag that selects the signed-out mode. */
export const SIGNED_OUT_FLAG = '--signed-out'

/** The Metro env keys that carry a baked member token. */
export const E2E_TOKEN_ENV_KEYS = [
  'EXPO_PUBLIC_E2E_ACCESS_TOKEN',
  'EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE',
]

/** Root `maestro/` flows whose name starts `guest-preview` run signed out. */
export const GUEST_PREVIEW_FLOW = /^guest-preview[^/]*\.ya?ml$/

export const isGuestPreviewFlow = (flow) => GUEST_PREVIEW_FLOW.test(path.basename(flow))

/** @param {string[]} args the run's CLI arguments */
export const resolveMaestroAuthMode = (args) =>
  args.includes(SIGNED_OUT_FLAG) ? 'signed-out' : 'member'

/** @param {string} mode */
export const assertMaestroAuthMode = (mode) => {
  if (!MAESTRO_AUTH_MODES.includes(mode))
    throw new Error(
      `Unknown Maestro auth mode '${mode}'. Use one of: ${MAESTRO_AUTH_MODES.join(', ')}.`
    )
}

/**
 * The flows of `flows` that belong to `mode`, order kept.
 *
 * @param {string[]} flows paths or bare names
 * @param {'member' | 'signed-out'} mode
 */
export const flowsForAuthMode = (flows, mode) => {
  assertMaestroAuthMode(mode)
  return flows.filter((flow) => isGuestPreviewFlow(flow) === (mode === 'signed-out'))
}

/**
 * The flows this run executes: the requested ones, held to the mode, or the
 * discovered ones of that mode.
 *
 * @param {{ mode: 'member' | 'signed-out', requested: string[], discovered: string[] }} options
 * @returns {string[]}
 */
export const selectMaestroFlows = ({ mode, requested, discovered }) => {
  assertMaestroAuthMode(mode)
  if (requested.length === 0) {
    const flows = flowsForAuthMode(discovered, mode)
    if (mode === 'signed-out' && flows.length === 0)
      throw new Error(
        'Signed-out mode found no maestro/guest-preview*.yaml flow to run. A signed-out run with nothing to run is a broken pipeline.'
      )
    return flows
  }
  const misrouted = requested.filter((flow) => !flowsForAuthMode([flow], mode).length)
  if (misrouted.length > 0)
    throw new Error(
      mode === 'signed-out'
        ? `Signed-out mode runs only maestro/guest-preview*.yaml flows; these need the member bundle: ${misrouted.join(', ')}.`
        : `Guest preview flows run only in signed-out mode (${SIGNED_OUT_FLAG}), never in a member bundle: ${misrouted.join(', ')}.`
    )
  return [...requested]
}

/**
 * The env Metro starts with. A member run passes the env through; a signed-out
 * run drops both token keys and forces the app's real auth path.
 *
 * @param {'member' | 'signed-out'} mode
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export const metroEnvForAuthMode = (mode, env) => {
  assertMaestroAuthMode(mode)
  if (mode === 'member') return { ...env }
  const metroEnv = { ...env }
  for (const key of E2E_TOKEN_ENV_KEYS) delete metroEnv[key]
  metroEnv.EXPO_PUBLIC_E2E_AUTH_MODE = 'real'
  return metroEnv
}

/**
 * A signed-out run drives Android only. Maestro's `clearState` empties the app's
 * data on Android, where SecureStore lives, but the iOS keychain survives both
 * `clearState` and a reinstall, so an iOS launch can still find an earlier
 * session and is not a first launch. It drives one device: the conversion leg runs its
 * second step on the device that ran the first, which a sharded run does not keep.
 *
 * @param {'member' | 'signed-out'} mode
 * @param {string | undefined} platform
 * @param {boolean} [parallel] whether the run shards across several devices
 */
export const assertAuthModePlatform = (mode, platform, parallel = false) => {
  if (mode !== 'signed-out') return
  if (platform !== 'android')
    throw new Error(
      `Signed-out mode runs on Android only (got '${platform}'): the iOS keychain survives clearState, so the launch would not be a first launch.`
    )
  if (parallel)
    throw new Error(
      'Signed-out mode drives one device. Run it serially (npm run test:mobile:e2e:android:serial -- --signed-out).'
    )
}

/**
 * Why a guest flow would not start from a first launch, or undefined when it
 * does. Its first command has to be `launchApp` with `clearState: true`, so the
 * app opens with no session, no stored guest state and no onboarding marks.
 *
 * @param {string} source the flow's YAML
 * @returns {string | undefined}
 */
export const firstLaunchProblem = (source) => {
  // Loaded on use, so the shard resolver, which imports this module before any
  // install, needs no package.
  const { parseAllDocuments } = createRequire(import.meta.url)('yaml')
  const documents = parseAllDocuments(source)
  const broken = documents.find((document) => document.errors?.length > 0)
  if (broken) return `the flow is not valid YAML (${broken.errors[0].message})`
  const commands = documents.at(-1)?.toJS()
  if (!Array.isArray(commands) || commands.length === 0) return 'the flow has no commands'
  const [first] = commands
  // A bare `- launchApp` launches with Maestro's defaults, which keep state.
  const launch =
    first === 'launchApp'
      ? null
      : first && typeof first === 'object' && 'launchApp' in first
        ? first.launchApp
        : undefined
  if (launch === undefined) return 'its first command is not launchApp'
  if (!launch || typeof launch !== 'object' || launch.clearState !== true)
    return 'its first launchApp does not set clearState: true'
  return undefined
}

/**
 * Throws unless every flow starts from a first launch.
 *
 * @param {string[]} flows
 * @param {(flow: string) => string} readFlow
 */
export const assertFirstLaunchFlows = (flows, readFlow) => {
  const problems = flows
    .map((flow) => [flow, firstLaunchProblem(readFlow(flow))])
    .filter(([, problem]) => problem)
  if (problems.length > 0)
    throw new Error(
      `Signed-out flows must start with launchApp and clearState: true:\n  ${problems
        .map(([flow, problem]) => `${flow}: ${problem}`)
        .join('\n  ')}`
    )
}
