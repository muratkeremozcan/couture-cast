// Production deployments come from CI only (pw-e2e-prod.yml), and only when the build inputs or
// the production configuration changed since the deployment production serves: every Hobby
// deployment, an ignored git build included, counts toward the 100 a day.
import { describe, expect, it } from 'vitest'
import {
  configIdentity,
  PRODUCTION_SOURCE,
  productionDeployment,
  type Deployment,
} from '../../../scripts/vercel-preview-deploy.mjs'

const head = 'c'.repeat(40)
const served = 'a'.repeat(40)

const production = (
  uid: string,
  state: string,
  created: number,
  meta: Record<string, string> | undefined = {
    githubCommitSha: served,
    ccProductionSource: PRODUCTION_SOURCE,
    ccProductionInputs: 'inputs-1',
    ccProductionConfig: 'config-1',
  }
): Deployment => ({
  uid,
  url: `${uid}.example`,
  state,
  created,
  target: 'production',
  meta,
})

const older = 'b'.repeat(40)
const newer = 'd'.repeat(40)

async function provide(
  current: Deployment | null,
  list: Deployment[] = [],
  options: {
    inputs?: string
    config?: string
    force?: boolean
    reportOnly?: boolean
    // After an Instant Rollback, Vercel keeps serving `current` until a deployment is promoted.
    rollback?: boolean
    // A promotion that never takes effect.
    promotionIgnored?: boolean
  } = {}
) {
  const created: Record<string, unknown>[] = []
  const polled: string[] = []
  const cancelled: string[] = []
  const promoted: string[] = []
  let clock = 0
  // What the production target serves: `current` until a build completes and is assigned
  // (automatically, or by an explicit promotion after a rollback).
  let target: Deployment | null = current
  const ready = new Map<string, Deployment>()
  const result = await productionDeployment({
    project: 'api',
    branch: 'main',
    sha: head,
    inputs: options.inputs ?? 'inputs-1',
    config: options.config ?? 'config-1',
    force: options.force,
    reportOnly: options.reportOnly,
    current,
    repoId: 42,
    projectId: 'prj_api',
    projectName: 'couture-cast-api',
    deadline: 120_000,
    intervalMs: 15_000,
    now: () => clock,
    sleep: (ms) => {
      clock += ms
      return Promise.resolve()
    },
    list: () => Promise.resolve(list),
    create: (body) => {
      created.push(body)
      return Promise.resolve({ id: 'dpl_new', readyState: 'QUEUED' })
    },
    get: (id) => {
      polled.push(id)
      const done: Deployment = {
        id,
        readyState: 'READY',
        url: `${id}.example`,
        meta: { githubCommitSha: head },
      }
      ready.set(id, done)
      if (!options.rollback) target = { ...done, uid: id }
      return Promise.resolve(done)
    },
    cancel: (id) => {
      cancelled.push(id)
      return Promise.resolve()
    },
    promote: (id) => {
      promoted.push(id)
      if (!options.promotionIgnored) target = { ...ready.get(id), uid: id }
      return Promise.resolve()
    },
    served: () => Promise.resolve(target),
    isOlder: (sha) => Promise.resolve(sha === older || sha === served),
  })
  return { result, created, polled, cancelled, promoted }
}

const building = (uid: string, sha: string, inputs: string, created = 3) =>
  production(uid, 'BUILDING', created, {
    githubCommitSha: sha,
    ccProductionSource: PRODUCTION_SOURCE,
    ccProductionInputs: inputs,
    ccProductionConfig: 'config-1',
  })

