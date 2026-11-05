// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: U-W-FLAG-PRUNE, U-W-OVERLAP (error half), U-NO-WRITE-PATHS, U-W-OTHER-PRUNES, V-SAME-SOURCE
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  MODERATION_HISTORY_LOG_EVENTS,
  MODERATION_HISTORY_RETENTION_INTERVAL_MS,
  ModerationHistoryRetention,
} from './moderation-history.retention.js'

const repoRoot = path.resolve(__dirname, '../../../../..')

function harness(flag: () => Promise<unknown> = () => Promise.resolve(true)) {
  const queryRawUnsafe = vi.fn((_sql: string) => Promise.resolve([{ ok: true }]))
  const executeRaw = vi.fn((..._args: unknown[]) => Promise.resolve(0))
  const logger = { info: vi.fn(), error: vi.fn() }
  const getFeatureFlag = vi.fn((_key: string, _subject: string) => flag())
  const retention = new ModerationHistoryRetention({
    prisma: { $queryRawUnsafe: queryRawUnsafe, $executeRaw: executeRaw } as never,
    flags: { getFeatureFlag },
    clock: () => new Date('2026-11-05T12:00:00.000Z'),
    logger,
  })
  return { retention, queryRawUnsafe, executeRaw, logger, getFeatureFlag }
}

describe('U-W-FLAG-PRUNE', () => {
  it('runs the drift check and skips the prune with the flag off', async () => {
    const { retention, queryRawUnsafe, executeRaw } = harness(() =>
      Promise.resolve(false)
    )
    expect(await retention.run()).toEqual({ drift: [], pruned: 0, skipped: true })
    expect(queryRawUnsafe).toHaveBeenCalled()
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it('treats a truthy non-boolean as off', async () => {
    const { retention, executeRaw } = harness(() => Promise.resolve('true'))
    expect((await retention.run()).skipped).toBe(true)
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it('needs the console flag too', async () => {
    const { retention, executeRaw, getFeatureFlag } = harness()
    getFeatureFlag.mockImplementation((key: string) =>
      Promise.resolve(key === 'moderation_history_enabled')
    )
    expect((await retention.run()).skipped).toBe(true)
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it('reads as the system subject', async () => {
    const { retention, getFeatureFlag } = harness()
    await retention.run()
    for (const call of getFeatureFlag.mock.calls)
      expect(call[1]).toBe('system:moderation-history')
  })

  it('closes on a flag read failure, with a closed log', async () => {
    const { retention, executeRaw, logger } = harness(() =>
      Promise.reject(new Error('secret provider detail'))
    )
    expect((await retention.run()).skipped).toBe(true)
    expect(executeRaw).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'secret provider detail'
    )
  })
})

describe('U-W-OVERLAP: a failure logs closed names and stays quiet about rows', () => {
  it('survives a failing check query', async () => {
    const { retention, queryRawUnsafe, logger } = harness()
    queryRawUnsafe.mockRejectedValue(new Error('row data: member-1'))
    const result = await retention.run()
    expect(result.drift).toEqual([])
    expect(logger.error.mock.calls[0]![0]).toEqual({
      event: MODERATION_HISTORY_LOG_EVENTS.checkFailed,
    })
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('member-1')
  })

  it('survives a failing prune', async () => {
    const { retention, executeRaw, logger } = harness()
    executeRaw.mockRejectedValue(new Error('row data: member-1'))
    expect((await retention.run()).pruned).toBe(0)
    expect(logger.error.mock.calls[0]![0]).toEqual({
      event: MODERATION_HISTORY_LOG_EVENTS.pruneFailed,
    })
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('member-1')
  })

  it('logs a count and nothing else on success', async () => {
    const { retention, executeRaw, logger } = harness()
    executeRaw.mockResolvedValue(3)
    await retention.run()
    expect(logger.info).toHaveBeenCalledWith(
      { event: MODERATION_HISTORY_LOG_EVENTS.pruned, count: 3 },
      MODERATION_HISTORY_LOG_EVENTS.pruned
    )
  })

  it('reruns every day', () => {
    expect(MODERATION_HISTORY_RETENTION_INTERVAL_MS).toBe(86_400_000)
  })
})

describe('source scans', () => {
  const tracked = (...pathspec: string[]) =>
    execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...pathspec],
      { cwd: repoRoot, encoding: 'utf8' }
    )
      .split('\n')
      .filter(Boolean)
  const read = (file: string) => readFileSync(`${repoRoot}/${file}`, 'utf8')

  it('[U-NO-WRITE-PATHS] finds no write to a decision row anywhere', () => {
    const offenders = tracked(
      'apps/api/src',
      'apps/api/integration',
      'scripts',
      'playwright',
      'packages/db/prisma/seeds',
      'packages/db/prisma/seed.ts'
    )
      .filter((file) => /\.(ts|tsx|mjs|js|cjs)$/.test(file))
      // These specs name the statements in order to prove they are refused.
      .filter(
        (file) =>
          !/(moderation-history[\w.-]*\.spec\.ts|moderation-decisions\.service\.spec\.ts)$/.test(
            file
          )
      )
      .filter((file) => {
        const text = read(file)
        return (
          /moderationDecision\s*\.\s*(update|updateMany|delete|deleteMany|upsert)\b/.test(
            text
          ) ||
          /(UPDATE|DELETE\s+FROM|TRUNCATE)\s+(public\.)?"ModerationDecision"/.test(text)
        )
      })
    expect(offenders).toEqual([])
  })

  it('[U-W-OTHER-PRUNES] leaves evidence tables out of every other prune', () => {
    const sources = tracked('apps/api/src/workers', 'apps/api/src/modules')
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .filter((file) => /prune|retention|cleanup|maintenance\.processor/i.test(file))
      .filter((file) => !file.endsWith('moderation-history.retention.ts'))
    expect(sources.length).toBeGreaterThan(0)
    for (const file of sources) {
      const text = read(file)
      for (const table of [
        'moderationDecision',
        'moderationEvent',
        'communityCommentAudit',
        'communityPostReport',
        'communityCommentReport',
        'auditLog',
      ])
        expect(`${file}: ${new RegExp(`${table}\\s*\\.\\s*delete`).test(text)}`).toBe(
          `${file}: false`
        )
      // The prunes in this repository are mostly raw SQL, which the client-call check above cannot see.
      expect(
        `${file}: ${/(DELETE\s+FROM|TRUNCATE)\s+(public\.)?"(ModerationDecision|ModerationEvent|CommunityCommentAudit|CommunityPostReport|CommunityCommentReport|AuditLog)"/i.test(text)}`
      ).toBe(`${file}: false`)
    }
  })

  it('[V-SAME-SOURCE] gives the script and the sweep one check list', () => {
    const module = 'moderation-history.enforcement'
    expect(read('scripts/verify-moderation-history.mjs')).toContain(module)
    expect(
      read('apps/api/src/modules/moderation/moderation-history.retention.ts')
    ).toContain(module)
    expect(read(`apps/api/src/modules/moderation/${module}.ts`)).not.toMatch(/^import /m)
  })
})
