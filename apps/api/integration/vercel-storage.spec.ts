import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import {
  inputsHash,
  previewRequired,
  projectBuildPaths,
} from '../../../scripts/vercel-preview-inputs.mjs'
import {
  BUILD_SETTINGS,
  configIdentity,
  PREVIEW_SOURCE,
  previewDeployment,
  run,
  type Deployment,
} from '../../../scripts/vercel-preview-deploy.mjs'

const projects = ['web', 'api'] as const

const repoRoot = path.resolve(__dirname, '../../..')
const vercelConfig = z.object({
  ignoreCommand: z.string().optional(),
  git: z.object({ deploymentEnabled: z.record(z.boolean()) }),
  outputDirectory: z.string().optional(),
  functions: z.record(z.unknown()).optional(),
  rewrites: z.array(z.object({ source: z.string(), destination: z.string() })).optional(),
})

function readVercelConfig(app: string) {
  const value: unknown = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'apps', app, 'vercel.json'), 'utf8')
  )
  return vercelConfig.parse(value)
}

let fixture: string

function git(...args: string[]) {
  return execFileSync('git', args, {
    cwd: fixture,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim()
}

function commit(file: string, content = 'changed') {
  const target = path.join(fixture, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
  git('add', '--', file)
  git(
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'fixture'
  )
}

beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-storage-'))
  git('init', '-b', 'main')
  git('config', 'user.name', 'Storage fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  commit('apps/api/src/main.ts', 'baseline')
  git('remote', 'add', 'origin', fixture)
  git('checkout', '-b', 'preview')
})

afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }))

