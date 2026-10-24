// Story 6.7b: the `tsx` entry, scripts/community-sponsorship.ts, run as the owner
// runs it. A remote target with no --confirm-target is refused before any
// connection, so this needs no database, and the refusal must reach the shell as
// a non-zero exit code.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../../..')

describe('scripts/community-sponsorship.ts', () => {
  it('6.7b-UNIT-043 exits 1 with the confirm-target refusal for a remote pooler URL in --env-file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'community-sponsorship-script-'))
    const envFile = join(directory, '.env.remote')
    writeFileSync(
      envFile,
      'DATABASE_URL="postgresql://postgres.abcdefghijklmnop:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres"\n'
    )
    try {
      const run = spawnSync(
        join(repoRoot, 'node_modules/.bin/tsx'),
        [
          '--tsconfig',
          'apps/api/tsconfig.json',
          'scripts/community-sponsorship.ts',
          'link',
          '--env-file',
          envFile,
          '--actor-email',
          'owner@example.com',
          '--post',
          'post-1',
          '--offer',
          'offer-1',
          '--reason',
          'owner_pick',
          '--author-agreement',
          'agr_01JB8Z2Q4M5N6P7R8S9T0V1W2X',
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          // A loopback ambient URL the command must ignore in favour of the file.
          env: {
            ...process.env,
            DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/ambient_target',
          },
        }
      )

      expect(run.error).toBeUndefined()
      expect(run.stderr).toContain(
        'community:sponsorship refused: DATABASE_URL targets remote project abcdefghijklmnop; pass --confirm-target abcdefghijklmnop to write to it.'
      )
      expect(run.stdout).toBe('')
      expect(run.status).toBe(1)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 60_000)
})
