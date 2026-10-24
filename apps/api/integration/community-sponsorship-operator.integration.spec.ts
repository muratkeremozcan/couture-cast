// Story 6.7b: the owner's operator command end to end. `runCommunitySponsorshipCli`
// is driven with real arguments and a real Prisma client against a database this
// file owns, so every refusal is proven to leave that database untouched.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_SPONSORSHIP_END_REASONS,
  COMMUNITY_SPONSORSHIP_ENDED_EVENT,
  COMMUNITY_SPONSORSHIP_LINK_REASONS,
  COMMUNITY_SPONSORSHIP_LINKED_EVENT,
} from '../src/modules/commerce/community-sponsorship.constants.js'
import {
  EXIT_OK,
  runCommunitySponsorshipCli,
  type CommunitySponsorshipCliDeps,
} from '../src/modules/commerce/community-sponsorship.cli.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  HOUR,
  agreementReference,
  databaseNow,
  insertAuthUser,
  insertLink,
  installAuthUsers,
  seedAdmin,
  seedAuthor,
  seedOffer,
  seedPartner,
  seedPost,
  shift,
} from './helpers/community-sponsorship-fixtures.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const ENV_FILE = '/operator/.env.isolated'

let admin: { email: string; userId: string }
let offerId: string
let advisorOfferId: string

type CliRun = {
  code: number
  stdout: string[]
  stderr: string[]
  createPrisma: ReturnType<typeof vi.fn>
}

/** Runs the command with an env file whose only target is the given URL. */
async function cli(
  args: readonly string[],
  databaseUrl: string = database.url
): Promise<CliRun> {
  const stdout: string[] = []
  const stderr: string[] = []
  const createPrisma = vi.fn(
    (url: string) => new PrismaClient({ datasources: { db: { url } } })
  )
  const deps: CommunitySponsorshipCliDeps = {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    readEnvFile: (path) => {
      if (path !== ENV_FILE) throw new Error(`unexpected env file ${path}`)
      return `DATABASE_URL="${databaseUrl}"\n`
    },
    createPrisma,
  }
  const code = await runCommunitySponsorshipCli(['--env-file', ENV_FILE, ...args], deps)
  return { code, stdout, stderr, createPrisma }
}

function linkArgs(
  postId: string,
  overrides: Record<string, string | null> = {},
  actorEmail = admin.email
): string[] {
  const values: Record<string, string | null> = {
    'actor-email': actorEmail,
    post: postId,
    offer: offerId,
    reason: 'partner_campaign',
    'author-agreement': agreementReference(),
    ...overrides,
  }
  const args = ['link']
  for (const [flag, value] of Object.entries(values)) {
    if (value !== null) args.push(`--${flag}`, value)
  }
  return args
}

function endArgs(postId: string, reason = 'campaign_ended', actorEmail = admin.email) {
  return ['end', '--actor-email', actorEmail, '--post', postId, '--reason', reason]
}

/** Every link row and every audit row, so "nothing written" is a full comparison. */
async function snapshot() {
  return {
    links: await prisma.communityPostSponsorship.findMany({ orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ orderBy: { id: 'asc' } }),
  }
}

function lastJson(lines: readonly string[]): Record<string, unknown> {
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0]!) as Record<string, unknown>
}

async function publicPost(): Promise<string> {
  return seedPost(prisma, await seedAuthor(prisma))
}

beforeAll(async () => {
  await database.migrate()
  // Schema probe: this suite fails when the migration is absent.
  await prisma.$queryRaw`SELECT 1 FROM "CommunityPostSponsorship" LIMIT 1`
  await installAuthUsers(prisma)
  admin = await seedAdmin(prisma)
  const partner = await seedPartner(prisma)
  offerId = (await seedOffer(prisma, partner.id)).id
  advisorOfferId = (await seedOffer(prisma, partner.id, { advisor: true })).id
}, 60_000)

afterAll(async () => {
  try {
    await prisma.$disconnect()
  } finally {
    await database.drop()
  }
})