describe('Vercel preview storage', () => {
  // The preview lane of scripts/ci/lanes.mjs decides: Maestro flows, load scripts and Pact
  // files belong to other lanes, and docs to none.
  it.each([
    'apps/mobile/app/index.tsx',
    'docs/guide.md',
    '_bmad-output/notes.md',
    'maestro/flow.yaml',
    'k6/load.js',
    'pact/contract.json',
  ])('needs no preview deployment for a branch changing only %s', (file) => {
    commit(file)
    expect(previewRequired(fixture, 'main')).toBe(false)
  })

  it.each([
    'apps/api/src/main.ts',
    'apps/api/api/realtime.ts',
    'apps/web/src/app/page.tsx',
    'packages/utils/src/index.ts',
    'package-lock.json',
    'scripts/build.mjs',
    'playwright/tests/flow.spec.ts',
    '.github/workflows/pr-checks.yml',
    'new-runtime/input.json',
  ])('keeps exact-SHA checks for %s', (file) => {
    commit(file)
    expect(previewRequired(fixture, 'main')).toBe(true)
  })

  it('keeps an earlier API change when the latest commit changes only mobile', () => {
    commit('apps/api/src/main.ts')
    commit('apps/mobile/app/index.tsx')
    expect(previewRequired(fixture, 'main')).toBe(true)
  })

  it('keeps the preview checks when history is unavailable', () => {
    expect(previewRequired(fixture, 'missing-ref')).toBe(true)
  })

  // The CLI roots itself where it lives, so it runs from a copy inside the fixture repository,
  // whose origin/main is a baseline commit that already holds the copy, the lane map it asks
  // and the workspace manifests the map reads.
  it('an explicit request requires previews that the branch alone would skip', () => {
    const cli = path.join(fixture, 'scripts/vercel-preview-inputs.mjs')
    const copies = [
      'scripts/vercel-preview-inputs.mjs',
      'scripts/ci/lanes.mjs',
      ...['apps', 'packages'].flatMap((dir) =>
        fs
          .readdirSync(path.join(repoRoot, dir))
          .map((name) => `${dir}/${name}/package.json`)
          .filter((file) => fs.existsSync(path.join(repoRoot, file)))
      ),
    ]
    for (const file of copies) {
      fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true })
      fs.copyFileSync(path.join(repoRoot, file), path.join(fixture, file))
    }
    git('add', '--', ...copies)
    git(
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'baseline'
    )
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    const scope = (requested: string) => {
      const output = path.join(fixture, `.git/scope-${requested}-${Math.random()}`)
      execFileSync('node', [cli], {
        cwd: fixture,
        env: { ...process.env, GITHUB_OUTPUT: output, REQUIRE_PREVIEWS: requested },
        stdio: 'pipe',
      })
      return fs.readFileSync(output, 'utf8').trim()
    }
    expect(scope('false')).toBe('required=false')
    expect(scope('true')).toBe('required=true')
    commit('docs/guide.md')
    expect(scope('false')).toBe('required=false')
    expect(scope('true')).toBe('required=true')
    commit('apps/web/src/app/page.tsx')
    expect(scope('false')).toBe('required=true')
  })

  it('keeps the preview checks when the lane map cannot read the workspaces', () => {
    commit('docs/guide.md')
    expect(previewRequired(fixture, 'main', 'HEAD', undefined)).toBe(false)
    // A workspace graph the map cannot expand decides nothing: previews stay required.
    expect(previewRequired(fixture, 'main', 'HEAD', { web: ['no-such-workspace'] })).toBe(
      true
    )
  })

  it('keeps a deletion of runtime code when that code moves under docs', () => {
    fs.mkdirSync(path.join(fixture, 'docs'))
    git('mv', 'apps/api/src/main.ts', 'docs/main.ts')
    git(
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'move'
    )
    expect(previewRequired(fixture, 'main')).toBe(true)
  })

  it('every project input set excludes the other app and keeps shared inputs', () => {
    expect(projectBuildPaths.web).toContain(':(exclude)apps/api')
    expect(projectBuildPaths.web).not.toContain(':(exclude)apps/web')
    expect(projectBuildPaths.api).toContain(':(exclude)apps/web')
    expect(projectBuildPaths.api).not.toContain(':(exclude)apps/api')
    for (const project of projects)
      for (const shared of ['packages', 'scripts', 'package-lock.json', 'supabase'])
        expect(projectBuildPaths[project]).not.toContain(`:(exclude)${shared}`)
  })

  // A preview deployment is reused only for identical inputs: every tracked path, mode and blob
  // the project builds from.
  it.each([
    ['apps/api/src/main.ts', { web: false, api: true }],
    ['apps/api/vercel.json', { web: false, api: true }],
    ['apps/web/src/app/page.tsx', { web: true, api: false }],
    ['apps/web/vercel.json', { web: true, api: false }],
    ['packages/utils/src/index.ts', { web: true, api: true }],
    ['packages/db/prisma/schema.prisma', { web: true, api: true }],
    ['package-lock.json', { web: true, api: true }],
    ['package.json', { web: true, api: true }],
    ['scripts/build.mjs', { web: true, api: true }],
    ['new-runtime/input.json', { web: true, api: true }],
    ['playwright/tests/flow.spec.ts', { web: false, api: false }],
    ['.github/workflows/pr-checks.yml', { web: false, api: false }],
    ['maestro/flow.yaml', { web: false, api: false }],
    ['k6/load.js', { web: false, api: false }],
    ['pact/contract.json', { web: false, api: false }],
    ['apps/mobile/app/index.tsx', { web: false, api: false }],
    ['docs/guide.md', { web: false, api: false }],
  ] as const)('a commit changing %s changes the inputs of %o', (file, changes) => {
    const before = { web: inputsHash(fixture, 'web'), api: inputsHash(fixture, 'api') }
    commit(file)
    for (const project of projects)
      expect(inputsHash(fixture, project) !== before[project], project).toBe(
        changes[project]
      )
  })

  it('identifies inputs by content, so rewritten history keeps its deployment', () => {
    commit('apps/api/src/main.ts', 'branch change')
    const original = inputsHash(fixture, 'api')
    // The same content on a rewritten branch with no shared commit after main.
    git('checkout', '-q', '-b', 'rewritten', 'main')
    commit('apps/api/src/main.ts', 'branch change')
    commit('docs/guide.md', 'a note')
    expect(inputsHash(fixture, 'api')).toBe(original)
    fs.writeFileSync(path.join(fixture, 'apps/api/src/main.ts'), 'uncommitted')
    expect(() => inputsHash(fixture, 'api')).toThrow(
      'the checkout has uncommitted changes to the build inputs'
    )
  })

  it('connects both projects, the preview wait and the e2e run to the same deployment', () => {
    for (const app of ['api', 'web']) {
      const config = readVercelConfig(app)
      // Branch pushes create no deployment; main still deploys production.
      expect(config.git.deploymentEnabled).toEqual({ main: true, '**': false })
      expect(config.ignoreCommand).toBeUndefined()
    }
    const read = (file: string) =>
      fs.readFileSync(path.join(repoRoot, '.github/workflows', file), 'utf8')
    const caller = read('pr-pw-e2e-vercel-preview.yml')
    const workflow = read('rwf-vercel-preview-ready.yml')
    expect(workflow).toContain('run: node scripts/vercel-preview-inputs.mjs')
    expect(workflow).toContain(
      "if: needs.preview-scope.outputs.required == 'true' && inputs.deploy_web"
    )
    expect(workflow).toContain(
      "if: needs.preview-scope.outputs.required == 'true' && inputs.deploy_api"
    )
    expect(workflow).toContain('run: node scripts/vercel-preview-deploy.mjs web')
    expect(workflow).toContain('run: node scripts/vercel-preview-deploy.mjs api')
    expect(workflow).toContain('FORCE_BUILD: ${{ inputs.force_build }}')
    expect(workflow).toContain(
      'health_url: ${{ needs.deploy-web.outputs.url }}/api/health'
    )
    expect(workflow).toContain('expected_sha: ${{ needs.deploy-web.outputs.sha }}')
    expect(workflow).toContain(
      'health_url: ${{ needs.deploy-api.outputs.url }}/api/health'
    )
    expect(workflow).toContain('expected_sha: ${{ needs.deploy-api.outputs.sha }}')
    expect(workflow).toContain('value: ${{ jobs.deploy-web.outputs.url }}')
    expect(workflow).toContain('value: ${{ jobs.deploy-api.outputs.url }}')
    expect(workflow).not.toContain('resolve-vercel-preview-url')
    // Opening a PR provides its previews; no automatic deployment exists to find.
    expect(caller).toContain('types: [opened, reopened, labeled, synchronize]')
    // Adding the label forces one rebuild; later pushes to a labeled PR reuse as usual.
    expect(caller).toContain(
      "force_build: ${{ github.event.action == 'labeled' && github.event.label.name == 'PREVIEW-REBUILD' }}"
    )
    expect(caller).not.toContain('labels.*.name')
    expect(caller).toContain("if: needs.preview-ready.outputs.required == 'true'")
    expect(caller).toContain('expected_sha: ${{ github.event.pull_request.head.sha }}')
    expect(caller).toContain(
      'custom_base_url: ${{ needs.preview-ready.outputs.web_url }}'
    )
    expect(caller).toContain(
      'custom_api_base_url: ${{ needs.preview-ready.outputs.api_url }}'
    )
    expect(caller).toContain(
      'expected_web_sha: ${{ needs.preview-ready.outputs.web_sha }}'
    )
    expect(read('rwf-e2e.yml')).toContain(
      'EXPECTED_WEB_SHA: ${{ inputs.expected_web_sha || steps.expected_sha.outputs.sha }}'
    )
    // A manual run provides each preview it names no URL for.
    const manual = read('pw-e2e-trigger.yml')
    expect(manual).toContain(
      "if: inputs.test_env == 'preview' && (inputs.custom_base_url == '' || inputs.custom_api_base_url == '')"
    )
    expect(manual).toContain("deploy_web: ${{ inputs.custom_base_url == '' }}")
    expect(manual).toContain("deploy_api: ${{ inputs.custom_api_base_url == '' }}")
    expect(manual).toContain('force_build: ${{ inputs.force_preview_build }}')
    expect(manual).toContain('require_previews: true')
    expect(workflow).toContain(
      'REQUIRE_PREVIEWS: ${{ inputs.require_previews || inputs.force_build }}'
    )
    expect(workflow.match(/PREVIEW_JOB_STARTED_MS=\$\(date \+%s%3N\)/g)).toHaveLength(2)
    expect(manual).toContain(
      'custom_api_base_url: ${{ inputs.custom_api_base_url || needs.preview-ready.outputs.api_url }}'
    )
    expect(manual).toContain(
      "expected_web_sha: ${{ inputs.custom_base_url == '' && needs.preview-ready.outputs.web_sha || '' }}"
    )
  })

  it('publishes only the deliberate public directory while keeping REST and realtime', () => {
    const api = readVercelConfig('api')
    expect(api.outputDirectory).toBe('public')
    expect(
      fs
        .statSync(path.join(repoRoot, 'apps/api', api.outputDirectory ?? ''))
        .isDirectory()
    ).toBe(true)
    expect(Object.keys(api.functions ?? {}).sort()).toEqual([
      'api/index.ts',
      'api/realtime.ts',
    ])
    expect(api.rewrites).toContainEqual({
      source: '/api/realtime',
      destination: '/api/realtime',
    })
  })
})

