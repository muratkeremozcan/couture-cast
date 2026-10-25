// Story 6.7b: the `tsx` entry, scripts/community-sponsorship.ts, run as the owner
// runs it. A remote target with no --confirm-target is refused before any
// connection, so this needs no database, and the refusal must reach the shell as
// a non-zero exit code.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../../..')

/** Supabase's 20-character project ref, read from the pooler username. */
const PROJECT_REF = 'abcdefghijklmnopqrst'

/**
 * The child runs without this suite's Vitest aliases. Left alone it would load
 * `@couture/*` from each package's built `dist`, so the test would depend on a
 * build step and break while another process rebuilds one. This tsconfig extends
 * the API's own and maps the packages to source, the same mapping
 * apps/api/vitest.config.ts applies. get-tsconfig refuses absolute `paths`
 * without a baseUrl, so each target is relative to the tsconfig's directory.
 */
function sourceMappedTsconfig(directory: string): string {
  const root = relative(directory, repoRoot)
  const path = join(directory, 'tsconfig.source.json')
  writeFileSync(
    path,
    JSON.stringify({
      extends: join(repoRoot, 'apps/api/tsconfig.json'),
      compilerOptions: {
        paths: {
          '@couture/api-client': [`${root}/packages/api-client/src/index.ts`],
          '@couture/api-client/*': [`${root}/packages/api-client/src/*`],
          '@couture/config': [`${root}/packages/config/src/index.ts`],
          '@couture/utils': [`${root}/packages/utils/src/index.ts`],
        },
      },
    })
  )
  return path
}

/**
 * Preloaded through NODE_OPTIONS: on exit each process appends the workspace
 * package modules it loaded, one JSON line per process. `tsx` runs the script
 * in a child of its own CLI process, and both inherit the preload, so a single
 * overwritten file would keep only the CLI's empty list.
 */
function moduleRecorder(directory: string, output: string): string {
  const path = join(directory, 'record-modules.cjs')
  writeFileSync(
    path,
    `process.on('exit', () => {
  const loaded = Object.keys(require.cache).filter(
    (file) => /[\\\\/]packages[\\\\/][^\\\\/]+[\\\\/]/.test(file) && !file.includes('node_modules')
  )
  require('node:fs').appendFileSync(${JSON.stringify(output)}, JSON.stringify(loaded) + '\\n')
})
`
  )
  return path
}

describe('scripts/community-sponsorship.ts', () => {
  it('6.7b-UNIT-043 exits 1 with the confirm-target refusal for a remote pooler URL in --env-file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'community-sponsorship-script-'))
    const envFile = join(directory, '.env.remote')
    const loadedModules = join(directory, 'loaded-modules.json')
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
          sourceMappedTsconfig(directory),
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
          env: {
            ...process.env,
            // A loopback ambient URL the command must ignore in favour of the file.
            DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/ambient_target',
            NODE_OPTIONS: [
              process.env.NODE_OPTIONS,
              `--require ${moduleRecorder(directory, loadedModules)}`,
            ]
              .filter(Boolean)
              .join(' '),
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

      // The command graph reached the workspace packages, and only their source.
      const loaded = readFileSync(loadedModules, 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => JSON.parse(line) as string[])
        .map((file) => relative(repoRoot, file))
      expect(loaded).toEqual(
        expect.arrayContaining([
          'packages/api-client/src/contracts/http/index.ts',
          'packages/config/src/index.ts',
          'packages/utils/src/index.ts',
        ])
      )
      expect(loaded.filter((file) => file.includes('/dist/'))).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 60_000)
})