describe('6.7b operator link and end', () => {
  it('6.7b-INT-101 link writes exactly one link and one audit row naming actor, post, offer, window, reason and agreement', async () => {
    const postId = await publicPost()
    const ulid = agreementReference().slice(4)
    const before = await snapshot()

    const run = await cli(
      linkArgs(postId, {
        'author-agreement': `AGR_${ulid.toLowerCase()}`,
        'starts-at': '2026-01-01T00:00:00Z',
        'ends-at': '2099-01-01T00:00:00.000Z',
      })
    )

    expect(run.stderr).toEqual([])
    expect(run.code).toBe(EXIT_OK)
    const after = await snapshot()
    const newLinks = after.links.filter(
      (row) => !before.links.some((old) => old.id === row.id)
    )
    const newAudits = after.audits.filter(
      (row) => !before.audits.some((old) => old.id === row.id)
    )
    expect(newLinks).toHaveLength(1)
    expect(newAudits).toHaveLength(1)
    const link = newLinks[0]!
    expect(link).toMatchObject({
      post_id: postId,
      offer_id: offerId,
      starts_at: new Date('2026-01-01T00:00:00.000Z'),
      ends_at: new Date('2099-01-01T00:00:00.000Z'),
      created_by_id: admin.userId,
      create_reason: 'partner_campaign',
      ended_at: null,
      ended_by_id: null,
      end_reason: null,
    })
    expect(newAudits[0]).toMatchObject({
      user_id: admin.userId,
      event_type: COMMUNITY_SPONSORSHIP_LINKED_EVENT,
      event_data: {
        sponsorshipId: link.id,
        postId,
        offerId,
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2099-01-01T00:00:00.000Z',
        reason: 'partner_campaign',
        authorAgreement: `agr_${ulid}`,
      },
    })
    expect(lastJson(run.stdout)).toMatchObject({
      command: 'link',
      target: 'local',
      dryRun: false,
      sponsorshipId: link.id,
      authorAgreement: `agr_${ulid}`,
    })
  })

  it('6.7b-INT-102 --starts-at defaults to the database clock and --ends-at to open-ended', async () => {
    const postId = await publicPost()
    const lower = await databaseNow(prisma)
    const run = await cli(linkArgs(postId))
    const upper = await databaseNow(prisma)
    expect(run.code).toBe(EXIT_OK)

    const link = await prisma.communityPostSponsorship.findFirstOrThrow({
      where: { post_id: postId },
    })
    expect(link.ends_at).toBeNull()
    expect(link.starts_at.getTime()).toBeGreaterThanOrEqual(lower.getTime())
    expect(link.starts_at.getTime()).toBeLessThanOrEqual(upper.getTime())
    expect(lastJson(run.stdout)).toMatchObject({
      startsAt: link.starts_at.toISOString(),
      endsAt: null,
    })
  })

  it('6.7b-INT-103 --dry-run link prints the plan and writes nothing', async () => {
    const postId = await publicPost()
    const before = await snapshot()
    const run = await cli([...linkArgs(postId), '--dry-run'])
    expect(run.code).toBe(EXIT_OK)
    expect(lastJson(run.stdout)).toMatchObject({
      command: 'link',
      dryRun: true,
      sponsorshipId: null,
      actorUserId: admin.userId,
      postId,
      offerId,
      endsAt: null,
      reason: 'partner_campaign',
    })
    expect(await snapshot()).toEqual(before)
  })

  it('6.7b-INT-104 end stamps the end state, never deletes, and audits with the link agreement', async () => {
    const postId = await publicPost()
    const agreement = agreementReference()
    expect(
      (
        await cli(
          linkArgs(postId, { 'author-agreement': agreement, reason: 'owner_pick' })
        )
      ).code
    ).toBe(EXIT_OK)
    const opened = await prisma.communityPostSponsorship.findFirstOrThrow({
      where: { post_id: postId },
    })
    const before = await snapshot()
    const lower = await databaseNow(prisma)

    const run = await cli(endArgs(postId, 'author_withdrew'))

    const upper = await databaseNow(prisma)
    expect(run.code).toBe(EXIT_OK)
    const after = await snapshot()
    expect(after.links.map((row) => row.id)).toEqual(before.links.map((row) => row.id))
    const ended = after.links.find((row) => row.id === opened.id)!
    expect(ended).toMatchObject({
      ended_by_id: admin.userId,
      end_reason: 'author_withdrew',
      starts_at: opened.starts_at,
      ends_at: null,
    })
    expect(ended.ended_at!.getTime()).toBeGreaterThanOrEqual(lower.getTime())
    expect(ended.ended_at!.getTime()).toBeLessThanOrEqual(upper.getTime())
    const newAudits = after.audits.filter(
      (row) => !before.audits.some((old) => old.id === row.id)
    )
    expect(newAudits).toHaveLength(1)
    expect(newAudits[0]).toMatchObject({
      user_id: admin.userId,
      event_type: COMMUNITY_SPONSORSHIP_ENDED_EVENT,
      event_data: {
        sponsorshipId: opened.id,
        postId,
        offerId,
        startsAt: opened.starts_at.toISOString(),
        endsAt: null,
        endedAt: ended.ended_at!.toISOString(),
        reason: 'author_withdrew',
        authorAgreement: agreement,
      },
    })
  })

  it('6.7b-INT-105 --dry-run end prints the plan and leaves the link open', async () => {
    const postId = await publicPost()
    expect((await cli(linkArgs(postId))).code).toBe(EXIT_OK)
    const before = await snapshot()
    const run = await cli([...endArgs(postId), '--dry-run'])
    expect(run.code).toBe(EXIT_OK)
    expect(lastJson(run.stdout)).toMatchObject({
      command: 'end',
      dryRun: true,
      postId,
      reason: 'campaign_ended',
    })
    expect(await snapshot()).toEqual(before)
  })

  it('6.7b-INT-106 a second link while one is open is refused and names it; after end a new link works', async () => {
    const postId = await publicPost()
    expect((await cli(linkArgs(postId))).code).toBe(EXIT_OK)
    const open = await prisma.communityPostSponsorship.findFirstOrThrow({
      where: { post_id: postId },
    })
    const before = await snapshot()

    const refused = await cli(linkArgs(postId, { reason: 'owner_pick' }))

    expect(refused.code).not.toBe(EXIT_OK)
    expect(refused.stdout).toEqual([])
    expect(refused.stderr.join('\n')).toContain('link_already_open')
    expect(refused.stderr.join('\n')).toContain(open.id)
    expect(await snapshot()).toEqual(before)

    expect((await cli(endArgs(postId))).code).toBe(EXIT_OK)
    expect((await cli(linkArgs(postId, { reason: 'owner_pick' }))).code).toBe(EXIT_OK)
    const links = await prisma.communityPostSponsorship.findMany({
      where: { post_id: postId },
      orderBy: { created_at: 'asc' },
    })
    expect(links).toHaveLength(2)
    expect(links[0]!.ended_at).not.toBeNull()
    expect(links[1]).toMatchObject({ ended_at: null, create_reason: 'owner_pick' })
  })
})