describe('Vercel preview configuration identity', () => {
  const project: Record<string, unknown> = {
    framework: 'nextjs',
    buildCommand: null,
    rootDirectory: 'apps/web',
  }
  const variable = (overrides: Record<string, unknown> = {}) => ({
    key: 'POSTHOG_API_KEY',
    id: 'env_1',
    target: ['preview'],
    updatedAt: 1,
    ...overrides,
  })
  const identity = (envs: Record<string, unknown>[], settings = project) =>
    configIdentity(settings, envs, 'feature')

  it('changes when a preview variable is updated, added or removed', () => {
    const base = identity([variable()])
    expect(identity([variable({ updatedAt: 2 })])).not.toBe(base)
    expect(
      identity([variable(), variable({ key: 'PREVIEW_API_BASE_URL', id: 'env_2' })])
    ).not.toBe(base)
    expect(identity([])).not.toBe(base)
  })

  it('reads a target given as a string like one given as a list', () => {
    const listed = identity([variable({ key: 'B', id: 'env_9', target: ['preview'] })])
    expect(identity([variable({ key: 'B', id: 'env_9', target: 'preview' })])).toBe(
      listed
    )
    expect(
      identity([variable({ key: 'B', id: 'env_9', target: 'preview', updatedAt: 2 })])
    ).not.toBe(listed)
    expect(identity([variable({ key: 'B', id: 'env_9', target: 'production' })])).toBe(
      identity([])
    )
  })

  it.each(BUILD_SETTINGS)('changes when the %s setting changes', (setting) => {
    const before = { ...project, [setting]: true }
    const after = { ...project, [setting]: { changed: setting } }
    expect(identity([variable()], after)).not.toBe(identity([variable()], before))
  })

  it.each(['sourceFilesOutsideRootDirectory', 'autoExposeSystemEnvs', 'gitLFS'])(
    'changes when %s is switched off',
    (setting) => {
      expect(identity([variable()], { ...project, [setting]: false })).not.toBe(
        identity([variable()], { ...project, [setting]: true })
      )
    }
  )

  it('ignores the key order of nested resource settings', () => {
    expect(
      identity([variable()], {
        ...project,
        resourceConfig: { fluid: true, buildMachineType: 'basic' },
      })
    ).toBe(
      identity([variable()], {
        ...project,
        resourceConfig: { buildMachineType: 'basic', fluid: true },
      })
    )
  })

  it('ignores variables a preview build of this branch does not read, and their order', () => {
    const base = identity([variable(), variable({ key: 'A', id: 'env_2' })])
    expect(
      identity([
        variable({ key: 'A', id: 'env_2' }),
        variable(),
        variable({ key: 'PROD_ONLY', id: 'env_3', target: ['production'] }),
        variable({ key: 'OTHER_BRANCH', id: 'env_4', gitBranch: 'other' }),
      ])
    ).toBe(base)
    expect(
      identity([
        variable(),
        variable({ key: 'A', id: 'env_2' }),
        variable({ key: 'MINE', id: 'env_5', gitBranch: 'feature' }),
      ])
    ).not.toBe(base)
  })
})

