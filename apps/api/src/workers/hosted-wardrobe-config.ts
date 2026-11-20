import {
  WARDROBE_MAINTENANCE_ENV,
  wardrobeMaintenanceEnabled,
} from './wardrobe-maintenance'

/**
 * What the hosted wardrobe worker (the second Northflank service, started by
 * `scripts/start-wardrobe-worker-production.mjs`) may run with. One definition: the launcher
 * refuses to start on it and the bootstrap, in hosted mode, asserts it again before it opens a
 * connection, so neither can drift from the other.
 *
 * Why a hosted check at all. `allowsTestOnlySecrets` is true for `TEST_ENV=local` even under
 * `NODE_ENV=production`, and the service is a duplicate of `community-worker`, so a stray test
 * profile or fixture selector would let an ordinary photo reach `ready` without moderation, or a
 * selfie get canned palette results, with every other check green.
 */

/** The configuration the launcher's build-time drill starts the worker with: nothing reachable. */
export const ISOLATED_DRILL_ENV = {
  REDIS_URL: 'redis://127.0.0.1:1',
  DATABASE_URL: 'postgresql://drill:drill@127.0.0.1:1/drill',
  SUPABASE_URL: 'http://127.0.0.1:1',
  SUPABASE_SERVICE_ROLE_KEY: 'wardrobe-worker-drill-placeholder',
  ANALYTICS_ID_SECRET: 'wardrobe-worker-drill-placeholder-0123456789',
  [WARDROBE_MAINTENANCE_ENV]: 'false',
  LOG_LEVEL: 'info',
} as const

/**
 * Whether this is exactly the isolated drill configuration. Only that configuration may start
 * without maintenance and without dependency checks (it has no Redis, database or storage to
 * check or schedule against); naming the drill flag anywhere else exempts nothing.
 */
export function isIsolatedDrillEnv(env: Readonly<NodeJS.ProcessEnv>): boolean {
  return (
    env.REDIS_URL === ISOLATED_DRILL_ENV.REDIS_URL &&
    env.DATABASE_URL === ISOLATED_DRILL_ENV.DATABASE_URL &&
    env.SUPABASE_URL === ISOLATED_DRILL_ENV.SUPABASE_URL &&
    env.SUPABASE_SERVICE_ROLE_KEY === ISOLATED_DRILL_ENV.SUPABASE_SERVICE_ROLE_KEY
  )
}

/** Config required before any connection opens (selectors included). */
export const HOSTED_REQUIRED_ENV = [
  'DATABASE_URL',
  'REDIS_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GARMENT_TAGGING_ENGINE',
] as const

const GARMENT_ENGINES = ['manual', 'fashion-clip'] as const

export type HostedWardrobeConfigOptions = {
  /** The image has no model, so its launcher accepts only `manual`. Default true. */
  modelFree?: boolean
  /** The launcher's drill child; honoured only for the isolated drill configuration. */
  drillChild?: boolean
}

type Env = Readonly<NodeJS.ProcessEnv>

const valueOf = (env: Env, name: string) => (env[name] ?? '').trim()

function garmentEngineProblems(env: Env, modelFree: boolean): string[] {
  const garment = valueOf(env, 'GARMENT_TAGGING_ENGINE')
  if (garment === '') return []
  if (garment === 'fixture')
    return ['GARMENT_TAGGING_ENGINE=fixture is refused on a hosted worker.']
  const allowed: readonly string[] = modelFree ? ['manual'] : GARMENT_ENGINES
  if (allowed.includes(garment)) return []
  const advice = modelFree
    ? 'The hosted wardrobe image carries no tagging model; set GARMENT_TAGGING_ENGINE=manual.'
    : `Use ${allowed.join(' or ')}.`
  return [`GARMENT_TAGGING_ENGINE=${garment} is refused. ${advice}`]
}

function processingEngineProblems(env: Env): string[] {
  return ['SILHOUETTE_MODERATION_ENGINE', 'PALETTE_ANALYSIS_ENGINE'].flatMap((name) => {
    const selected = valueOf(env, name)
    if (selected === 'fixture') {
      return [
        `${name}=fixture is refused on a hosted worker: it would clear every photo or return canned results. Use heuristic or leave it unset.`,
      ]
    }
    return selected !== '' && selected !== 'heuristic'
      ? [`${name}=${selected} is not a supported selector; use heuristic.`]
      : []
  })
}

/** Every reason this environment may not start the hosted wardrobe worker; empty when it may. */
export function hostedWardrobeConfigProblems(
  env: Env = process.env,
  options: HostedWardrobeConfigOptions = {}
): string[] {
  const { modelFree = true, drillChild = false } = options
  const problems: string[] = []

  if (valueOf(env, 'TEST_ENV') !== '') {
    problems.push(
      `TEST_ENV=${valueOf(env, 'TEST_ENV')} is refused. A test profile opens the fixture engines and the test-only paths (allowsTestOnlySecrets is true for TEST_ENV=local even in production); unset it on the hosted service.`
    )
  }
  for (const name of HOSTED_REQUIRED_ENV) {
    if (valueOf(env, name) === '') problems.push(`${name} is required and is unset.`)
  }
  problems.push(
    ...garmentEngineProblems(env, modelFree),
    ...processingEngineProblems(env)
  )

  const isolatedDrill = drillChild && isIsolatedDrillEnv(env)
  if (!isolatedDrill && !wardrobeMaintenanceEnabled(env)) {
    problems.push(
      `${WARDROBE_MAINTENANCE_ENV} is not true. The hosted worker is the only runner of the wardrobe retention purge, the job handoff and the deletion drain; set ${WARDROBE_MAINTENANCE_ENV}=true.`
    )
  }

  return problems
}

/** Throws one error naming every problem. */
export function assertHostedWardrobeConfig(
  env: Readonly<NodeJS.ProcessEnv> = process.env,
  options: HostedWardrobeConfigOptions = {}
): void {
  const problems = hostedWardrobeConfigProblems(env, options)
  if (problems.length > 0) {
    throw new Error(`Hosted wardrobe worker configuration refused: ${problems.join(' ')}`)
  }
}
