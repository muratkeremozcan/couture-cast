import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ignoredBuildDecision,
  ignoredBuildExitCode,
  previewRequired,
  projectBuildPaths,
} from '../../../scripts/vercel-preview-inputs.mjs'
import {
  IGNORED_DESCRIPTION,
  previewTarget,
  type CommitStatus,
  type ReadyDeployment,
} from '../../../scripts/vercel-preview-target.mjs'

const projects = ['web', 'api'] as const

const repoRoot = path.resolve(__dirname, '../../..')
const vercelConfig = z.object({
  ignoreCommand: z.string(),
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

const head = () => git('rev-parse', 'HEAD')
const preview = (previous?: string) => ({
  VERCEL_ENV: 'preview',
  ...(previous ? { VERCEL_GIT_PREVIOUS_SHA: previous } : {}),
})

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
    'skips both preview projects for a branch changing only %s',
    (file) => {
      commit(file)
      expect(previewRequired(fixture, 'main')).toBe(false)
      for (const project of projects) {
        const decision = ignoredBuildDecision(preview(), fixture, project)
        expect(decision.code).toBe(0)
        expect(decision.reason).toMatch(
          /^no preview check reads this branch \(no input changed since [a-f0-9]{40}\)$/
        )
      }
    }
  )

  // Each project builds from the repository less the other app and the paths no build reads;
  // a later commit skips a project whose inputs it leaves alone, since the branch's last
  // deployment of that project stands in for it. The exact-SHA preview checks still run.
  it.each([
    ['apps/api/src/main.ts', { web: 0, api: 1 }],
    ['apps/api/api/realtime.ts', { web: 0, api: 1 }],
    ['apps/api/vercel.json', { web: 0, api: 1 }],
    ['apps/web/src/app/page.tsx', { web: 1, api: 0 }],
    ['apps/web/vercel.json', { web: 1, api: 0 }],
    ['packages/utils/src/index.ts', { web: 1, api: 1 }],
    ['packages/db/prisma/schema.prisma', { web: 1, api: 1 }],
    ['package-lock.json', { web: 1, api: 1 }],
    ['package.json', { web: 1, api: 1 }],
    ['turbo.json', { web: 1, api: 1 }],
    ['scripts/build.mjs', { web: 1, api: 1 }],
    ['new-runtime/input.json', { web: 1, api: 1 }],
    ['playwright/tests/flow.spec.ts', { web: 0, api: 0 }],
    ['.github/workflows/pr-checks.yml', { web: 0, api: 0 }],
    ['maestro/flow.yaml', { web: 0, api: 0 }],
    ['k6/load.js', { web: 0, api: 0 }],
    ['pact/contract.json', { web: 0, api: 0 }],
    ['apps/mobile/app/index.tsx', { web: 0, api: 0 }],
    ['docs/guide.md', { web: 0, api: 0 }],
  ] as const)('a later commit changing %s builds %o', (file, expected) => {
    commit('apps/api/src/main.ts', 'first branch change')
    const previous = head()
    commit(file, 'second branch change')
    for (const project of projects)
      expect(ignoredBuildExitCode(preview(previous), fixture, project), project).toBe(
        expected[project]
      )
  })

  it('builds every project on its first deployment of a branch that preview checks read', () => {
    commit('apps/api/src/main.ts')
    for (const project of projects)
      expect(ignoredBuildDecision(preview(), fixture, project)).toEqual({
        code: 1,
        reason: `no earlier ${project} deployment of this branch; preview checks run (changed apps/api/src/main.ts)`,
      })
  })

  it('names the change that requires a build and the deployment that stands in', () => {
    commit('apps/api/src/main.ts', 'first')
    const previous = head()
    commit('apps/api/src/main.ts', 'second')
    expect(ignoredBuildDecision(preview(previous), fixture, 'api')).toEqual({
      code: 1,
      reason: `changed apps/api/src/main.ts since ${previous}`,
    })
    expect(ignoredBuildDecision(preview(previous), fixture, 'web')).toEqual({
      code: 0,
      reason: `no web input changed since ${previous}, the branch's last web deployment`,
    })
  })

  it('compares with the last deployment, so an earlier change it already serves is not rebuilt', () => {
    const base = head()
    commit('apps/api/src/main.ts')
    const deployed = head()
    commit('apps/mobile/app/index.tsx')
    expect(previewRequired(fixture, 'main')).toBe(true)
    expect(ignoredBuildExitCode(preview(deployed), fixture, 'api')).toBe(0)
    // A deployment from before the API change cannot stand in for it.
    expect(ignoredBuildDecision(preview(base), fixture, 'api')).toEqual({
      code: 1,
      reason: `changed apps/api/src/main.ts since ${base}`,
    })
  })

  it.each([undefined, '', 'mobile'])('keeps the build for project %j', (project) => {
    commit('docs/guide.md')
    expect(ignoredBuildDecision(preview(), fixture, project)).toEqual({
      code: 1,
      reason: `unknown project ${JSON.stringify(project)}`,
    })
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

  it('keeps a build when main, history or the earlier deployment is unavailable', () => {
    expect(previewRequired(fixture, 'missing-ref')).toBe(true)
    commit('apps/api/src/main.ts')
    const previous = head()
    commit('apps/api/src/main.ts', 'again')
    git('remote', 'remove', 'origin')
    const web = ignoredBuildDecision(preview(), fixture, 'web')
    expect(web.code).toBe(1)
    expect(web.reason).toMatch(
      /^no earlier web deployment of this branch; main unavailable \(fetch origin: exit 128: fatal: /
    )
    const missing = 'a'.repeat(40)
    const gone = ignoredBuildDecision(preview(missing), fixture, 'web')
    expect(gone.code).toBe(1)
    expect(gone.reason).toMatch(
      new RegExp(`^commit ${missing} unavailable \\(fetch origin: `)
    )
    // A commit the clone already holds needs no remote.
    expect(ignoredBuildExitCode(preview(previous), fixture, 'web')).toBe(0)
  })

  // Vercel's clone has no remote and ten commits of history (probe, 2026-11-12); main and the
  // earlier deployment's commit come from the public repository Vercel names.
  function vercelClone() {
    const clone = path.join(fixture, 'clone')
    git('clone', '--depth=1', '--branch=preview', pathToFileURL(fixture).href, clone)
    execFileSync('git', ['remote', 'remove', 'origin'], { cwd: clone })
    // A file URL stands in for github.com through git's insteadOf rewrite.
    execFileSync(
      'git',
      [
        'config',
        `url.${pathToFileURL(fixture).href}.insteadOf`,
        'https://github.com/owner/repo.git',
      ],
      { cwd: clone }
    )
    return clone
  }
  const vercelEnv = {
    VERCEL_ENV: 'preview',
    VERCEL_GIT_COMMIT_REF: 'preview',
    VERCEL_GIT_PROVIDER: 'github',
    VERCEL_GIT_REPO_OWNER: 'owner',
    VERCEL_GIT_REPO_SLUG: 'repo',
  }

  it('fetches main from the public repository when the clone has no remote', () => {
    commit('docs/guide.md')
    const clone = vercelClone()
    for (const project of projects)
      expect(ignoredBuildExitCode(vercelEnv, clone, project), project).toBe(0)
    expect(
      ignoredBuildExitCode({ ...vercelEnv, VERCEL_GIT_PROVIDER: undefined }, clone, 'web')
    ).toBe(1)
  })

  it('fetches the earlier deployment commit from the public repository', () => {
    commit('apps/api/src/main.ts', 'first')
    const previous = head()
    commit('apps/web/src/app/page.tsx')
    commit('apps/api/src/main.ts', 'second')
    const clone = vercelClone()
    const env = { ...vercelEnv, VERCEL_GIT_PREVIOUS_SHA: previous }
    expect(ignoredBuildDecision(env, clone, 'api')).toEqual({
      code: 1,
      reason: `changed apps/api/src/main.ts since ${previous}`,
    })
    expect(ignoredBuildDecision(env, clone, 'web')).toEqual({
      code: 1,
      reason: `changed apps/web/src/app/page.tsx since ${previous}`,
    })
  })

  it.each([
    ['apps/mobile/app/index.tsx', { web: 0, api: 0 }],
    ['docs/guide.md', { web: 0, api: 0 }],
    ['_bmad-output/notes.md', { web: 0, api: 0 }],
    ['apps/api/src/main.ts', { web: 1, api: 1 }],
  ] as const)(
    'recovers shallow preview history before deciding for %s',
    (file, expected) => {
      commit(file, 'first change')
      commit(file, 'second change')
      const clone = path.join(fixture, 'shallow')
      git('clone', '--depth=1', '--branch=preview', pathToFileURL(fixture).href, clone)
      for (const project of projects)
        expect(
          ignoredBuildExitCode(
            { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'preview' },
            clone,
            project
          ),
          project
        ).toBe(expected[project])
    }
  )

  it.each(['production', 'development', undefined])('keeps %s builds', (environment) => {
    commit('apps/mobile/app/index.tsx')
    for (const project of projects)
      expect(ignoredBuildExitCode({ VERCEL_ENV: environment }, fixture, project)).toBe(1)
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

  it('connects both projects, the preview wait and the e2e run to the same decision', () => {
    const api = readVercelConfig('api')
    const web = readVercelConfig('web')
    expect(api.ignoreCommand).toBe(
      'node ../../scripts/vercel-preview-inputs.mjs --ignore api'
    )
    expect(web.ignoreCommand).toBe(
      'node ../../scripts/vercel-preview-inputs.mjs --ignore web'
    )
    const read = (file: string) =>
      fs.readFileSync(path.join(repoRoot, '.github/workflows', file), 'utf8')
    const caller = read('pr-pw-e2e-vercel-preview.yml')
    const workflow = read('rwf-vercel-preview-ready.yml')
    expect(workflow).toContain('fetch-depth: 0')
    expect(workflow).toContain('run: node scripts/vercel-preview-inputs.mjs')
    expect(workflow).toContain('run: node scripts/vercel-preview-target.mjs web')
    expect(workflow).toContain('run: node scripts/vercel-preview-target.mjs api')
    expect(workflow).toContain(
      'expected_sha: ${{ needs.preview-targets.outputs.web_sha }}'
    )
    expect(workflow).toContain(
      'expected_sha: ${{ needs.preview-targets.outputs.api_sha }}'
    )
    expect(workflow).toContain("if: needs.preview-scope.outputs.required == 'true'")
    expect(caller).toContain("if: needs.preview-ready.outputs.required == 'true'")
    expect(caller).toContain('expected_sha: ${{ github.event.pull_request.head.sha }}')
    expect(caller).toContain(
      'expected_web_sha: ${{ needs.preview-ready.outputs.web_sha }}'
    )
    expect(read('rwf-e2e.yml')).toContain(
      'EXPECTED_WEB_SHA: ${{ inputs.expected_web_sha || steps.expected_sha.outputs.sha }}'
    )
    const manual = read('pw-e2e-trigger.yml')
    expect(manual).toContain("needs.preview-ready.outputs.required == 'true'")
    expect(manual).toContain(
      "inputs.custom_base_url != '' || inputs.custom_api_base_url != ''"
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

describe('Vercel preview target', () => {
  const slug = 'couture-cast-web'
  const context = `Vercel – ${slug}`
  const status = (state: string, description: string | null = null): CommitStatus => ({
    context,
    state,
    description,
  })
  function target(
    expectedSha: string,
    statuses: CommitStatus[][],
    ready: ReadyDeployment[] = [],
    attempts = 5
  ) {
    let call = 0
    const sleeps: number[] = []
    const result = previewTarget({
      project: 'web',
      projectSlug: slug,
      expectedSha,
      cwd: fixture,
      statuses: () => Promise.resolve(statuses[Math.min(call++, statuses.length - 1)]!),
      readyDeployments: () => Promise.resolve(ready),
      sleep: (ms) => {
        sleeps.push(ms)
        return Promise.resolve()
      },
      attempts,
    })
    return { result, sleeps }
  }

  it('waits for the commit itself once Vercel built it', async () => {
    commit('apps/web/src/app/page.tsx')
    await expect(
      target(head(), [[status('success', 'Deployment has completed')]]).result
    ).resolves.toEqual({ sha: head(), reason: `${context} built ${head()}` })
  })

  it('stands in the latest ready deployment with the same inputs for an ignored build', async () => {
    commit('apps/web/src/app/page.tsx', 'web')
    const older = head()
    commit('apps/web/src/app/page.tsx', 'web again')
    const standIn = head()
    commit('apps/api/src/main.ts')
    const expected = head()
    const { result, sleeps } = target(
      expected,
      [
        [],
        [status('pending')],
        [status('success', IGNORED_DESCRIPTION), status('pending')],
      ],
      [
        { sha: older, url: 'https://older.example', created: 1 },
        { sha: standIn, url: 'https://stand-in.example', created: 2 },
      ]
    )
    await expect(result).resolves.toEqual({
      sha: standIn,
      reason: `${context} skipped ${expected}; ${standIn} has the same web inputs`,
    })
    expect(sleeps).toHaveLength(2)
  })

  it('refuses a stand-in whose inputs differ', async () => {
    const before = head()
    commit('apps/web/src/app/page.tsx')
    const expected = head()
    await expect(
      target(
        expected,
        [[status('success', IGNORED_DESCRIPTION)]],
        [{ sha: before, url: 'https://before.example', created: 1 }]
      ).result
    ).rejects.toThrow(
      `${context} skipped ${expected}, but web inputs changed since its latest ready deployment ${before}: apps/web/src/app/page.tsx`
    )
  })

  it('refuses an ignored build when the branch has no ready deployment', async () => {
    commit('apps/api/src/main.ts')
    await expect(
      target(
        head(),
        [[status('success', IGNORED_DESCRIPTION)]],
        [{ sha: head(), url: 'https://same.example', created: 1 }]
      ).result
    ).rejects.toThrow('but this branch has no ready web deployment to stand in')
  })

  it.each([
    ['failure', 'Deployment rate limited — retry in 24 hours'],
    ['error', 'Deployment has failed'],
  ])('fails on a %s status: %s', async (state, description) => {
    await expect(target(head(), [[status(state, description)]]).result).rejects.toThrow(
      `${context} for ${head()} reported ${state}: ${description}`
    )
  })

  it('fails when Vercel never reports a final status', async () => {
    const { result, sleeps } = target(head(), [[status('pending')]], [], 3)
    await expect(result).rejects.toThrow(
      `${context} for ${head()} is still pending after`
    )
    expect(sleeps).toHaveLength(2)
  })

  it('reads only its own project and the newest status', async () => {
    await expect(
      target(head(), [
        [
          {
            context: 'Vercel – couture-cast-api',
            state: 'failure',
            description: 'other',
          },
          status('success', 'Deployment has completed'),
          status('failure', 'an older attempt'),
        ],
      ]).result
    ).resolves.toMatchObject({ sha: head() })
  })
})