describe('Vercel preview deployment', () => {
  const sha = 'b'.repeat(40)
  const older = 'a'.repeat(40)
  const meta = (overrides: Record<string, string> = {}) => ({
    githubCommitRef: 'feature',
    githubCommitSha: older,
    ccPreviewSource: PREVIEW_SOURCE,
    ccPreviewInputs: 'inputs-1',
    ccPreviewConfig: 'config-1',
    ...overrides,
  })
  // Vercel's shapes: list items carry uid, state and created; create and get carry id,
  // readyState and createdAt.
  const listed = (
    uid: string,
    state: string,
    created: number,
    overrides = {}
  ): Deployment => ({
    uid,
    url: `${uid}.example`,
    state,
    created,
    target: null,
    meta: meta(overrides),
  })
  function deploy(
    list: Deployment[],
    // Each poll answers the next entry; an Error entry is a failed request.
    states: (Deployment | Error)[] = [
      { id: 'dpl_new', readyState: 'READY', url: 'built.example' },
    ],
    options: {
      create?: () => Promise<Deployment>
      force?: boolean
      deadlineMs?: number
    } = {}
  ) {
    let clock = 0
    let polls = 0
    const created: Record<string, unknown>[] = []
    const polled: string[] = []
    const waits: number[] = []
    const result = previewDeployment({
      project: 'web',
      branch: 'feature',
      sha,
      inputs: 'inputs-1',
      config: 'config-1',
      force: options.force,
      repoId: 42,
      projectId: 'prj_web',
      projectName: 'couture-cast-web',
      deadline: options.deadlineMs ?? 10 * 60_000,
      now: () => clock,
      sleep: (ms) => {
        waits.push(ms)
        clock += ms
        return Promise.resolve()
      },
      list: () => Promise.resolve(list),
      create: (body) => {
        created.push(body)
        return options.create
          ? options.create()
          : Promise.resolve({
              id: 'dpl_new',
              url: 'built.example',
              readyState: 'QUEUED',
              createdAt: 50,
            })
      },
      get: (id) => {
        polled.push(id)
        const next = states[Math.min(polls++, states.length - 1)]!
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
      },
    })
    return { result, created, polled, waits }
  }
  const createBody = {
    name: 'couture-cast-web',
    project: 'prj_web',
    gitSource: { type: 'github', repoId: 42, ref: 'feature', sha },
    meta: {
      ccPreviewSource: PREVIEW_SOURCE,
      ccPreviewInputs: 'inputs-1',
      ccPreviewConfig: 'config-1',
    },
  }

  it('reuses the newest ready deployment it created for the same inputs and configuration', async () => {
    const run = deploy(
      [listed('dpl_old', 'READY', 1), listed('dpl_newer', 'READY', 2)],
      [{ id: 'dpl_newer', readyState: 'READY', url: 'dpl_newer.example' }]
    )
    await expect(run.result).resolves.toEqual({
      id: 'dpl_newer',
      url: 'https://dpl_newer.example',
      sha: older,
      reused: true,
    })
    expect(run.created).toEqual([])
  })

  it('reuses a ready deployment of the commit itself', async () => {
    const run = deploy(
      [listed('dpl_same', 'READY', 1, { githubCommitSha: sha })],
      [{ id: 'dpl_same', readyState: 'READY', url: 'dpl_same.example' }]
    )
    await expect(run.result).resolves.toMatchObject({
      id: 'dpl_same',
      sha,
      reused: false,
    })
    expect(run.created).toEqual([])
  })

  it('adopts a build already running for the same inputs instead of creating another', async () => {
    const run = deploy(
      [listed('dpl_running', 'BUILDING', 3)],
      [
        { id: 'dpl_running', readyState: 'BUILDING' },
        { id: 'dpl_running', readyState: 'READY', url: 'dpl_running.example' },
      ]
    )
    await expect(run.result).resolves.toMatchObject({ id: 'dpl_running', sha: older })
    expect(run.created).toEqual([])
    expect(run.polled).toEqual(['dpl_running', 'dpl_running'])
  })

  it.each([
    ['other inputs', listed('dpl_x', 'READY', 1, { ccPreviewInputs: 'inputs-0' })],
    ['other configuration', listed('dpl_x', 'READY', 1, { ccPreviewConfig: 'config-0' })],
    ['another branch', listed('dpl_x', 'READY', 1, { githubCommitRef: 'other' })],
    [
      'a production deployment',
      { ...listed('dpl_x', 'BUILDING', 1), target: 'production' },
    ],
    [
      'a deployment without this script’s marker',
      {
        ...listed('dpl_x', 'READY', 1),
        meta: { ...meta(), ccPreviewSource: 'dashboard' },
      },
    ],
    ['a canceled deployment', listed('dpl_x', 'CANCELED', 1, { githubCommitSha: sha })],
    ['a failed deployment', listed('dpl_x', 'ERROR', 1, { githubCommitSha: sha })],
  ])('builds the commit instead of adopting %s', async (_label, candidate) => {
    const run = deploy(
      [candidate],
      [
        { id: 'dpl_new', readyState: 'QUEUED' },
        { id: 'dpl_new', readyState: 'BUILDING' },
        { id: 'dpl_new', readyState: 'READY', url: 'built.example' },
      ]
    )
    await expect(run.result).resolves.toEqual({
      id: 'dpl_new',
      url: 'https://built.example',
      sha,
      reused: false,
    })
    expect(run.created).toEqual([createBody])
    expect(run.polled).toEqual(['dpl_new', 'dpl_new', 'dpl_new'])
  })

  it('builds fresh when forced, adopting nothing', async () => {
    const run = deploy(
      [listed('dpl_ready', 'READY', 1), listed('dpl_running', 'BUILDING', 2)],
      undefined,
      { force: true }
    )
    await expect(run.result).resolves.toMatchObject({ id: 'dpl_new', reused: false })
    expect(run.created).toEqual([createBody])
  })

  it.each(['ERROR', 'CANCELED'])('fails when the build ends %s', async (state) => {
    await expect(
      deploy([], [{ id: 'dpl_new', readyState: state, readyStateReason: 'Build failed' }])
        .result
    ).rejects.toThrow(`web: deployment dpl_new for ${sha} ended ${state}: Build failed`)
  })

  it('fails when Vercel refuses the deployment', async () => {
    const refused = new Error(
      'Vercel POST /v13/deployments answered 429: Deployment rate limited'
    )
    await expect(
      deploy([], [], { create: () => Promise.reject(refused) }).result
    ).rejects.toThrow('answered 429: Deployment rate limited')
  })

  const answered = (status: number) =>
    Object.assign(
      new Error(`Vercel GET /v13/deployments/dpl_new answered ${status}: x`),
      {
        status,
      }
    )

  it('keeps polling through a rate limit, a server error, a timeout or a lost connection', async () => {
    const run = deploy(
      [],
      [
        { id: 'dpl_new', readyState: 'BUILDING' },
        answered(429),
        answered(503),
        Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError',
        }),
        new TypeError('fetch failed'),
        { id: 'dpl_new', readyState: 'READY', url: 'built.example' },
      ]
    )
    await expect(run.result).resolves.toMatchObject({ id: 'dpl_new', reused: false })
    expect(run.polled).toHaveLength(6)
  })

  it.each([401, 404])('stops polling at once when Vercel answers %s', async (status) => {
    const run = deploy([], [answered(status)])
    await expect(run.result).rejects.toThrow(`answered ${status}`)
    expect(run.polled).toHaveLength(1)
  })

  it('reports the last transient error when the deadline leaves no time to retry', async () => {
    const run = deploy([], [answered(503)], { deadlineMs: 60_000 })
    await expect(run.result).rejects.toThrow('answered 503')
    // Retries stop with one interval of the deadline left: at 0, 15, 30 and 45 s.
    expect(run.polled).toHaveLength(4)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    'waits one interval when a rate limit carries an unusable reset (%s)',
    async (retryAt) => {
      const run = deploy(
        [],
        [
          Object.assign(answered(429), { retryAt }),
          { id: 'dpl_new', readyState: 'READY', url: 'built.example' },
        ]
      )
      await expect(run.result).resolves.toMatchObject({ id: 'dpl_new' })
      expect(run.waits).toEqual([15_000])
    }
  )

  it('names the queue when a build is still waiting for the single Hobby build slot', async () => {
    const run = deploy([], [{ id: 'dpl_new', readyState: 'QUEUED' }], {
      deadlineMs: 60_000,
    })
    await expect(run.result).rejects.toThrow(
      `web: deployment dpl_new for ${sha} is still QUEUED as this job's 20 minutes run out. Hobby builds one deployment at a time, so it waits behind another build`
    )
    // Polls stop with one interval of the deadline left: at 0, 15, 30 and 45 s.
    expect(run.polled).toHaveLength(4)
  })

  it('stops a build still running at the deadline', async () => {
    await expect(
      deploy([], [{ id: 'dpl_new', readyState: 'BUILDING' }], { deadlineMs: 60_000 })
        .result
    ).rejects.toThrow(
      `web: deployment dpl_new for ${sha} is still BUILDING as this job's 20 minutes run out.`
    )
  })
})

