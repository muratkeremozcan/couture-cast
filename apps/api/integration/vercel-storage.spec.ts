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
  previewDeployment,
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
    ccPreviewInputs: 'inputs-1',
    ccPreviewConfig: 'config-1',
    ...overrides,
  })
  const created50: Deployment = { id: 'dpl_new', url: 'built.example', created: 50 }
  function deploy(
    listed: Deployment[][],
    states: Deployment[] = [{ readyState: 'READY', url: 'built.example' }],
    options: {
      create?: (body: Record<string, unknown>) => Promise<Deployment>
      attempts?: number
      force?: boolean
    } = {}
  ) {
    let polls = 0
    let lists = 0
    const created: Record<string, unknown>[] = []
    const canceled: string[] = []
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
      list: () => Promise.resolve(listed[Math.min(lists++, listed.length - 1)] ?? []),
      create: (body) => {
        created.push(body)
        return options.create ? options.create(body) : Promise.resolve(created50)
      },
      get: (id) => {
        polled.push(id)
        return Promise.resolve(states[Math.min(polls++, states.length - 1)]!)
      },
      cancel: (id) => {
        canceled.push(id)
        return Promise.resolve({})
      },
      sleep: () => Promise.resolve(),
      attempts: options.attempts ?? 5,
    })
    return { result, created, canceled, polled }
  }
  const createBody = {
    name: 'couture-cast-web',
    project: 'prj_web',
    gitSource: { type: 'github', repoId: 42, ref: 'feature', sha },
    meta: { ccPreviewInputs: 'inputs-1', ccPreviewConfig: 'config-1' },
  }

  it('reuses the newest ready deployment built from the same inputs and configuration', async () => {
    const run = deploy([
      [
        {
          uid: 'dpl_old',
          url: 'old.example',
          readyState: 'READY',
          created: 1,
          meta: meta(),
        },
        {
          uid: 'dpl_new',
          url: 'new.example',
          readyState: 'READY',
          created: 2,
          meta: meta(),
        },
      ],
    ])
    await expect(run.result).resolves.toEqual({
      id: 'dpl_new',
      url: 'https://new.example',
      sha: older,
      reused: true,
    })
    expect(run.created).toEqual([])
    expect(run.canceled).toEqual([])
  })

  it('reuses a ready deployment of the commit itself', async () => {
    const same = meta({ githubCommitSha: sha })
    await expect(
      deploy([[{ uid: 'dpl_same', url: 'same.example', state: 'READY', meta: same }]])
        .result
    ).resolves.toMatchObject({ id: 'dpl_same', sha, reused: true })
  })

  it('adopts a build already running for the same inputs instead of creating another', async () => {
    const running = {
      uid: 'dpl_running',
      url: 'running.example',
      state: 'BUILDING',
      meta: meta(),
    }
    const run = deploy(
      [[running]],
      [{ readyState: 'BUILDING' }, { readyState: 'READY', url: 'running.example' }]
    )
    await expect(run.result).resolves.toEqual({
      id: 'dpl_running',
      url: 'https://running.example',
      sha: older,
      reused: true,
    })
    expect(run.created).toEqual([])
    expect(run.polled).toEqual(['dpl_running', 'dpl_running'])
  })

  it('cancels its own superseded builds of other inputs before creating', async () => {
    const stale = meta({ ccPreviewInputs: 'inputs-0' })
    const foreign = { githubCommitRef: 'feature', githubCommitSha: older }
    const run = deploy([
      [
        { uid: 'dpl_stale', url: 's.example', state: 'QUEUED', meta: stale },
        { uid: 'dpl_done', url: 'd.example', state: 'READY', meta: stale },
        { uid: 'dpl_foreign', url: 'f.example', state: 'BUILDING', meta: foreign },
      ],
    ])
    await expect(run.result).resolves.toMatchObject({ id: 'dpl_new', sha, reused: false })
    expect(run.canceled).toEqual(['dpl_stale'])
    expect(run.created).toEqual([createBody])
  })

  it('keeps the older of two builds that racing runs created for the same inputs', async () => {
    const same = meta({ githubCommitSha: sha })
    const twin = {
      uid: 'dpl_twin',
      url: 'twin.example',
      state: 'BUILDING',
      created: 10,
      meta: same,
    }
    const own = {
      uid: 'dpl_new',
      url: 'built.example',
      state: 'QUEUED',
      created: 50,
      meta: same,
    }
    const run = deploy([[], [twin, own]], [{ readyState: 'READY', url: 'twin.example' }])
    await expect(run.result).resolves.toMatchObject({
      id: 'dpl_twin',
      url: 'https://twin.example',
    })
    expect(run.canceled).toEqual(['dpl_new'])
    expect(run.polled).toEqual(['dpl_twin'])
  })

  it('keeps its own build when it is the older of two', async () => {
    const later = {
      uid: 'dpl_later',
      url: 'l.example',
      state: 'QUEUED',
      created: 90,
      meta: meta(),
    }
    const run = deploy([[], [later]])
    await expect(run.result).resolves.toMatchObject({ id: 'dpl_new' })
    expect(run.canceled).toEqual([])
  })

  it('builds fresh when forced, canceling its own builds still running', async () => {
    const run = deploy(
      [
        [
          { uid: 'dpl_ready', url: 'r.example', state: 'READY', meta: meta() },
          { uid: 'dpl_running', url: 'b.example', state: 'BUILDING', meta: meta() },
        ],
      ],
      undefined,
      { force: true }
    )
    await expect(run.result).resolves.toMatchObject({ id: 'dpl_new', reused: false })
    expect(run.canceled).toEqual(['dpl_running'])
    expect(run.created).toEqual([createBody])
  })

  it.each([
    [
      'other inputs',
      { readyState: 'READY', meta: meta({ ccPreviewInputs: 'inputs-0' }) },
    ],
    [
      'other configuration',
      { readyState: 'READY', meta: meta({ ccPreviewConfig: 'config-0' }) },
    ],
    ['another branch', { readyState: 'READY', meta: meta({ githubCommitRef: 'other' }) }],
    [
      'a deployment this script did not create',
      {
        readyState: 'READY',
        meta: { githubCommitRef: 'feature', githubCommitSha: older },
      },
    ],
    [
      'a canceled deployment',
      { readyState: 'CANCELED', meta: meta({ githubCommitSha: sha }) },
    ],
  ])('builds the commit instead of reusing %s', async (_label, candidate) => {
    const run = deploy(
      [[{ uid: 'dpl_candidate', url: 'candidate.example', ...candidate }]],
      [
        { readyState: 'QUEUED' },
        { readyState: 'BUILDING' },
        { readyState: 'READY', url: 'built.example' },
      ]
    )
    await expect(run.result).resolves.toEqual({
      id: 'dpl_new',
      url: 'https://built.example',
      sha,
      reused: false,
    })
    expect(run.created).toEqual([createBody])
    expect(run.polled).toHaveLength(3)
  })

  it.each(['ERROR', 'CANCELED'])('fails when the build ends %s', async (state) => {
    await expect(
      deploy([[]], [{ readyState: state, readyStateReason: 'Build failed' }]).result
    ).rejects.toThrow(`web: deployment dpl_new for ${sha} ended ${state}: Build failed`)
  })

  it('fails when Vercel refuses the deployment', async () => {
    const refused = new Error(
      'Vercel POST /v13/deployments answered 429: Deployment rate limited'
    )
    await expect(
      deploy([[]], [], { create: () => Promise.reject(refused) }).result
    ).rejects.toThrow('answered 429: Deployment rate limited')
  })

  it('fails when the build never finishes', async () => {
    await expect(
      deploy([[]], [{ readyState: 'BUILDING' }], { attempts: 3 }).result
    ).rejects.toThrow(`web: deployment dpl_new for ${sha} is still BUILDING after`)
  })

  it('gives each project its own 20 minute job with room beyond its polling', () => {
    const workflow = fs.readFileSync(
      path.join(repoRoot, '.github/workflows/rwf-vercel-preview-ready.yml'),
      'utf8'
    )
    expect(workflow.match(/timeout-minutes: 20/g)).toHaveLength(2)
    expect(workflow).toContain('  deploy-web:')
    expect(workflow).toContain('  deploy-api:')
  })
})