describe('6.7b operator agreement reference is stored in canonical form', () => {
  /** The frozen spec's literal pattern, independent of the production constant. */
  const CANONICAL_AGREEMENT = /^agr_[0-9A-HJKMNP-TV-Z]{26}$/

  it('6.7b-INT-107 a lowercase body with an AGR_ prefix is stored canonical on the link audit and repeated on the end audit', async () => {
    const postId = await publicPost()
    const canonical = agreementReference()
    const typed = `AGR_${canonical.slice(4).toLowerCase()}`
    expect(typed).not.toBe(canonical)

    expect((await cli(linkArgs(postId, { 'author-agreement': typed }))).code).toBe(
      EXIT_OK
    )
    expect((await cli(endArgs(postId))).code).toBe(EXIT_OK)

    const link = await prisma.communityPostSponsorship.findFirstOrThrow({
      where: { post_id: postId },
    })
    const audits = await prisma.auditLog.findMany({
      where: {
        event_type: {
          in: [COMMUNITY_SPONSORSHIP_LINKED_EVENT, COMMUNITY_SPONSORSHIP_ENDED_EVENT],
        },
        event_data: { path: ['sponsorshipId'], equals: link.id },
      },
      orderBy: { id: 'asc' },
    })
    expect(audits).toHaveLength(2)
    const agreements = Object.fromEntries(
      audits.map((row) => [
        row.event_type,
        (row.event_data as { authorAgreement?: unknown }).authorAgreement,
      ])
    )
    expect(agreements).toEqual({
      [COMMUNITY_SPONSORSHIP_LINKED_EVENT]: canonical,
      [COMMUNITY_SPONSORSHIP_ENDED_EVENT]: canonical,
    })
    for (const value of Object.values(agreements)) {
      expect(value).toMatch(CANONICAL_AGREEMENT)
    }
  })
})

