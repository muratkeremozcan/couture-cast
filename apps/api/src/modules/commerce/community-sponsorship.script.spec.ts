// Story 6.7b: the `tsx` entry, scripts/community-sponsorship.ts, run as the owner
// runs it. A remote target with no --confirm-target is refused before any
// connection, so this needs no database, and the refusal must reach the shell as
// a non-zero exit code.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../../..')

/**
 * The child runs without this suite's Vitest aliases, so it loads `@couture/*`
 * from each package's built `dist`, exactly as `npm run community:sponsorship`
 * does. These are the entry files that command graph resolves.
 */
const REQUIRED_DIST_ENTRIES = [
  'packages/api-client/dist/index.js',
  'packages/api-client/dist/contracts/http/index.js',
  'packages/config/dist/index.js',
  'packages/utils/dist/index.js',
]

/** Supabase's 20-character project ref, read from the pooler username. */
const PROJECT_REF = 'abcdefghijklmnopqrst'

describe('scripts/community-sponsorship.ts', () => {
  it('6.7b-UNIT-043 exits 1 with the confirm-target refusal for a remote pooler URL in --env-file', () => {
    const missing = REQUIRED_DIST_ENTRIES.filter(
      (entry) => !existsSync(join(repoRoot, entry))
    )
    expect(
      missing,
      'Shared package builds are missing. Build them first: npm run build --workspace @couture/utils --workspace @couture/config --workspace @couture/api-client'
    ).toEqual([])

    const directory = mkdtempSync(join(tmpdir(), 'community-sponsorship-script-'))
    const envFile = join(directory, '.env.remote')
    // The pooler username form the target parser reads, on an RFC 6761
    // `.invalid` host, so a regressed refusal can never reach a real server.
    writeFileSync(
      envFile,
      `DATABASE_URL="postgresql://postgres.${PROJECT_REF}:secret@aws-0-eu-west-1.pooler.invalid:6543/postgres"\n`
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
          // Below the test timeout, so a hung child fails here with a reason.
          timeout: 30_000,
          // A loopback ambient URL the command must ignore in favour of the file.
          env: {
            ...process.env,
            DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/ambient_target',
          },
        }
      )

      expect(run.error, 'the child failed to start or hit the 30 s timeout').toBe(
        undefined
      )
      expect(run.signal, 'the child was killed').toBeNull()
      expect(run.stderr).toContain(
        `community:sponsorship refused: DATABASE_URL targets remote project ${PROJECT_REF}; pass --confirm-target ${PROJECT_REF} to write to it.`
      )
      expect(run.stdout).toBe('')
      expect(run.status).toBe(1)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 60_000)
})
