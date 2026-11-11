// Learning path Step 54: Complimentary full access (date bomb guard).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-54-complimentary-full-access
//
// The moderation decision fixtures run on a pinned suite clock (2026-11-04 here, as in
// moderation-decisions.integration.spec.ts), while the checks they feed read JavaScript's clock:
// findActiveCommunitySanction compares expires_at with `new Date()`, and guardian participation
// takes the age from calculateAge's default date. On 2026-11-11 at 12:00 UTC a ban seeded 7 days
// after the pinned clock expired on the real one and turned the api shard red.
//
// Each case below runs the suite as it would run on a later day: JavaScript's clock is moved to
// that day before the fixtures are built, the pinned clock stays where the suites pin it, and the
// database keeps its own. A fixture that derives a real-clock-checked date from the pinned clock
// fails here today instead of on the day the calendar reaches it.
import { ForbiddenException } from '@nestjs/common'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  assertCommunityMemberNotSanctioned,
  findActiveCommunitySanction,
} from '../src/modules/community/community-access.service.js'
import { assertWardrobeParticipationAllowed } from '../src/modules/guardian/guardian-participation.js'
import {
  decisionFixtures,
  moderationDecisionsTestContext,
} from './helpers/moderation-decisions-seed.js'

vi.setConfig({ testTimeout: 30_000 })

const NOW = new Date('2026-11-04T12:00:00.000Z')
const DAY_MS = 86_400_000
const ctx = moderationDecisionsTestContext()
const { prisma, clock } = ctx
const fx = decisionFixtures(prisma, clock.now)

// The next day, past the original 7-day window, past the 16th birthday of a teen born 15 years
// before the pinned clock (2027-05-06), and further out.
const LATER_DAYS = [0, 8, 200, 365, 3 * 365]

beforeAll(() => {
  clock.at(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  clock.at(NOW)
})

const onDay = (days: number) => {
  const today = Date.now() + days * DAY_MS
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(today)
}

describe('moderation fixtures on a later day', () => {
  it.each(LATER_DAYS)(
    'a default temporary ban is still active %i days ahead',
    async (days) => {
      onDay(days)
      const member = await fx.member('banned')
      await fx.sanction(member)
      expect(await findActiveCommunitySanction(prisma, member.id)).not.toBeNull()
      await expect(
        assertCommunityMemberNotSanctioned(prisma, member.id)
      ).rejects.toBeInstanceOf(ForbiddenException)
    }
  )

  it.each(LATER_DAYS)(
    'a seeded teen whose consent lapsed is still refused %i days ahead',
    async (days) => {
      onDay(days)
      const teen = await fx.teen()
      await fx.lapseConsent(teen.id)
      await expect(
        prisma.$transaction((tx) => assertWardrobeParticipationAllowed(tx, teen.id))
      ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
    }
  )

  it.each(LATER_DAYS)('a seeded member is an adult %i days ahead', async (days) => {
    onDay(days)
    const member = await fx.member('adult')
    await expect(
      prisma.$transaction((tx) => assertWardrobeParticipationAllowed(tx, member.id))
    ).resolves.toBeUndefined()
  })
})