describe('6.7b operator refusals write nothing', () => {
  type Refusal = {
    name: string
    args: () => Promise<string[]>
    stderr: string
    exit?: number
  }

  /** A post with an open link, for the end refusals that must not touch it. */
  async function linkedPost(): Promise<string> {
    const postId = await publicPost()
    await insertLink(prisma, {
      postId,
      offerId,
      createdById: admin.userId,
      startsAt: shift(await databaseNow(prisma), -HOUR),
    })
    return postId
  }

  async function authUserWith(
    appMetadata: Record<string, unknown> | null,
    appUserEmail?: string | null
  ): Promise<string> {
    const email = `actor-${randomUUID()}@sponsorship.test`
    if (appUserEmail !== null) {
      await prisma.user.create({ data: { email: appUserEmail ?? email } })
    }
    await insertAuthUser(prisma, email, appMetadata)
    return email
  }

  /**
   * The actor refusals, shared by `link` and `end`: both resolve the actor
   * through the same admin check, and both must refuse every row here.
   */
  const actorRefusals: { name: string; email: () => Promise<string>; stderr: string }[] =
    [
      {
        name: 'an actor with no auth user',
        email: () => Promise.resolve(`ghost-${randomUUID()}@sponsorship.test`),
        stderr: 'actor_auth_user_missing',
      },
      {
        name: 'an actor whose role is not admin',
        email: () => authUserWith({ app_role: 'adult' }),
        stderr: 'actor_not_admin',
      },
      {
        name: 'an actor with no app metadata',
        email: () => authUserWith(null),
        stderr: 'actor_not_admin',
      },
      {
        name: 'an admin with no app user',
        email: () => authUserWith({ app_role: 'admin' }, null),
        stderr: 'actor_app_user_missing',
      },
      {
        name: 'an admin whose app_user_id names a user with another email',
        email: async () => {
          const other = await prisma.user.create({
            data: { email: `other-${randomUUID()}@sponsorship.test` },
          })
          return authUserWith(
            { app_role: 'admin', app_user_id: other.id },
            `mirror-${randomUUID()}@sponsorship.test`
          )
        },
        stderr: 'actor_identity_mismatch',
      },
    ]

  const refusals: Refusal[] = [
    ...actorRefusals.map(
      ({ name, email, stderr }): Refusal => ({
        name,
        args: async () => linkArgs(await publicPost(), {}, await email()),
        stderr,
      })
    ),
    {
      name: 'a free-text link reason',
      args: async () =>
        linkArgs(await publicPost(), { reason: 'Jane asked for this campaign' }),
      stderr: 'reason_invalid',
    },
    {
      name: 'an end code as a link reason',
      args: async () => linkArgs(await publicPost(), { reason: 'campaign_ended' }),
      stderr: 'reason_invalid',
    },
    {
      name: 'a link code as an end reason',
      args: async () => endArgs(await linkedPost(), 'owner_pick'),
      stderr: 'reason_invalid',
    },
    {
      name: 'a free-text end reason',
      args: async () => endArgs(await linkedPost(), 'partner went quiet'),
      stderr: 'reason_invalid',
    },
    {
      name: 'a missing agreement',
      args: async () => linkArgs(await publicPost(), { 'author-agreement': null }),
      stderr: '--author-agreement is required',
      exit: 2,
    },
    ...[
      ['too short', 'agr_01HZX3K4Q8'],
      ['without the prefix', agreementReference().slice(4)],
      ['an email', 'jane.doe@example.com'],
      ['with spaces', 'agr_01HZX3K4Q8 VJ6T2M9N5R7C1B0'],
      ['a URL', 'https://drive.example.com/agreements/jane-doe'],
      ['a name', 'Jane Doe'],
      ['a ULID with a letter Crockford excludes', 'agr_01HZX3K4Q8VJ6T2M9N5R7C1BIL'],
    ].map(
      ([kind, value]): Refusal => ({
        name: `an agreement that is ${kind}`,
        args: async () => linkArgs(await publicPost(), { 'author-agreement': value! }),
        stderr: 'agreement_invalid',
      })
    ),
    {
      name: 'a minor author',
      args: async () => {
        const minor = await seedAuthor(prisma, {
          birthdate: shift(await databaseNow(prisma), -15 * 365 * 24 * HOUR),
        })
        return linkArgs(await seedPost(prisma, minor))
      },
      stderr: 'author_not_adult',
    },
    {
      name: 'an author with no birthdate',
      args: async () =>
        linkArgs(await seedPost(prisma, await seedAuthor(prisma, { birthdate: null }))),
      stderr: 'author_not_adult',
    },
    {
      name: 'an advisor offer',
      args: async () => linkArgs(await publicPost(), { offer: advisorOfferId }),
      stderr: 'offer_not_garment',
    },
    {
      name: 'a missing offer',
      args: async () =>
        linkArgs(await publicPost(), { offer: `missing-${randomUUID()}` }),
      stderr: 'offer_missing',
    },
    {
      name: 'a withdrawn post',
      args: async () =>
        linkArgs(
          await seedPost(prisma, await seedAuthor(prisma), { status: 'withdrawn' })
        ),
      stderr: 'post_not_public',
    },
    {
      name: 'a missing post',
      args: () => Promise.resolve(linkArgs(`missing-${randomUUID()}`)),
      stderr: 'post_not_public',
    },
    {
      name: 'ends_at equal to starts_at',
      args: async () =>
        linkArgs(await publicPost(), {
          'starts-at': '2031-01-01T00:00:00Z',
          'ends-at': '2031-01-01T00:00:00Z',
        }),
      stderr: 'window_invalid',
    },
    {
      name: 'ends_at before starts_at',
      args: async () =>
        linkArgs(await publicPost(), {
          'starts-at': '2031-01-02T00:00:00Z',
          'ends-at': '2031-01-01T00:00:00Z',
        }),
      stderr: 'window_invalid',
    },
    {
      name: 'ends_at before the default starts_at',
      args: async () =>
        linkArgs(await publicPost(), { 'ends-at': '2020-01-01T00:00:00Z' }),
      stderr: 'window_invalid',
    },
    {
      name: 'an ends_at already in the past',
      args: async () =>
        linkArgs(await publicPost(), {
          'starts-at': '2019-01-01T00:00:00Z',
          'ends-at': '2020-01-01T00:00:00Z',
        }),
      stderr: 'window_in_past',
    },
    {
      name: 'end with no open link',
      args: async () => endArgs(await publicPost()),
      stderr: 'no_open_link',
    },
  ]

  for (const [index, refusal] of refusals.entries()) {
    it(`6.7b-INT-110.${index + 1} refuses ${refusal.name}`, async () => {
      const args = await refusal.args()
      const before = await snapshot()
      const run = await cli(args)
      expect(run.code).toBe(refusal.exit ?? 1)
      expect(run.stdout).toEqual([])
      expect(run.stderr.join('\n')).toContain(refusal.stderr)
      expect(await snapshot()).toEqual(before)
    })
  }

  for (const [index, actor] of actorRefusals.entries()) {
    it(`6.7b-INT-112.${index + 1} end refuses ${actor.name} and leaves the open link as it was`, async () => {
      const args = endArgs(await linkedPost(), 'campaign_ended', await actor.email())
      const before = await snapshot()
      const run = await cli(args)
      expect(run.code).toBe(1)
      expect(run.stdout).toEqual([])
      expect(run.stderr.join('\n')).toContain(actor.stderr)
      expect(await snapshot()).toEqual(before)
    })
  }

  const remoteTargets = [
    {
      name: 'a pooler URL without --confirm-target',
      url: 'postgresql://postgres.abcdefghijklmnop:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
      extra: [] as string[],
      stderr: '--confirm-target abcdefghijklmnop',
    },
    {
      name: 'a direct URL whose --confirm-target names another project',
      url: 'postgresql://postgres:secret@db.abcdefghijklmnop.supabase.co:5432/postgres',
      extra: ['--confirm-target', 'qrstuvwxyzabcdef'],
      stderr: '--confirm-target abcdefghijklmnop',
    },
    {
      name: 'a remote URL with no parseable project ref',
      url: 'postgresql://postgres:secret@db.example.com:5432/postgres',
      extra: ['--confirm-target', 'abcdefghijklmnop'],
      stderr: 'cannot be parsed',
    },
  ]

  for (const [index, target] of remoteTargets.entries()) {
    it(`6.7b-INT-111.${index + 1} refuses ${target.name} before any connection`, async () => {
      const postId = await publicPost()
      const before = await snapshot()
      const run = await cli([...linkArgs(postId), ...target.extra], target.url)
      expect(run.code).toBe(1)
      expect(run.stderr.join('\n')).toContain(target.stderr)
      expect(run.createPrisma).not.toHaveBeenCalled()
      expect(await snapshot()).toEqual(before)
    })
  }
})

