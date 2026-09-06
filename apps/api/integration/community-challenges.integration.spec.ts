// Learning path Step 38: Community feed by climate band.
//
// Story 6.1: weekly challenge overlap and association, against real PostgreSQL.
//
// The overlap rule is the one place in this story where the database is not a
// backstop but the ONLY correct enforcement. The repository's application-level
// pre-check filters candidates by band, and an equality filter structurally
// cannot see that a global challenge (NULL band) competes with a band-scoped
// one: `NULL` and `'cold_wet'` are different keys however the query is written.
// The `CommunityChallenge_no_overlap` GiST exclusion constraint closes that by
// modelling each challenge as the SET of bands it occupies -- one slot for a
// band, all six for a global row -- so `&&` sees the conflict.
//
// That makes the band-versus-global assertions below unmockable by
// construction: there is no way to observe them except by asking a real
// PostgreSQL to reject a real INSERT.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import {
  CommunityChallengeWindowError,
  CommunityRepository,
} from '../src/modules/community/community.repository.js'

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const repository = new CommunityRepository(prisma)

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "CommunityChallenge" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "LookbookPost" LIMIT 1`
    schemaReady = true
  } catch (error) {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[community-challenges] Skipped: could not query the Story 6.1 community schema. ' +
        'Run `npm run db:migrate` against the integration database. Underlying error:',
      error
    )
  }
}

function requireSchema(context: { skip: () => void }): boolean {
  if (!schemaReady) {
    context.skip()
    return false
  }
  return true
}

const namespace = `community-challenge-${randomUUID().slice(0, 8)}`

/**
 * Each test gets its own week, far enough in the future that it cannot collide
 * with a seeded or concurrently-created challenge. The exclusion constraint is
 * global across the table, so two tests sharing a window would fail each other
 * for a reason unrelated to what either is asserting.
 */
let weekCursor = 0
function nextWindow(): { startsAt: Date; endsAt: Date } {
  weekCursor += 1
  const startsAt = new Date(Date.UTC(2031, 0, 6 + weekCursor * 28))
  return { startsAt, endsAt: new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000) }
}

function challengeData(
  slug: string,
  overrides: Partial<Prisma.CommunityChallengeUncheckedCreateInput> = {}
): Prisma.CommunityChallengeUncheckedCreateInput & { time_zone: string } {
  return {
    id: `${namespace}-${slug}-${randomUUID().slice(0, 8)}`,
    slug: `${namespace}-${slug}-${randomUUID().slice(0, 8)}`,
    starts_at: new Date(),
    ends_at: new Date(),
    time_zone: 'America/Chicago',
    copy: { 'en-US': { title: 'Weekly challenge', body: 'Show us your layers.' } },
    is_active: true,
    updated_at: new Date(),
    ...overrides,
  }
}

async function createUser(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `${namespace}-${label}-${randomUUID().slice(0, 8)}@synthetic.test` },
  })
  return user.id
}

beforeAll(async () => {
  await probeSchema()
})

afterAll(async () => {
  if (schemaReady) {
    const owned = { user: { email: { startsWith: namespace } } }
    await prisma.moderationEvent.deleteMany({
      where: { post: { user: { email: { startsWith: namespace } } } },
    })
    await prisma.communityModerationOutbox.deleteMany({
      where: { post: { user: { email: { startsWith: namespace } } } },
    })
    await prisma.lookbookPost.deleteMany({ where: owned })
    await prisma.user.deleteMany({ where: { email: { startsWith: namespace } } })
    await prisma.communityChallenge.deleteMany({
      where: { slug: { startsWith: namespace } },
    })
  }
  await prisma.$disconnect()
})

describe('6.1 community challenges', () => {
  describe('overlap protection', () => {
    it('6.1-INT-040 rejects a second active challenge on the same band and window', async (context) => {
      if (!requireSchema(context)) return

      const { startsAt, endsAt } = nextWindow()
      const first = await repository.createChallengeWithoutOverlap(
        'cold_wet',
        startsAt,
        endsAt,
        challengeData('band-a', {
          starts_at: startsAt,
          ends_at: endsAt,
          climate_band: 'cold_wet',
        })
      )
      expect(first.kind).toBe('created')

      const overlapping = new Date(startsAt.getTime() + 3 * 24 * 60 * 60 * 1000)
      const second = await repository.createChallengeWithoutOverlap(
        'cold_wet',
        overlapping,
        new Date(overlapping.getTime() + 7 * 24 * 60 * 60 * 1000),
        challengeData('band-b', {
          starts_at: overlapping,
          ends_at: new Date(overlapping.getTime() + 7 * 24 * 60 * 60 * 1000),
          climate_band: 'cold_wet',
        })
      )
      expect(second.kind).toBe('overlap')
    })

    it('6.1-INT-041 rejects a global challenge overlapping a band-scoped one', async (context) => {
      if (!requireSchema(context)) return

      // THE case the application-level band filter cannot catch. A NULL band
      // means every band, so it competes with cold_wet, but `climate_band: null`
      // never equals `climate_band: 'cold_wet'` in a WHERE clause. Only the
      // exclusion constraint sees it.
      const { startsAt, endsAt } = nextWindow()
      const banded = await repository.createChallengeWithoutOverlap(
        'warm_dry',
        startsAt,
        endsAt,
        challengeData('scoped', {
          starts_at: startsAt,
          ends_at: endsAt,
          climate_band: 'warm_dry',
        })
      )
      expect(banded.kind).toBe('created')

      const overlapping = new Date(startsAt.getTime() + 2 * 24 * 60 * 60 * 1000)
      const global = await repository.createChallengeWithoutOverlap(
        null,
        overlapping,
        new Date(overlapping.getTime() + 7 * 24 * 60 * 60 * 1000),
        challengeData('global', {
          starts_at: overlapping,
          ends_at: new Date(overlapping.getTime() + 7 * 24 * 60 * 60 * 1000),
          climate_band: null,
        })
      )
      expect(global.kind).toBe('overlap')
    })

    it('6.1-INT-042 rejects a band-scoped challenge overlapping a global one', async (context) => {
      if (!requireSchema(context)) return

      const { startsAt, endsAt } = nextWindow()
      const global = await repository.createChallengeWithoutOverlap(
        null,
        startsAt,
        endsAt,
        challengeData('global-first', {
          starts_at: startsAt,
          ends_at: endsAt,
          climate_band: null,
        })
      )
      expect(global.kind).toBe('created')

      const overlapping = new Date(startsAt.getTime() + 2 * 24 * 60 * 60 * 1000)
      const banded = await repository.createChallengeWithoutOverlap(
        'temperate_wet',
        overlapping,
        new Date(overlapping.getTime() + 7 * 24 * 60 * 60 * 1000),
        challengeData('scoped-second', {
          starts_at: overlapping,
          ends_at: new Date(overlapping.getTime() + 7 * 24 * 60 * 60 * 1000),
          climate_band: 'temperate_wet',
        })
      )
      expect(banded.kind).toBe('overlap')
    })

    it('6.1-INT-043 allows two bands to run overlapping windows', async (context) => {
      if (!requireSchema(context)) return

      const { startsAt, endsAt } = nextWindow()
      const cold = await repository.createChallengeWithoutOverlap(
        'cold_dry',
        startsAt,
        endsAt,
        challengeData('cold', {
          starts_at: startsAt,
          ends_at: endsAt,
          climate_band: 'cold_dry',
        })
      )
      const warm = await repository.createChallengeWithoutOverlap(
        'warm_wet',
        startsAt,
        endsAt,
        challengeData('warm', {
          starts_at: startsAt,
          ends_at: endsAt,
          climate_band: 'warm_wet',
        })
      )

      expect(cold.kind).toBe('created')
      expect(warm.kind).toBe('created')
    })

    it('6.1-INT-044 frees the slot once a challenge is closed', async (context) => {
      if (!requireSchema(context)) return

      // Only active rows participate in the constraint, so archiving last
      // week's challenge lets this week's take the same band without anyone
      // having to delete history.
      const { startsAt, endsAt } = nextWindow()
      const closed = await repository.createChallengeWithoutOverlap(
        'cold_wet',
        startsAt,
        endsAt,
        challengeData('closed', {
          starts_at: startsAt,
          ends_at: endsAt,
          climate_band: 'cold_wet',
          is_active: false,
        })
      )
      expect(closed.kind).toBe('created')

      const replacement = await repository.createChallengeWithoutOverlap(
        'cold_wet',
        startsAt,
        endsAt,
        challengeData('replacement', {
          starts_at: startsAt,
          ends_at: endsAt,
          climate_band: 'cold_wet',
        })
      )
      expect(replacement.kind).toBe('created')
    })

    it('6.1-INT-045 allows back-to-back weeks that touch at the boundary', async (context) => {
      if (!requireSchema(context)) return

      // The range is half-open, so a challenge ending exactly when the next
      // begins is legal. A weekly calendar is built entirely out of that case,
      // and a closed range would reject every second week.
      const { startsAt, endsAt } = nextWindow()
      const week1 = await repository.createChallengeWithoutOverlap(
        'temperate_dry',
        startsAt,
        endsAt,
        challengeData('week-1', {
          starts_at: startsAt,
          ends_at: endsAt,
          climate_band: 'temperate_dry',
        })
      )
      const week2 = await repository.createChallengeWithoutOverlap(
        'temperate_dry',
        endsAt,
        new Date(endsAt.getTime() + 7 * 24 * 60 * 60 * 1000),
        challengeData('week-2', {
          starts_at: endsAt,
          ends_at: new Date(endsAt.getTime() + 7 * 24 * 60 * 60 * 1000),
          climate_band: 'temperate_dry',
        })
      )

      expect(week1.kind).toBe('created')
      expect(week2.kind).toBe('created')
    })

    it('6.1-INT-050 rejects an UPDATE that moves a window onto another challenge', async (context) => {
      if (!requireSchema(context)) return

      // The update path had no integration coverage at all; only create did.
      // Editing a window is how an overlap is most likely to be introduced in
      // practice, because the editor is looking at one challenge and cannot see
      // the calendar around it.
      const first = nextWindow()
      const second = nextWindow()

      const stationary = await repository.createChallengeWithoutOverlap(
        'cold_wet',
        first.startsAt,
        first.endsAt,
        challengeData('update-stationary', {
          starts_at: first.startsAt,
          ends_at: first.endsAt,
          climate_band: 'cold_wet',
        })
      )
      const movable = await repository.createChallengeWithoutOverlap(
        'cold_wet',
        second.startsAt,
        second.endsAt,
        challengeData('update-movable', {
          starts_at: second.startsAt,
          ends_at: second.endsAt,
          climate_band: 'cold_wet',
        })
      )
      if (stationary.kind !== 'created' || movable.kind !== 'created') {
        throw new Error('challenge fixtures were not created')
      }

      const collidingStart = new Date(first.startsAt.getTime() + 2 * 24 * 60 * 60 * 1000)
      const collidingEnd = new Date(collidingStart.getTime() + 7 * 24 * 60 * 60 * 1000)
      const moved = await repository.updateChallengeWithoutOverlap(
        movable.challenge.id,
        'cold_wet',
        collidingStart,
        collidingEnd,
        { starts_at: collidingStart, ends_at: collidingEnd, climate_band: 'cold_wet' }
      )
      expect(moved.kind).toBe('overlap')

      // And the row is unchanged, which is the half that matters: a rejected
      // move must not half-apply.
      const unchanged = await prisma.communityChallenge.findUniqueOrThrow({
        where: { id: movable.challenge.id },
      })
      expect(unchanged.starts_at).toEqual(second.startsAt)
    })

    it('6.1-INT-051 lets a challenge update its own window without self-conflict', async (context) => {
      if (!requireSchema(context)) return

      // The exclusion constraint compares a row against every OTHER row, so an
      // in-place edit must not collide with the row being edited. A naive
      // implementation that forgets to exclude self rejects every update.
      const { startsAt, endsAt } = nextWindow()
      const created = await repository.createChallengeWithoutOverlap(
        'warm_wet',
        startsAt,
        endsAt,
        challengeData('self-update', {
          starts_at: startsAt,
          ends_at: endsAt,
          climate_band: 'warm_wet',
        })
      )
      if (created.kind !== 'created') throw new Error('challenge fixture was not created')

      const shifted = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000)
      const shiftedEnd = new Date(shifted.getTime() + 7 * 24 * 60 * 60 * 1000)
      const updated = await repository.updateChallengeWithoutOverlap(
        created.challenge.id,
        'warm_wet',
        shifted,
        shiftedEnd,
        { starts_at: shifted, ends_at: shiftedEnd, climate_band: 'warm_wet' }
      )

      expect(updated.kind).toBe('updated')
    })

    it('6.1-INT-052 refuses to reactivate an archived challenge into an occupied slot', async (context) => {
      if (!requireSchema(context)) return

      // 6.1-INT-044 proves closing a challenge frees its slot. This proves the
      // slot cannot be taken back while somebody else holds it -- the other
      // half of the same rule, and the one an "undo archive" button would hit.
      const { startsAt, endsAt } = nextWindow()
      const archived = await repository.createChallengeWithoutOverlap(
        'cold_dry',
        startsAt,
        endsAt,
        challengeData('archived', {
          starts_at: startsAt,
          ends_at: endsAt,
          climate_band: 'cold_dry',
          is_active: false,
        })
      )
      const occupant = await repository.createChallengeWithoutOverlap(
        'cold_dry',
        startsAt,
        endsAt,
        challengeData('occupant', {
          starts_at: startsAt,
          ends_at: endsAt,
          climate_band: 'cold_dry',
        })
      )
      if (archived.kind !== 'created' || occupant.kind !== 'created') {
        throw new Error('challenge fixtures were not created')
      }

      const reactivated = await repository.updateChallengeWithoutOverlap(
        archived.challenge.id,
        'cold_dry',
        startsAt,
        endsAt,
        {
          starts_at: startsAt,
          ends_at: endsAt,
          climate_band: 'cold_dry',
          is_active: true,
        }
      )
      expect(reactivated.kind).toBe('overlap')

      const stillArchived = await prisma.communityChallenge.findUniqueOrThrow({
        where: { id: archived.challenge.id },
      })
      expect(stillArchived.is_active).toBe(false)
    })

    it('6.1-INT-053 admits exactly one of two concurrent overlapping creates', async (context) => {
      if (!requireSchema(context)) return

      // The application pre-check is a SELECT followed by an INSERT, so two
      // concurrent creates both see an empty calendar and both proceed. The
      // exclusion constraint is the only thing serialising them, which makes
      // this the constraint's most important case and the one an application
      // pre-check can never cover.
      const { startsAt, endsAt } = nextWindow()
      const overlapping = new Date(startsAt.getTime() + 3 * 24 * 60 * 60 * 1000)

      const results = await Promise.all([
        repository.createChallengeWithoutOverlap(
          'temperate_wet',
          startsAt,
          endsAt,
          challengeData('race-a', {
            starts_at: startsAt,
            ends_at: endsAt,
            climate_band: 'temperate_wet',
          })
        ),
        repository.createChallengeWithoutOverlap(
          'temperate_wet',
          overlapping,
          new Date(overlapping.getTime() + 7 * 24 * 60 * 60 * 1000),
          challengeData('race-b', {
            starts_at: overlapping,
            ends_at: new Date(overlapping.getTime() + 7 * 24 * 60 * 60 * 1000),
            climate_band: 'temperate_wet',
          })
        ),
      ])

      const kinds = results.map((result) => result.kind).sort()
      expect(kinds).toEqual(['created', 'overlap'])
    })

    it('6.1-INT-046 raises a window error for a challenge that ends before it starts', async (context) => {
      if (!requireSchema(context)) return

      // The database CHECK, surfaced as the typed error the service turns into
      // a 400 rather than leaking a raw constraint name to the caller.
      //
      // This guards a mapping that is easy to write and easy to get wrong.
      // Prisma does not report a CHECK violation the way it reports a unique or
      // exclusion violation: 23514 arrives as `PrismaClientUnknownRequestError`
      // with `code` and `meta` BOTH undefined and the SQLSTATE present only
      // inside the message text, while 23P01 arrives as a Known error with the
      // state in `meta`. `extractSqlState` reads both routes for that reason.
      // A future simplification back to `meta.code` alone would make this branch
      // unreachable again and turn a 400 into a 500, and this test is what
      // catches that.
      const { startsAt, endsAt } = nextWindow()
      await expect(
        repository.createChallengeWithoutOverlap(
          'cold_wet',
          endsAt,
          startsAt,
          challengeData('backwards', {
            starts_at: endsAt,
            ends_at: startsAt,
            climate_band: 'cold_wet',
          })
        )
      ).rejects.toBeInstanceOf(CommunityChallengeWindowError)
    })
  })

  describe('association and participation', () => {
    it('6.1-INT-047 keeps a post associated after its challenge closes', async (context) => {
      if (!requireSchema(context)) return

      // "Retain association after close." The association is what a
      // participation count is computed from, so losing it on close would erase
      // the result of the challenge along with the challenge.
      const { startsAt, endsAt } = nextWindow()
      const created = await repository.createChallengeWithoutOverlap(
        'cold_wet',
        startsAt,
        endsAt,
        challengeData('assoc', {
          starts_at: startsAt,
          ends_at: endsAt,
          climate_band: 'cold_wet',
        })
      )
      if (created.kind !== 'created') throw new Error('challenge fixture was not created')
      const challengeId = created.challenge.id

      const userId = await createUser('participant')
      const fixture = createLookbookPost({
        id: `${namespace}-assoc-post-${randomUUID().slice(0, 8)}`,
        userId,
        status: 'published',
        publishedAt: new Date(),
        challengeId,
      })
      await prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(fixture) })

      await prisma.communityChallenge.update({
        where: { id: challengeId },
        data: { is_active: false },
      })

      const post = await prisma.lookbookPost.findUniqueOrThrow({
        where: { id: fixture.id },
      })
      expect(post.challenge_id).toBe(challengeId)
    })

    it('6.1-INT-048 keeps the post when the challenge itself is deleted', async (context) => {
      if (!requireSchema(context)) return

      // ON DELETE SET NULL rather than cascade: removing an editorial row must
      // never remove members' posts with it.
      const { startsAt, endsAt } = nextWindow()
      const created = await repository.createChallengeWithoutOverlap(
        'warm_dry',
        startsAt,
        endsAt,
        challengeData('deleted', {
          starts_at: startsAt,
          ends_at: endsAt,
          climate_band: 'warm_dry',
        })
      )
      if (created.kind !== 'created') throw new Error('challenge fixture was not created')

      const userId = await createUser('orphan')
      const fixture = createLookbookPost({
        id: `${namespace}-orphan-post-${randomUUID().slice(0, 8)}`,
        userId,
        status: 'published',
        publishedAt: new Date(),
        challengeId: created.challenge.id,
      })
      await prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(fixture) })

      await prisma.communityChallenge.delete({ where: { id: created.challenge.id } })

      const post = await prisma.lookbookPost.findUniqueOrThrow({
        where: { id: fixture.id },
      })
      expect(post.challenge_id).toBeNull()
    })

    /*
     * 6.1-INT-049 (unique published participants) was DELETED, deliberately, and
     * this note is the boundary it leaves behind.
     *
     * The test computed unique participants with `prisma.lookbookPost.findMany({
     * distinct: ['user_id'] })` written in the test body and asserted the
     * result. Nothing in `apps/api/src/modules/community/` counts participants,
     * so it exercised Prisma's `distinct` and no application regression could
     * fail it.
     *
     * Writing a `countChallengeParticipants` to point it at was considered and
     * rejected: it would be production code with no caller, and its own test
     * would assert on the same Prisma `distinct` one layer further from anything
     * real. `communityChallengeSchema` is `.strict()` with no participant field
     * and no admin, ops or reporting consumer exists, so exposing a count
     * properly is a contract change -- a new field, a regenerated SDK, new keys
     * the projection tests pin -- and that belongs to a later story rather than
     * to this one's test tier.
     *
     * THE BOUNDARY, stated so it is not mistaken for coverage: no production
     * code counts unique challenge participants. Uniqueness is carried by a
     * convention -- the moderation processor emits `community_challenge_participated`
     * with a dedupe key of `${challengeId}:${userId}` -- and an analytics sink is
     * trusted to honour it. That sink does not exist yet. 6.1-INT-047 and -048
     * below cover what IS enforced: the association survives both the challenge
     * closing and the challenge being deleted.
     */
  })
})