describe('Vercel preview deploy step', () => {
  type Call = { method: string; path: string; body?: unknown }
  /** A failed poll: its status, headers and JSON body, or a body that stalls after the headers. */
  type PollFailure =
    | number
    | {
        status: number
        headers?: Record<string, string>
        body?: unknown
        // Sent as is, for values JSON.stringify cannot write, such as 1e999.
        rawBody?: string
        stall?: boolean
        // Runs as the body is read, for a body that arrives late.
        whileReading?: () => void
      }
  function failedPoll(next: PollFailure) {
    const failure = typeof next === 'number' ? { status: next } : next
    const text =
      'rawBody' in failure && failure.rawBody !== undefined
        ? failure.rawBody
        : JSON.stringify(failure.body ?? { error: { message: 'try later' } })
    // A stalled body: the headers arrived, then reading the rest timed out.
    const body = failure.stall
      ? new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(text.slice(0, 5)))
            controller.error(
              Object.assign(new Error('The operation was aborted due to timeout'), {
                name: 'TimeoutError',
              })
            )
          },
        })
      : failure.whileReading
        ? new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                failure.whileReading?.()
                controller.enqueue(new TextEncoder().encode(text))
                controller.close()
              },
            },
            // No eager pull: the body is produced only once the client reads it.
            { highWaterMark: 0 }
          )
        : text
    return new Response(body, { status: failure.status, headers: failure.headers })
  }
  function vercel(deployments: Deployment[], pollFailures: PollFailure[] = []) {
    const calls: Call[] = []
    const failures = [...pollFailures]
    const fetchImpl = (url: string | URL | Request, init?: RequestInit) => {
      const target = new URL(url instanceof Request ? url.url : url.toString())
      const call: Call = {
        method: init?.method ?? 'GET',
        path: `${target.pathname}${target.search}`,
        ...(typeof init?.body === 'string'
          ? { body: JSON.parse(init.body) as unknown }
          : {}),
      }
      calls.push(call)
      const reply = (value: unknown) =>
        Promise.resolve(new Response(JSON.stringify(value), { status: 200 }))
      if (target.pathname === '/v2/teams/team-slug') return reply({ id: 'team_1' })
      if (target.pathname === '/v9/projects/couture-cast-web')
        return reply({ id: 'prj_web', name: 'couture-cast-web', link: { repoId: 42 } })
      if (target.pathname === '/v9/projects/prj_web/env') return reply({ envs: [] })
      if (target.pathname === '/v6/deployments') return reply({ deployments })
      if (target.pathname === '/v13/deployments' && call.method === 'POST')
        return reply({
          id: 'dpl_new',
          url: 'built.example',
          readyState: 'QUEUED',
          createdAt: 5,
        })
      if (target.pathname.startsWith('/v13/deployments/') && failures.length)
        return Promise.resolve(failedPoll(failures.shift()!))
      if (target.pathname.startsWith('/v13/deployments/'))
        return reply({
          id: target.pathname.split('/').at(-1),
          url: 'built.example',
          readyState: 'READY',
        })
      return Promise.resolve(new Response('{}', { status: 404 }))
    }
    return { calls, fetchImpl: fetchImpl as typeof fetch }
  }
  const env = (force: boolean) => ({
    VERCEL_TOKEN: 'token',
    GIT_REF: 'preview',
    EXPECTED_SHA: 'c'.repeat(40),
    FORCE_BUILD: String(force),
    VERCEL_WEB_PROJECT_SLUG: 'couture-cast-web',
    VERCEL_TEAM_SLUG: 'team-slug',
  })

  // Creating runs only when no deployment matches these inputs and this configuration, so
  // Vercel must build: without forceNew it can hand back an earlier build of the commit.
  it.each([false, true])(
    'creates a fresh build through the real request (force %s) and never cancels',
    async (force) => {
      const api = vercel([])
      await expect(
        run('web', env(force), {
          fetchImpl: api.fetchImpl,
          cwd: fixture,
          sleep: () => Promise.resolve(),
        })
      ).resolves.toMatchObject({
        id: 'dpl_new',
        url: 'https://built.example',
        reused: false,
      })
      const writes = api.calls.filter((call) => call.method !== 'GET')
      expect(writes).toHaveLength(1)
      expect(writes[0]).toMatchObject({
        method: 'POST',
        path: '/v13/deployments?forceNew=1&teamId=team_1',
        body: {
          name: 'couture-cast-web',
          project: 'prj_web',
          gitSource: { type: 'github', repoId: 42, ref: 'preview', sha: 'c'.repeat(40) },
          meta: {
            ccPreviewSource: PREVIEW_SOURCE,
            ccPreviewInputs: inputsHash(fixture, 'web'),
          },
        },
      })
      // A forced build skips the lookup that could adopt an earlier one.
      expect(api.calls.some((call) => call.path.startsWith('/v6/deployments'))).toBe(
        !force
      )
    }
  )

  it('carries the HTTP status on a failed poll, so a 503 is retried and a 403 is not', async () => {
    const flaky = vercel([], [503])
    await expect(
      run('web', env(false), {
        fetchImpl: flaky.fetchImpl,
        cwd: fixture,
        sleep: () => Promise.resolve(),
      })
    ).resolves.toMatchObject({ id: 'dpl_new', url: 'https://built.example' })
    expect(
      flaky.calls.filter((call) => call.path.startsWith('/v13/deployments/dpl_new'))
    ).toHaveLength(2)
    const refused = vercel([], [403])
    await expect(
      run('web', env(false), {
        fetchImpl: refused.fetchImpl,
        cwd: fixture,
        sleep: () => Promise.resolve(),
      })
    ).rejects.toThrow('answered 403: try later')
  })

  it.each([
    [403, 'fails at once', 1],
    [503, 'retries', 2],
  ])(
    'keeps the status when a %s body stalls after its headers, so it %s',
    async (status, _outcome, polls) => {
      const stalled = vercel([], [{ status, stall: true }])
      const result = run('web', env(false), {
        fetchImpl: stalled.fetchImpl,
        cwd: fixture,
        sleep: () => Promise.resolve(),
      })
      if (status === 403) await expect(result).rejects.toThrow('answered 403')
      else await expect(result).resolves.toMatchObject({ id: 'dpl_new' })
      expect(
        stalled.calls.filter((call) => call.path.startsWith('/v13/deployments/dpl_new'))
      ).toHaveLength(polls)
    }
  )

  describe('a rate-limited poll waits for the reset Vercel announces', () => {
    const started = 1_000_000
    const resetIn = 120_000
    // `left` is how much of the job's deadline remains when the poll is answered.
    const timed = (
      failure: PollFailure | ((advance: (ms: number) => void) => PollFailure),
      left?: number
    ) => {
      const deadline = started + 20 * 60_000 - 45_000
      let clock = left === undefined ? started : deadline - left
      const advance = (ms: number) => (clock += ms)
      const waits: number[] = []
      const api = vercel([], [typeof failure === 'function' ? failure(advance) : failure])
      const result = run(
        'web',
        { ...env(false), PREVIEW_JOB_STARTED_MS: String(started) },
        {
          fetchImpl: api.fetchImpl,
          cwd: fixture,
          now: () => clock,
          sleep: (ms) => {
            waits.push(ms)
            clock += ms
            return Promise.resolve()
          },
        }
      )
      return { result, waits, api }
    }
    const resetAt = (from: number) => started + from

    it.each([
      ['Retry-After', { headers: { 'Retry-After': String(resetIn / 1000) } }],
      [
        'X-RateLimit-Reset',
        { headers: { 'X-RateLimit-Reset': String(resetAt(resetIn) / 1000) } },
      ],
      [
        'error.limit.resetMs',
        {
          body: { error: { code: 'rate_limited', limit: { resetMs: resetAt(resetIn) } } },
        },
      ],
      [
        'error.limit.reset',
        {
          body: {
            error: { code: 'rate_limited', limit: { reset: resetAt(resetIn) / 1000 } },
          },
        },
      ],
    ])('from %s', async (_source, timing) => {
      const { result, waits } = timed({ status: 429, ...timing })
      await expect(result).resolves.toMatchObject({ id: 'dpl_new' })
      // The poll after the 429 waits until the reset, not one 15 s interval.
      expect(Math.max(...waits)).toBeGreaterThanOrEqual(resetIn - 1_000)
    })

    it.each([
      ['X-RateLimit-Reset: Infinity', { headers: { 'X-RateLimit-Reset': 'Infinity' } }],
      [
        'error.limit.resetMs: 1e999',
        { rawBody: '{"error":{"code":"rate_limited","limit":{"resetMs":1e999}}}' },
      ],
    ])(
      'ignores an unusable reset (%s) and waits one interval',
      async (_source, timing) => {
        const { result, waits } = timed({ status: 429, ...timing })
        await expect(result).resolves.toMatchObject({ id: 'dpl_new' })
        expect(waits).toEqual([15_000])
      }
    )

    it('lets a 503 retry on its interval although its quota window resets past the deadline', async () => {
      const { result, waits } = timed({
        status: 503,
        headers: { 'X-RateLimit-Reset': String(resetAt(60 * 60_000) / 1000) },
        body: { error: { limit: { resetMs: resetAt(60 * 60_000) } } },
      })
      await expect(result).resolves.toMatchObject({ id: 'dpl_new' })
      expect(waits).toEqual([15_000])
    })

    it('honours Retry-After on a 503', async () => {
      const { result, waits } = timed({
        status: 503,
        headers: { 'Retry-After': String(resetIn / 1000) },
      })
      await expect(result).resolves.toMatchObject({ id: 'dpl_new' })
      expect(waits).toEqual([resetIn])
    })

    it('counts a relative Retry-After from when the headers arrived, not after a slow body', async () => {
      // 130 s left when the 429 arrives; its body takes 30 s; Retry-After 110 s still fits.
      const { result, waits } = timed(
        (advance) => ({
          status: 429,
          headers: { 'Retry-After': '110' },
          whileReading: () => advance(30_000),
        }),
        130_000
      )
      await expect(result).resolves.toMatchObject({ id: 'dpl_new' })
      expect(waits).toEqual([80_000])
    })

    it('fails at once with the reason when the reset falls past the job deadline', async () => {
      const { result, waits, api } = timed({
        status: 429,
        headers: { 'Retry-After': String(60 * 60) },
      })
      await expect(result).rejects.toThrow(/rate limit.*past this job's deadline/i)
      expect(waits).toEqual([])
      expect(
        api.calls.filter((call) => call.path.startsWith('/v13/deployments/dpl_new'))
      ).toHaveLength(1)
    })
  })

  describe('a poll answered through a real HTTP connection', () => {
    let server: Server | undefined
    afterEach(async () => {
      await new Promise<void>((resolve) =>
        server ? server.close(() => resolve()) : resolve()
      )
      server = undefined
    })
    /** Serves the deployment polls: `first` answers the first, READY every later one. */
    async function polls(first: (response: ServerResponse) => void) {
      let requests = 0
      server = createServer((_request, response) => {
        if (requests++ === 0) return first(response)
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({ id: 'dpl_new', url: 'built.example', readyState: 'READY' })
        )
      })
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as AddressInfo).port
      const api = vercel([])
      // Every other request stays mocked; the polls go through Node's fetch to the server.
      const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
        const target = new URL(url instanceof Request ? url.url : url.toString())
        return target.pathname.startsWith('/v13/deployments/dpl_new')
          ? fetch(`http://127.0.0.1:${port}${target.pathname}${target.search}`, init)
          : api.fetchImpl(url, init)
      }) as typeof fetch
      const waits: number[] = []
      const result = run('web', env(false), {
        fetchImpl,
        cwd: fixture,
        sleep: (ms) => {
          waits.push(ms)
          return Promise.resolve()
        },
      })
      return { result, waits, requests: () => requests }
    }

    it('retries a 200 whose connection drops part way through the body', async () => {
      const poll = await polls((response) => {
        response.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': '200',
        })
        response.write('{"id":"dpl_new","rea')
        // Flush the partial body, then cut the connection.
        setTimeout(() => response.socket?.destroy(), 20)
      })
      await expect(poll.result).resolves.toMatchObject({ id: 'dpl_new' })
      expect(poll.requests()).toBe(2)
      expect(poll.waits).toEqual([15_000])
    })

    it('does not retry a 200 whose body is not JSON', async () => {
      const poll = await polls((response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end('not json')
      })
      await expect(poll.result).rejects.toThrow(SyntaxError)
      expect(poll.requests()).toBe(1)
    })
  })

  it('stops before the job runs out, counting setup from the job start', async () => {
    const api = vercel([])
    const started = 1_000_000
    await expect(
      run(
        'web',
        { ...env(false), PREVIEW_JOB_STARTED_MS: String(started) },
        { fetchImpl: api.fetchImpl, cwd: fixture, now: () => started + 20 * 60_000 }
      )
    ).rejects.toThrow("Vercel GET /v2/teams/team-slug: the job's deadline passed")
    expect(api.calls).toEqual([])
  })
})

