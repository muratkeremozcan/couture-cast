import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getTrackedEntityIds, resetTrackedEntities } from '../src/factories/registry.js'
import {
  buildCommunityAliasCreateInput,
  buildCommunityChallengeCreateInput,
  buildCommunityModerationOutboxCreateInput,
  buildCommunityObjectPath,
  COMMUNITY_OBJECT_PATH_PATTERN,
  communityObjectPathContainsIdentifier,
  buildCommunityPostReportCreateInput,
  buildLookbookPostCreateInput,
  createCommunityAlias,
  createCommunityChallenge,
  createCommunityModerationOutbox,
  createCommunityPostReport,
  createLookbookPost,
  persistCommunityAlias,
  persistCommunityChallenge,
  persistCommunityModerationOutbox,
  persistCommunityPostReport,
  persistLookbookPost,
} from '../src/factories/community.factory.js'

type CreateStub = { create: ReturnType<typeof vi.fn> }

function stubPrisma() {
  const makeStub = (): CreateStub => ({
    create: vi.fn(({ data }: { data: { id: string } }) => Promise.resolve(data)),
  })

  const lookbookPost = makeStub()
  const communityChallenge = makeStub()
  const communityAlias = makeStub()
  const communityPostReport = makeStub()
  const communityModerationOutbox = makeStub()

  return {
    prisma: {
      lookbookPost,
      communityChallenge,
      communityAlias,
      communityPostReport,
      communityModerationOutbox,
    } as unknown as PrismaClient,
    lookbookPost,
    communityChallenge,
    communityAlias,
    communityPostReport,
    communityModerationOutbox,
  }
}

/** A fixed clock, so every timestamp assertion below is exact. */
const NOW = new Date('2026-09-05T12:00:00.000Z')

