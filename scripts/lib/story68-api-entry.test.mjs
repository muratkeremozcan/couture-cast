// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
describe('Story68 API origin guard', () => {
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