/**
 * Evaluates the GitHub Actions expression subset the preview caller uses: literals, context
 * paths, ==, !=, !, && and || with parentheses, contains(), fromJSON() and a ['key'] index.
 * Strings compare case-insensitively and && and || return an operand, as GitHub does.
 */
function evaluateExpression(source: string, context: Record<string, unknown>): unknown {
  const text = source.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1')
  const tokens: string[] = []
  const pattern = /\s*(\(|\)|\[|\]|,|==|!=|&&|\|\||!|'(?:[^']|'')*'|[A-Za-z_][\w.*-]*)/y
  while (pattern.lastIndex < text.trimEnd().length) {
    const match = pattern.exec(text)
    if (!match)
      throw new Error(`cannot read the expression at: ${text.slice(pattern.lastIndex)}`)
    tokens.push(match[1] as string)
  }
  let at = 0
  const take = (expected?: string) => {
    const token = tokens[at++]
    if (token === undefined || (expected && token !== expected))
      throw new Error(`expected ${expected ?? 'a value'} in: ${text}`)
    return token
  }
  const truthy = (value: unknown) =>
    !(
      value === false ||
      value === null ||
      value === undefined ||
      value === 0 ||
      value === ''
    )
  const equal = (a: unknown, b: unknown) =>
    typeof a === 'string' && typeof b === 'string'
      ? a.toLowerCase() === b.toLowerCase()
      : (a ?? null) === (b ?? null)
  // A ['key'] after a value reads that property, as GitHub's index syntax does.
  const primary = (): unknown => {
    let value = operand()
    while (tokens[at] === '[') {
      take('[')
      const key = or()
      take(']')
      value =
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)[String(key)]
          : undefined
    }
    return value
  }
  const operand = (): unknown => {
    const token = take()
    if (token === '(') {
      const value = or()
      take(')')
      return value
    }
    if (token.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'")
    if (token === 'true' || token === 'false') return token === 'true'
    if (token === 'null') return null
    if (token === 'contains' && tokens[at] === '(') {
      take('(')
      const haystack = or()
      take(',')
      const needle = or()
      take(')')
      if (Array.isArray(haystack)) return haystack.some((item) => equal(item, needle))
      if (typeof haystack === 'string' && typeof needle === 'string')
        return haystack.toLowerCase().includes(needle.toLowerCase())
      return false
    }
    if (token === 'fromJSON' && tokens[at] === '(') {
      take('(')
      const json = or()
      take(')')
      return JSON.parse(String(json))
    }
    if (/^[A-Za-z_][\w.*-]*$/.test(token) && tokens[at] !== '(') {
      // A `*` step collects that property from every element, as GitHub's object filter does.
      const lookup = (value: unknown, key: string) =>
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)[key]
          : undefined
      let spread = false
      return token.split('.').reduce<unknown>((value, key) => {
        if (key === '*') {
          spread = true
          return Array.isArray(value) ? (value as unknown[]) : []
        }
        return spread && Array.isArray(value)
          ? value.map((item) => lookup(item, key))
          : lookup(value, key)
      }, context)
    }
    throw new Error(`unsupported token ${token} in: ${text}`)
  }
  const comparison = (): unknown => {
    const left = primary()
    const operator = tokens[at]
    if (operator !== '==' && operator !== '!=') return left
    at++
    const same = equal(left, primary())
    return operator === '==' ? same : !same
  }
  const unary = (): unknown => {
    if (tokens[at] !== '!') return comparison()
    at++
    return !truthy(unary())
  }
  const and = (): unknown => {
    let value = unary()
    while (tokens[at] === '&&') {
      at++
      const right = unary()
      value = truthy(value) ? right : value
    }
    return value
  }
  const or = (): unknown => {
    let value = and()
    while (tokens[at] === '||') {
      at++
      const right = and()
      value = truthy(value) ? value : right
    }
    return value
  }
  const value = or()
  if (at !== tokens.length)
    throw new Error(`unread tokens after ${tokens[at - 1]} in: ${text}`)
  return truthy(value)
}