describe('community factories', () => {
  afterEach(() => {
    resetTrackedEntities()
  })

  describe('LookbookPost', () => {
    it('6.1-FACTORY-01 defaults to a published post with temperate_dry band', () => {
      const post = createLookbookPost({}, { now: NOW })

      expect(post.status).toBe('published')
      expect(post.climateBand).toBe('temperate_dry')
      expect(post.locale).toBe('en-US')
      // The database rejects `published` with a NULL published_at, and the feed
      // cursor is built on that column, so the default has to carry it.
      expect(post.publishedAt).toEqual(NOW)
      expect(post.submittedAt).toEqual(NOW)
    })

    it('6.1-FACTORY-02 accepts overrides for status and climateBand', () => {
      const post = createLookbookPost({
        status: 'pending_review',
        climateBand: 'cold_wet',
        caption: 'Freezing rain layers',
      })

      expect(post.status).toBe('pending_review')
      expect(post.climateBand).toBe('cold_wet')
      expect(post.caption).toBe('Freezing rain layers')
    })

    it('6.1-FACTORY-03 maps every field onto its snake_case column', async () => {
      const { prisma, lookbookPost } = stubPrisma()

      const fixture = createLookbookPost(
        {
          id: 'post-123',
          userId: 'user-456',
          challengeId: 'challenge-789',
          uploadExpiresAt: new Date('2026-09-05T13:00:00.000Z'),
          erasureRequestedAt: new Date('2026-09-06T12:00:00.000Z'),
        },
        { now: NOW }
      )
      const input = buildLookbookPostCreateInput(fixture)

      // Asserted against literals rather than against the fixture, because the
      // camelCase-to-snake_case mapping IS what this function exists to do:
      // comparing it to values the same call produced would pass however the
      // mapping was wired.
      expect(input).toMatchObject({
        id: 'post-123',
        user_id: 'user-456',
        status: 'published',
        alt_text: 'Full length photo of outfit with weather-appropriate layers',
        image_content_type: 'image/jpeg',
        image_checksum: 'sha256:abcd1234abcd1234',
        image_byte_size: 102400,
        upload_expires_at: new Date('2026-09-05T13:00:00.000Z'),
        submitted_at: NOW,
        published_at: NOW,
        moderation_engine_version: '1.0.0',
        location_key: 'us-il-chicago',
        locale: 'en-US',
        climate_band: 'temperate_dry',
        challenge_id: 'challenge-789',
        erasure_requested_at: new Date('2026-09-06T12:00:00.000Z'),
        anonymized_at: null,
        objects_purged_at: null,
        created_at: NOW,
        updated_at: NOW,
      })

      await persistLookbookPost(prisma, fixture)

      expect(lookbookPost.create).toHaveBeenCalledTimes(1)
      expect(getTrackedEntityIds('lookbookPosts')).toContain('post-123')
    })

    it('6.1-FACTORY-06 builds an opaque object path that carries no user id', () => {
      const post = createLookbookPost({ id: 'post-123', userId: 'user-456' })

      // "Never: Put user IDs in object paths or signed URLs." The path is
      // embedded in every signed URL the API mints, so a user id here would
      // deanonymize the author to anyone the URL reaches.
      //
      // Asserted through the SHARED pattern, which also holds the database seed
      // in `packages/db/test/community-schema.spec.ts`. The factory was fixed
      // for this and the seed was not, so for a while the repository both
      // obeyed and broke the boundary depending on which file you read. One
      // exported pattern is what stops that recurring.
      expect(post.imageObjectPath).toMatch(COMMUNITY_OBJECT_PATH_PATTERN)
      expect(post.imageObjectPath).toMatch(/^community\/post-123\/[a-zA-Z0-9]{32}\.jpg$/)
      expect(
        communityObjectPathContainsIdentifier(post.imageObjectPath ?? '', 'user-456')
      ).toBe(false)

      const webpPath = buildCommunityObjectPath('post-abc', 'webp')
      expect(webpPath).toMatch(COMMUNITY_OBJECT_PATH_PATTERN)
      expect(webpPath).toMatch(/^community\/post-abc\/[a-zA-Z0-9]{32}\.webp$/)
    })

    it('6.1-FACTORY-07 takes an injected clock so fixtures are deterministic', () => {
      const first = createLookbookPost({}, { now: NOW })
      const second = createLookbookPost({}, { now: NOW })

      expect(first.createdAt).toEqual(second.createdAt)
      expect(first.updatedAt).toEqual(NOW)
      expect(first.publishedAt).toEqual(NOW)
    })
  })

  describe('CommunityChallenge', () => {
    it('6.1-FACTORY-04 defaults to an active challenge with slug and copy', () => {
      const challenge = createCommunityChallenge({}, { now: NOW })

      expect(challenge.isActive).toBe(true)
      expect(challenge.slug).toMatch(/^challenge-/)
      expect(challenge.copy).toBeDefined()
      expect(challenge.startsAt).toEqual(NOW)
      expect(challenge.endsAt).toEqual(new Date('2026-09-12T12:00:00.000Z'))
    })

    it('6.1-FACTORY-05 maps every field onto its snake_case column', async () => {
      const { prisma, communityChallenge } = stubPrisma()

      const fixture = createCommunityChallenge(
        { id: 'challenge-123', slug: 'autumn-trench' },
        { now: NOW }
      )
      const input = buildCommunityChallengeCreateInput(fixture)

      expect(input).toMatchObject({
        id: 'challenge-123',
        slug: 'autumn-trench',
        starts_at: NOW,
        ends_at: new Date('2026-09-12T12:00:00.000Z'),
        climate_band: 'temperate_dry',
        is_active: true,
        created_at: NOW,
        updated_at: NOW,
      })

      await persistCommunityChallenge(prisma, fixture)

      expect(communityChallenge.create).toHaveBeenCalledTimes(1)
      expect(getTrackedEntityIds('communityChallenges')).toContain('challenge-123')
    })
  })

  describe('CommunityAlias', () => {
    it('6.1-FACTORY-08 maps to snake_case columns and registers for cleanup', async () => {
      const { prisma, communityAlias } = stubPrisma()

      const fixture = createCommunityAlias(
        { id: 'alias-123', userId: 'user-456', alias: 'driftwood-91af' },
        { now: NOW }
      )

      expect(buildCommunityAliasCreateInput(fixture)).toEqual({
        id: 'alias-123',
        user_id: 'user-456',
        alias: 'driftwood-91af',
        created_at: NOW,
      })

      await persistCommunityAlias(prisma, fixture)

      expect(communityAlias.create).toHaveBeenCalledTimes(1)
      expect(getTrackedEntityIds('communityAliases')).toContain('alias-123')
    })
  })

  describe('CommunityPostReport', () => {
    it('6.1-FACTORY-09 maps to snake_case columns and defaults the SLA clock to 24 hours', async () => {
      const { prisma, communityPostReport } = stubPrisma()

      const fixture = createCommunityPostReport(
        { id: 'report-123', postId: 'post-456', reporterId: 'user-789' },
        { now: NOW }
      )

      expect(buildCommunityPostReportCreateInput(fixture)).toMatchObject({
        id: 'report-123',
        post_id: 'post-456',
        reporter_id: 'user-789',
        reason: 'harassment',
        details: 'Reported from the community feed',
        sla_due_at: new Date('2026-09-06T12:00:00.000Z'),
        created_at: NOW,
        resolved_at: null,
      })

      await persistCommunityPostReport(prisma, fixture)

      expect(communityPostReport.create).toHaveBeenCalledTimes(1)
      expect(getTrackedEntityIds('communityPostReports')).toContain('report-123')
    })
  })

  describe('CommunityModerationOutbox', () => {
    it('6.1-FACTORY-10 maps to snake_case columns and registers for cleanup', async () => {
      const { prisma, communityModerationOutbox } = stubPrisma()

      const fixture = createCommunityModerationOutbox(
        { id: 'outbox-123', postId: 'post-456' },
        { now: NOW }
      )

      expect(buildCommunityModerationOutboxCreateInput(fixture)).toEqual({
        id: 'outbox-123',
        post_id: 'post-456',
        attempts: 0,
        last_error: null,
        dispatched_at: null,
        created_at: NOW,
        updated_at: NOW,
      })

      await persistCommunityModerationOutbox(prisma, fixture)

      expect(communityModerationOutbox.create).toHaveBeenCalledTimes(1)
      expect(getTrackedEntityIds('communityModerationOutboxEntries')).toContain(
        'outbox-123'
      )
    })
  })
})
