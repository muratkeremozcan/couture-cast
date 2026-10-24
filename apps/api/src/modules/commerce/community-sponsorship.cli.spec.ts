// Story 6.7b: the operator command's targeting and argument rules. Link and
// end against PostgreSQL run in integration/community-sponsorship-operator.integration.spec.ts.
import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import {
  EXIT_OK,
  EXIT_REFUSED,
  EXIT_USAGE,
  SponsorshipTargetRefusal,
  resolveSponsorshipTarget,
  runCommunitySponsorshipCli,
  type CommunitySponsorshipCliDeps,
} from './community-sponsorship.cli.js'
import {
  COMMUNITY_SPONSORSHIP_AGREEMENT_PATTERN,
  normalizeAgreementReference,
} from './community-sponsorship.constants.js'

const AGREEMENT = 'agr_01JB8Z2Q4M5N6P7R8S9T0V1W2X'

describe('resolveSponsorshipTarget', () => {
  it.each([
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    'postgresql://postgres:postgres@localhost:5432/app',
    'postgresql://postgres:postgres@[::1]:5432/app',
    'postgresql://postgres:postgres@LOCALHOST:5432/app',
  ])('6.7b-UNIT-030 %s is local and needs no confirmation', (url) => {
    expect(resolveSponsorshipTarget(url, undefined)).toEqual({ kind: 'local' })
  })

  it.each([
    [
      'a pooler username',
      'postgresql://postgres.abcdefghijklmnop:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
    ],
    [
      'a direct host',
      'postgresql://postgres:secret@db.abcdefghijklmnop.supabase.co:5432/postgres',
    ],
  ])('6.7b-UNIT-031 %s parses its project ref and needs it confirmed', (_name, url) => {
    expect(() => resolveSponsorshipTarget(url, undefined)).toThrow(
      /pass --confirm-target abcdefghijklmnop/
    )
    expect(() => resolveSponsorshipTarget(url, 'otherproject')).toThrow(
      SponsorshipTargetRefusal
    )
    expect(resolveSponsorshipTarget(url, 'abcdefghijklmnop')).toEqual({
      kind: 'remote',
      ref: 'abcdefghijklmnop',
    })
  })

  it.each([
    'postgresql://postgres:secret@10.0.0.5:5432/postgres',
    'postgresql://postgres:secret@db.example.com:5432/postgres',
    'postgresql://postgres:secret@127.0.0.2.nip.io:5432/postgres',
    'not a url',
  ])('6.7b-UNIT-032 %s is refused whatever is confirmed', (url) => {
    expect(() => resolveSponsorshipTarget(url, 'anything')).toThrow(
      SponsorshipTargetRefusal
    )
  })
})

describe('agreement references', () => {
  it('6.7b-UNIT-033 accepts an agr_ ULID and uppercases a lowercase body', () => {
    expect(COMMUNITY_SPONSORSHIP_AGREEMENT_PATTERN.test(AGREEMENT)).toBe(true)
    expect(normalizeAgreementReference(AGREEMENT.toLowerCase())).toBe(AGREEMENT)
    expect(normalizeAgreementReference(` AGR_${AGREEMENT.slice(4)} `)).toBe(AGREEMENT)
  })

  it.each([
    ['an email', 'agr_jane.doe@example.com'],
    ['a name', 'agr_Jane Doe'],
    ['spaces', 'agr_01JB8Z2Q4M5N6 P7R8S9T0V1W2X'],
    ['a URL', 'agr_https://drive.example.com/agreement'],
    ['a bare ULID', '01JB8Z2Q4M5N6P7R8S9T0V1W2X'],
    ['the excluded letter I', 'agr_01JB8Z2Q4M5N6P7R8S9T0V1W2I'],
    ['a short body', 'agr_01JB8Z2Q4M5N6P7R8S9T0V1W2'],
    ['a long body', 'agr_01JB8Z2Q4M5N6P7R8S9T0V1W2XY'],
  ])('6.7b-UNIT-034 rejects %s', (_name, value) => {
    expect(
      COMMUNITY_SPONSORSHIP_AGREEMENT_PATTERN.test(normalizeAgreementReference(value))
    ).toBe(false)
  })
})