describe('Vercel preview PR trigger', () => {
  const caller = parseYaml(
    fs.readFileSync(
      path.join(repoRoot, '.github', 'workflows', 'pr-pw-e2e-vercel-preview.yml'),
      'utf8'
    )
  ) as { jobs: { 'preview-ready': { if: string; with: { force_build: string } } } }
  const job = caller.jobs['preview-ready']
  const repository = 'muratkeremozcan/couture-cast'
  const github = (fork: boolean, action: string, label: string, preview = true) => ({
    // The lanes job's plan: the preview lane runs when the diff touches a preview input.
    needs: { lanes: { outputs: { plan: JSON.stringify({ preview }) } } },
    github: {
      repository,
      event: {
        action,
        ...(label ? { label: { name: label } } : {}),
        pull_request: {
          head: { repo: { full_name: fork ? 'someone/couture-cast' : repository } },
          // The rebuild label stays on the PR in every case: only adding it may force.
          labels: [{ name: 'PREVIEW-REBUILD' }],
        },
      },
    },
  })
  const events: [string, string, boolean, boolean][] = [
    // action, label added ('' for none), runs for a same-repository PR, forces a fresh build
    ['opened', '', true, false],
    ['reopened', '', true, false],
    ['synchronize', '', true, false],
    ['labeled', 'PREVIEW', true, false],
    ['labeled', 'PREVIEW-REBUILD', true, true],
    ['labeled', 'needs-review', false, false],
  ]

  it.each(events)(
    "a same-repository %s event (label '%s') runs previews: %s, forces: %s",
    (action, label, runs, forces) => {
      expect(evaluateExpression(job.if, github(false, action, label))).toBe(runs)
      expect(evaluateExpression(job.with.force_build, github(false, action, label))).toBe(
        forces
      )
    }
  )

  // A plan that skips the preview lane provides no previews, unless PREVIEW-REBUILD was just
  // added, which builds them whatever the diff changed.
  it.each(events)(
    "a same-repository %s event (label '%s') with the preview lane skipped runs previews only for a rebuild",
    (action, label, runs, forces) => {
      expect(evaluateExpression(job.if, github(false, action, label, false))).toBe(
        runs && forces
      )
    }
  )

  // Fork PRs get no VERCEL_TOKEN, so they skip previews instead of failing on it.
  it.each(events)(
    "a fork %s event (label '%s') skips previews",
    (action, label, _runs, forces) => {
      expect(evaluateExpression(job.if, github(true, action, label))).toBe(false)
      expect(evaluateExpression(job.with.force_build, github(true, action, label))).toBe(
        forces
      )
    }
  )
})