describe('Vercel production deployment', () => {
  it('leaves production alone when it already serves the same inputs and configuration', async () => {
    const { result, created } = await provide(production('dpl_served', 'READY', 2))
    expect(created).toEqual([])
    expect(result).toEqual({
      id: 'dpl_served',
      url: 'https://dpl_served.example',
      sha: served,
      reused: true,
    })
  })

  it('creates a production deployment of main when the build inputs changed', async () => {
    const { result, created } = await provide(production('dpl_served', 'READY', 2), [], {
      inputs: 'inputs-2',
    })
    expect(created).toEqual([
      {
        name: 'couture-cast-api',
        project: 'prj_api',
        target: 'production',
        gitSource: { type: 'github', repoId: 42, ref: 'main', sha: head },
        meta: {
          ccProductionSource: PRODUCTION_SOURCE,
          ccProductionInputs: 'inputs-2',
          ccProductionConfig: 'config-1',
        },
      },
    ])
    expect(result).toMatchObject({ id: 'dpl_new', sha: head, reused: false })
  })

  it('creates one when only the production configuration changed (a new variable)', async () => {
    const { created } = await provide(production('dpl_served', 'READY', 2), [], {
      config: 'config-2',
    })
    expect(created).toHaveLength(1)
  })

  it('creates one when production serves a deployment CI did not make (a git build)', async () => {
    const { created } = await provide(
      production('dpl_git', 'READY', 2, { githubCommitSha: served })
    )
    expect(created).toHaveLength(1)
  })

  it('creates one when there is no production deployment yet', async () => {
    const { created } = await provide(null)
    expect(created).toHaveLength(1)
  })

  it('judges by what production serves, so a dashboard rollback is not taken for current', async () => {
    // A rollback re-points production at an older deployment and creates none, so the newest
    // ready deployment of the same inputs is not what production serves.
    const rolledBackTo = production('dpl_rolled_back_to', 'READY', 1, {
      githubCommitSha: 'b'.repeat(40),
      ccProductionSource: PRODUCTION_SOURCE,
      ccProductionInputs: 'inputs-0',
      ccProductionConfig: 'config-1',
    })
    const { created } = await provide(rolledBackTo, [production('dpl_newer', 'READY', 2)])
    expect(created).toHaveLength(1)
  })

  it('adopts a production build of the same inputs that a superseded run left', async () => {
    const { result, created, polled } = await provide(
      production('dpl_served', 'READY', 2),
      [building('dpl_building', head, 'inputs-2')],
      { inputs: 'inputs-2' }
    )
    expect(created).toEqual([])
    expect(polled).toEqual(['dpl_building'])
    expect(result).toMatchObject({ id: 'dpl_building', sha: head })
  })

  it('cancels an older in-flight build of other inputs before keeping production as it is', async () => {
    // A served, B (older push, other inputs) still building, this push reverted B's change.
    const { result, created, cancelled } = await provide(
      production('dpl_served', 'READY', 2),
      [building('dpl_b', older, 'inputs-2')]
    )
    expect(cancelled).toEqual(['dpl_b'])
    expect(created).toEqual([])
    expect(result).toMatchObject({ id: 'dpl_served', sha: served, reused: true })
  })

  it('cancels an older in-flight build of other inputs before building its own', async () => {
    const { created, cancelled } = await provide(
      production('dpl_served', 'READY', 2),
      [building('dpl_b', older, 'inputs-2')],
      { inputs: 'inputs-3' }
    )
    expect(cancelled).toEqual(['dpl_b'])
    expect(created).toHaveLength(1)
  })

  it('leaves alone an in-flight build from a newer push', async () => {
    const { cancelled } = await provide(production('dpl_served', 'READY', 2), [
      building('dpl_newer', newer, 'inputs-2'),
    ])
    expect(cancelled).toEqual([])
  })

  it('promotes its build after an Instant Rollback left domain assignment off', async () => {
    const { result, promoted } = await provide(
      production('dpl_rolled_back_to', 'READY', 1, {
        githubCommitSha: older,
        ccProductionSource: PRODUCTION_SOURCE,
        ccProductionInputs: 'inputs-0',
        ccProductionConfig: 'config-1',
      }),
      [],
      { rollback: true }
    )
    expect(promoted).toEqual(['dpl_new'])
    expect(result).toMatchObject({ id: 'dpl_new', sha: head, reused: false })
  })

  it('does not promote a build that production already serves', async () => {
    const { promoted } = await provide(production('dpl_served', 'READY', 2), [], {
      inputs: 'inputs-2',
    })
    expect(promoted).toEqual([])
  })

  it('fails, naming the promotion, when production never serves its build', async () => {
    await expect(
      provide(production('dpl_served', 'READY', 2), [], {
        inputs: 'inputs-2',
        rollback: true,
        promotionIgnored: true,
      })
    ).rejects.toThrow(
      /production still serves dpl_served, not dpl_new, after promoting it/
    )
  })

  it('reports what production serves, creating and cancelling nothing, for a run off main', async () => {
    const { result, created, cancelled } = await provide(
      production('dpl_served', 'READY', 2),
      [building('dpl_b', older, 'inputs-2')],
      { inputs: 'inputs-9', reportOnly: true }
    )
    expect(created).toEqual([])
    expect(cancelled).toEqual([])
    expect(result).toMatchObject({ id: 'dpl_served', sha: served, reused: true })
  })

  it('never adopts a preview build', async () => {
    const preview = { ...production('dpl_preview', 'BUILDING', 9), target: null }
    const { created } = await provide(null, [preview])
    expect(created).toHaveLength(1)
  })

  it('creates one when forced, whatever production serves', async () => {
    const { created } = await provide(production('dpl_served', 'READY', 2), [], {
      force: true,
    })
    expect(created).toHaveLength(1)
  })
})

describe('Vercel production configuration identity', () => {
  const project = { framework: 'nextjs' }
  const variable = (
    key: string,
    target: string[],
    updatedAt: number,
    gitBranch?: string
  ) => ({
    key,
    id: `env_${key}`,
    target,
    updatedAt,
    ...(gitBranch ? { gitBranch } : {}),
  })

  it('reads production variables only', () => {
    const base = [variable('A', ['production'], 1), variable('B', ['preview'], 1)]
    const previewChanged = [
      variable('A', ['production'], 1),
      variable('B', ['preview'], 2),
    ]
    const productionChanged = [
      variable('A', ['production'], 2),
      variable('B', ['preview'], 1),
    ]
    const identity = (envs: Record<string, unknown>[]) =>
      configIdentity(project, envs, 'main', 'production')
    expect(identity(previewChanged)).toBe(identity(base))
    expect(identity(productionChanged)).not.toBe(identity(base))
  })

  it('keeps the preview identity as it was', () => {
    const envs = [variable('A', ['preview'], 1), variable('B', ['preview'], 1, 'other')]
    expect(configIdentity(project, envs, 'feature')).toBe(
      configIdentity(project, envs, 'feature', 'preview')
    )
  })
})