function deps(
  envFile: string | Error = 'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:1/x\n'
) {
  const out: string[] = []
  const err: string[] = []
  const createPrisma = vi.fn(() => {
    throw new Error('no database in a unit test')
  })
  const value: CommunitySponsorshipCliDeps = {
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    readEnvFile: () => {
      if (envFile instanceof Error) throw envFile
      return envFile
    },
    createPrisma: createPrisma as unknown as (url: string) => PrismaClient,
  }
  return { value, out, err, createPrisma }
}

const LINK = [
  'link',
  '--env-file',
  '.env.local',
  '--actor-email',
  'owner@example.com',
  '--post',
  'post-1',
  '--offer',
  'offer-1',
  '--reason',
  'owner_pick',
  '--author-agreement',
  AGREEMENT,
]

describe('runCommunitySponsorshipCli usage', () => {
  it('6.7b-UNIT-035 --help prints usage and exits 0 without a database', async () => {
    const { value, out, createPrisma } = deps()
    await expect(runCommunitySponsorshipCli(['--help'], value)).resolves.toBe(EXIT_OK)
    expect(out.join('\n')).toContain('npm run community:sponsorship -- link')
    expect(createPrisma).not.toHaveBeenCalled()
  })

  it.each([
    ['no command', []],
    ['an unknown command', ['delete', '--env-file', 'x']],
    ['a missing --env-file', LINK.filter((_, i) => i !== 1 && i !== 2)],
    ['a missing --author-agreement', LINK.slice(0, -2)],
    ['a missing --reason', [...LINK.slice(0, 9), ...LINK.slice(11)]],
    ['an unknown flag', [...LINK, '--force']],
    ['a time without a zone', [...LINK, '--starts-at', '2026-11-01T09:00:00']],
    ['a date-only time', [...LINK, '--ends-at', '2026-11-01']],
    [
      'a link-only flag on end',
      [
        'end',
        '--env-file',
        'x',
        '--actor-email',
        'a@b.c',
        '--post',
        'p',
        '--reason',
        'correction',
        '--offer',
        'o',
      ],
    ],
  ])(
    '6.7b-UNIT-036 %s is a usage error that opens no connection',
    async (_name, argv) => {
      const { value, err, createPrisma } = deps()
      await expect(runCommunitySponsorshipCli(argv, value)).resolves.toBe(EXIT_USAGE)
      expect(err.join('\n')).toContain('Usage:')
      expect(createPrisma).not.toHaveBeenCalled()
    }
  )

  it('6.7b-UNIT-037 the env file must exist and carry DATABASE_URL', async () => {
    const missing = deps(new Error('ENOENT'))
    await expect(runCommunitySponsorshipCli(LINK, missing.value)).resolves.toBe(
      EXIT_USAGE
    )
    expect(missing.err[0]).toContain('cannot be read')

    const empty = deps('SUPABASE_URL=http://127.0.0.1:54321\n')
    await expect(runCommunitySponsorshipCli(LINK, empty.value)).resolves.toBe(EXIT_USAGE)
    expect(empty.err[0]).toContain('has no DATABASE_URL')
  })

  it('6.7b-UNIT-038 the ambient DATABASE_URL is ignored in favour of the env file', async () => {
    const previous = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    try {
      const remote = deps(
        'DATABASE_URL=postgresql://postgres:secret@db.abcdefghijklmnop.supabase.co:5432/postgres\n'
      )
      await expect(runCommunitySponsorshipCli(LINK, remote.value)).resolves.toBe(
        EXIT_REFUSED
      )
      expect(remote.err[0]).toContain('--confirm-target abcdefghijklmnop')
      expect(remote.createPrisma).not.toHaveBeenCalled()
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previous
    }
  })

  it('6.7b-UNIT-039 an unparseable remote target is refused before any connection', async () => {
    const remote = deps(
      'DATABASE_URL=postgresql://postgres:secret@10.1.2.3:5432/postgres\n'
    )
    await expect(
      runCommunitySponsorshipCli([...LINK, '--confirm-target', '10'], remote.value)
    ).resolves.toBe(EXIT_REFUSED)
    expect(remote.err[0]).toContain('cannot be parsed')
    expect(remote.createPrisma).not.toHaveBeenCalled()
  })
})
