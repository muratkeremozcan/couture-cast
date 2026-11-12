import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
  it.each(['apps/mobile/app/index.tsx', 'docs/guide.md', '_bmad-output/notes.md'])(
    'needs no preview deployment for a branch changing only %s',
    (file) => {
      commit(file)
      expect(previewRequired(fixture, 'main')).toBe(false)
    }
  )

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
  // whose origin/main is a baseline commit that already holds the copy.
  it('an explicit request requires previews that the branch alone would skip', () => {
    const cli = path.join(fixture, 'scripts/vercel-preview-inputs.mjs')
    fs.mkdirSync(path.dirname(cli), { recursive: true })
    fs.copyFileSync(path.join(repoRoot, 'scripts/vercel-preview-inputs.mjs'), cli)
    git('add', '--', 'scripts/vercel-preview-inputs.mjs')
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
    expect(caller).toContain(
      "force_build: ${{ contains(github.event.pull_request.labels.*.name, 'PREVIEW-REBUILD') }}"
    )
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
    states: Deployment[] = [{ id: 'dpl_new', readyState: 'READY', url: 'built.example' }],
    options: {
      create?: () => Promise<Deployment>
      force?: boolean
      deadlineMs?: number
    } = {}
  ) {
    let clock = 0
    let polls = 0
    const created: { body: Record<string, unknown>; force: boolean }[] = []
    const polled: string[] = []
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
        clock += ms
        return Promise.resolve()
      },
      list: () => Promise.resolve(list),
      create: (body, force) => {
        created.push({ body, force })
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
        return Promise.resolve(states[Math.min(polls++, states.length - 1)]!)
      },
    })
    return { result, created, polled }
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
    expect(run.created).toEqual([{ body: createBody, force: false }])
    expect(run.polled).toEqual(['dpl_new', 'dpl_new', 'dpl_new'])
  })

  it('builds fresh when forced, adopting nothing', async () => {
    const run = deploy(
      [listed('dpl_ready', 'READY', 1), listed('dpl_running', 'BUILDING', 2)],
      undefined,
      { force: true }
    )
    await expect(run.result).resolves.toMatchObject({ id: 'dpl_new', reused: false })
    expect(run.created).toEqual([{ body: createBody, force: true }])
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
  function vercel(deployments: Deployment[]) {
    const calls: Call[] = []
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

  it.each([
    [false, '/v13/deployments?teamId=team_1'],
    [true, '/v13/deployments?forceNew=1&teamId=team_1'],
  ])(
    'creates through the real request (force %s) and never cancels',
    async (force, createPath) => {
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
        path: createPath,
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