describe('6.7b operator atomicity and database constraints', () => {
  it('6.7b-INT-120 a failed audit insert rolls back the link and the end-state change', async () => {
    const postId = await publicPost()
    const refuseAudit = async () => {
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION cc67b_refuse_sponsorship_audit() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'cc67b audit insert refused'; END $$`)
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER cc67b_refuse_sponsorship_audit BEFORE INSERT ON "AuditLog"
        FOR EACH ROW WHEN (NEW.event_type IN (
          '${COMMUNITY_SPONSORSHIP_LINKED_EVENT}', '${COMMUNITY_SPONSORSHIP_ENDED_EVENT}'
        )) EXECUTE FUNCTION cc67b_refuse_sponsorship_audit()`)
    }
    const allowAudit = async () => {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS cc67b_refuse_sponsorship_audit ON "AuditLog"'
      )
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS cc67b_refuse_sponsorship_audit()'
      )
    }

    try {
      await refuseAudit()
      const beforeLink = await snapshot()
      const link = await cli(linkArgs(postId))
      expect(link.code).toBe(1)
      expect(link.stderr.join('\n')).toContain('cc67b audit insert refused')
      expect(await snapshot()).toEqual(beforeLink)

      await allowAudit()
      expect((await cli(linkArgs(postId))).code).toBe(EXIT_OK)
      await refuseAudit()
      const beforeEnd = await snapshot()
      const end = await cli(endArgs(postId))
      expect(end.code).toBe(1)
      expect(end.stderr.join('\n')).toContain('cc67b audit insert refused')
      const afterEnd = await snapshot()
      expect(afterEnd).toEqual(beforeEnd)
      expect(afterEnd.links.find((row) => row.post_id === postId)?.ended_at).toBeNull()
    } finally {
      await allowAudit()
    }
  })

  describe('raw inserts', () => {
    const raw = new Client({ connectionString: database.url })
    let postId: string

    beforeAll(async () => {
      await raw.connect()
    })
    afterAll(async () => {
      await raw.end()
    })

    async function insert(
      columns: Record<string, string | Date | null>
    ): Promise<{ id: string }> {
      const row = {
        id: `raw-${randomUUID()}`,
        post_id: postId,
        offer_id: offerId,
        starts_at: new Date('2030-01-01T00:00:00.000Z'),
        ends_at: null,
        created_by_id: admin.userId,
        create_reason: 'partner_campaign',
        ended_at: null,
        ended_by_id: null,
        end_reason: null,
        updated_at: new Date(),
        ...columns,
      }
      const names = Object.keys(row)
      await raw.query(
        `INSERT INTO "CommunityPostSponsorship" (${names.map((n) => `"${n}"`).join(', ')})
         VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`,
        Object.values(row)
      )
      return { id: row.id }
    }

    async function refusal(
      work: () => Promise<unknown>
    ): Promise<{ code?: string; constraint?: string }> {
      try {
        await work()
      } catch (error) {
        return error as { code?: string; constraint?: string }
      }
      throw new Error('the database accepted a row it must refuse')
    }

    const ended = {
      ended_at: new Date('2030-02-01T00:00:00.000Z'),
      end_reason: 'correction',
    }

    beforeAll(async () => {
      postId = await publicPost()
    })

    it('6.7b-INT-121 every listed link reason is stored and anything else is refused', async () => {
      for (const reason of COMMUNITY_SPONSORSHIP_LINK_REASONS) {
        await insert({
          create_reason: reason,
          ...ended,
          ended_by_id: admin.userId,
        })
      }
      for (const reason of [
        '',
        'Partner Campaign',
        'campaign_ended',
        'jane@example.com',
      ]) {
        expect(await refusal(() => insert({ create_reason: reason }))).toMatchObject({
          code: '23514',
          constraint: 'CommunityPostSponsorship_create_reason_check',
        })
      }
    })

    it('6.7b-INT-122 every listed end reason is stored and anything else is refused', async () => {
      for (const reason of COMMUNITY_SPONSORSHIP_END_REASONS) {
        await insert({ ...ended, ended_by_id: admin.userId, end_reason: reason })
      }
      for (const reason of ['', 'owner_pick', 'author asked by email']) {
        expect(
          await refusal(() =>
            insert({ ...ended, ended_by_id: admin.userId, end_reason: reason })
          )
        ).toMatchObject({
          code: '23514',
          constraint: 'CommunityPostSponsorship_end_reason_check',
        })
      }
    })

    it('6.7b-INT-123 the window CHECK refuses ends_at at or before starts_at', async () => {
      for (const endsAt of ['2030-01-01T00:00:00.000Z', '2029-12-31T23:59:59.999Z']) {
        expect(
          await refusal(() =>
            insert({ ...ended, ended_by_id: admin.userId, ends_at: new Date(endsAt) })
          )
        ).toMatchObject({
          code: '23514',
          constraint: 'CommunityPostSponsorship_window_check',
        })
      }
      await insert({
        ...ended,
        ended_by_id: admin.userId,
        ends_at: new Date('2030-01-01T00:00:00.001Z'),
      })
    })

    it('6.7b-INT-124 the end-state CHECK refuses a partial end', async () => {
      const partials: Record<string, string | Date>[] = [
        { ended_at: ended.ended_at },
        { ended_by_id: admin.userId },
        { end_reason: 'correction' },
        { ended_at: ended.ended_at, ended_by_id: admin.userId },
        { ended_by_id: admin.userId, end_reason: 'correction' },
      ]
      for (const partial of partials) {
        expect(await refusal(() => insert(partial))).toMatchObject({
          code: '23514',
          constraint: 'CommunityPostSponsorship_end_state_check',
        })
      }
    })

    it('6.7b-INT-125 the partial unique index refuses a second open link on one post', async () => {
      const post = await publicPost()
      const first = await insert({ post_id: post })
      expect(await refusal(() => insert({ post_id: post }))).toMatchObject({
        code: '23505',
        constraint: 'CommunityPostSponsorship_open_post_key',
      })
      await raw.query(
        `UPDATE "CommunityPostSponsorship"
         SET ended_at = $2, ended_by_id = $3, end_reason = 'correction'
         WHERE id = $1`,
        [first.id, ended.ended_at, admin.userId]
      )
      await insert({ post_id: post })
      expect(
        await prisma.communityPostSponsorship.count({ where: { post_id: post } })
      ).toBe(2)
    })
  })
})
