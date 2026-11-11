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
      for (const project of projects)
        expect(ignoredBuildExitCode({ VERCEL_ENV: 'preview' }, fixture, project)).toBe(0)
    }
  )

  // Each project builds from the repository less the other app and the paths no build reads;
  // the exact-SHA preview checks still run for every one of these.
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
  ] as const)('a branch changing %s builds %o', (file, expected) => {
    commit(file)
    expect(previewRequired(fixture, 'main')).toBe(true)
    for (const project of projects)
      expect(
        ignoredBuildExitCode({ VERCEL_ENV: 'preview' }, fixture, project),
        project
      ).toBe(expected[project])
  })

  it('names the change that requires a build', () => {
    commit('apps/api/src/main.ts')
    expect(ignoredBuildDecision({ VERCEL_ENV: 'preview' }, fixture, 'api')).toEqual({
      code: 1,
      reason: 'changed apps/api/src/main.ts',
    })
    const web = ignoredBuildDecision({ VERCEL_ENV: 'preview' }, fixture, 'web')
    expect(web.code).toBe(0)
    expect(web.reason).toMatch(/^no input changed since [a-f0-9]{40}$/)
  })

  it.each([undefined, '', 'mobile'])('keeps the build for project %j', (project) => {
    commit('docs/guide.md')
    expect(ignoredBuildDecision({ VERCEL_ENV: 'preview' }, fixture, project)).toEqual({
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

  it('keeps an earlier API change when the latest commit changes only mobile', () => {
    commit('apps/api/src/main.ts')
    commit('apps/mobile/app/index.tsx')
    expect(previewRequired(fixture, 'main')).toBe(true)
    expect(ignoredBuildExitCode({ VERCEL_ENV: 'preview' }, fixture, 'api')).toBe(1)
  })

  it('keeps a build when history or the remote comparison is unavailable', () => {
    expect(previewRequired(fixture, 'missing-ref')).toBe(true)
    git('remote', 'remove', 'origin')
    const web = ignoredBuildDecision({ VERCEL_ENV: 'preview' }, fixture, 'web')
    expect(web.code).toBe(1)
    expect(web.reason).toMatch(/^main unavailable \(fetch origin: exit 128: fatal: /)
  })

  it('fetches main from the public repository when the clone has no usable origin', () => {
    commit('docs/guide.md')
    const clone = path.join(fixture, 'clone')
    git('clone', '--depth=1', '--branch=preview', pathToFileURL(fixture).href, clone)
    execFileSync(
      'git',
      ['remote', 'set-url', 'origin', 'https://invalid.invalid/repo.git'],
      {
        cwd: clone,
      }
    )
    // The public URL is built from Vercel's repository variables; a file URL stands in for
    // github.com through git's insteadOf rewrite.
    execFileSync(
      'git',
      [
        'config',
        `url.${pathToFileURL(fixture).href}.insteadOf`,
        'https://github.com/owner/repo.git',
      ],
      { cwd: clone }
    )
    const env = {
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'preview',
      VERCEL_GIT_PROVIDER: 'github',
      VERCEL_GIT_REPO_OWNER: 'owner',
      VERCEL_GIT_REPO_SLUG: 'repo',
    }
    for (const project of projects)
      expect(ignoredBuildExitCode(env, clone, project), project).toBe(0)
    expect(
      ignoredBuildExitCode({ ...env, VERCEL_GIT_PROVIDER: undefined }, clone, 'web')
    ).toBe(1)
  })

  it.each([
    ['apps/mobile/app/index.tsx', { web: 0, api: 0 }],
    ['docs/guide.md', { web: 0, api: 0 }],
    ['_bmad-output/notes.md', { web: 0, api: 0 }],
    ['apps/api/src/main.ts', { web: 0, api: 1 }],
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

  it('connects both projects and CI to the same preview decision', () => {
    const api = readVercelConfig('api')
    const web = readVercelConfig('web')
    expect(api.ignoreCommand).toBe(
      'node ../../scripts/vercel-preview-inputs.mjs --ignore api'
    )
    expect(web.ignoreCommand).toBe(
      'node ../../scripts/vercel-preview-inputs.mjs --ignore web'
    )
    const caller = fs.readFileSync(
      path.join(repoRoot, '.github/workflows/pr-pw-e2e-vercel-preview.yml'),
      'utf8'
    )
    const workflow = fs.readFileSync(
      path.join(repoRoot, '.github/workflows/rwf-vercel-preview-ready.yml'),
      'utf8'
    )
    expect(workflow).toContain('fetch-depth: 0')
    expect(workflow).toContain('run: node scripts/vercel-preview-inputs.mjs')
    expect(workflow).toContain("if: needs.preview-scope.outputs.required == 'true'")
    expect(caller).toContain("if: needs.preview-ready.outputs.required == 'true'")
    expect(caller).toContain('expected_sha: ${{ github.event.pull_request.head.sha }}')
    const manual = fs.readFileSync(
      path.join(repoRoot, '.github/workflows/pw-e2e-trigger.yml'),
      'utf8'
    )
    expect(manual).toContain("needs.preview-ready.outputs.required == 'true'")
    expect(manual).toContain(
      "inputs.custom_base_url != '' || inputs.custom_api_base_url != ''"
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
