// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ownedDatabase =
  'postgresql://postgres:postgres@127.0.0.1:54322/tea_community_11111111111111111111111111111111'

describe('Story68 API entry without an API build', () => {
  it('names the missing build instead of failing on a module path', () => {
    // A copy of the entry inside the repository resolves node_modules from the root, and its
    // relative apps/api/dist does not exist.
    const scratch = mkdtempSync(path.join(root, '.story68-api-entry-'))
    try {
      mkdirSync(path.join(scratch, 'scripts/lib'), { recursive: true })
      const entry = path.join(scratch, 'scripts/lib/story68-api-entry.mjs')
      copyFileSync(path.join(root, 'scripts/lib/story68-api-entry.mjs'), entry)
      const result = spawnSync(process.execPath, [entry], {
        cwd: root,
        env: { ...process.env, CC68_EXPECTED_DATABASE_URL: ownedDatabase },
        encoding: 'utf8',
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('api_build_missing')
      expect(result.stderr).toContain('npm run build --workspace api')
      expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})

describe('Story68 API origin guard', () => {
  beforeAll(() => {
    // These cases start the built API entry. CI builds it in the runtime step first
    // (scripts/ci/node-test-suites.json: vitest needs runtime); locally, build it once.
    expect(
      existsSync(path.join(root, 'apps/api/dist/src/load-env.js')),
      'apps/api is not built: run npm run build --workspace api, then rerun this file'
    ).toBe(true)
  })
  it('refuses a non-owned expected database before API import or startup writes', () => {
    const result = spawnSync(process.execPath, ['scripts/lib/story68-api-entry.mjs'], {
      cwd: root,
      env: {
        ...process.env,
        CC68_EXPECTED_DATABASE_URL:
          'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      },
      encoding: 'utf8',
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('owned_database_required')
    expect(result.stdout).not.toContain('Starting Nest application')
    expect(result.stdout).not.toContain('feature_flags_synced')
  })
  it('refuses an effective URL mismatch after env loading and before AppModule import', () => {
    const expected =
      'postgresql://postgres:postgres@127.0.0.1:54322/tea_community_11111111111111111111111111111111'
    const result = spawnSync(process.execPath, ['scripts/lib/story68-api-entry.mjs'], {
      cwd: root,
      env: {
        ...process.env,
        TEST_ENV: 'local',
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
        CC68_EXPECTED_DATABASE_URL: expected,
        E2E_CALLER_OWNED_ENV_KEYS: 'DATABASE_URL,CC68_EXPECTED_DATABASE_URL',
      },
      encoding: 'utf8',
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('effective_database_mismatch')
    expect(result.stdout).not.toContain('Starting Nest application')
    expect(result.stdout).not.toContain('feature_flags_synced')
  })
})
