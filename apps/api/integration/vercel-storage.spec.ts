import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ignoredBuildExitCode,
  previewRequired,
} from '../../../scripts/vercel-preview-inputs.mjs'

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
      expect(ignoredBuildExitCode({ VERCEL_ENV: 'preview' }, fixture)).toBe(0)
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
  ])('keeps deployments and exact-SHA checks for %s', (file) => {
    commit(file)
    expect(previewRequired(fixture, 'main')).toBe(true)
    expect(ignoredBuildExitCode({ VERCEL_ENV: 'preview' }, fixture)).toBe(1)
  })

  it('keeps an earlier API change when the latest commit changes only mobile', () => {
    commit('apps/api/src/main.ts')
    commit('apps/mobile/app/index.tsx')
    expect(previewRequired(fixture, 'main')).toBe(true)
    expect(ignoredBuildExitCode({ VERCEL_ENV: 'preview' }, fixture)).toBe(1)
  })

  it('keeps a build when history or the remote comparison is unavailable', () => {
    expect(previewRequired(fixture, 'missing-ref')).toBe(true)
    git('remote', 'remove', 'origin')
    expect(ignoredBuildExitCode({ VERCEL_ENV: 'preview' }, fixture)).toBe(1)
  })

  it.each([
    ['apps/mobile/app/index.tsx', 0],
    ['docs/guide.md', 0],
    ['_bmad-output/notes.md', 0],
    ['apps/api/src/main.ts', 1],
  ] as const)(
    'recovers shallow preview history before deciding for %s',
    (file, expected) => {
      commit(file, 'first change')
      commit(file, 'second change')
      const clone = path.join(fixture, 'shallow')
      git('clone', '--depth=1', '--branch=preview', pathToFileURL(fixture).href, clone)
      expect(
        ignoredBuildExitCode(
          { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'preview' },
          clone
        )
      ).toBe(expected)
    }
  )

  it.each(['production', 'development', undefined])('keeps %s builds', (environment) => {
    commit('apps/mobile/app/index.tsx')
    expect(ignoredBuildExitCode({ VERCEL_ENV: environment }, fixture)).toBe(1)
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
      'node ../../scripts/vercel-preview-inputs.mjs --ignore'
    )
    expect(web.ignoreCommand).toBe(api.ignoreCommand)
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
