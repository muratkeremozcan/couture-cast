// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import 'reflect-metadata'
import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommunityMaintenanceService } from '../src/modules/community/community-maintenance.service.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityCommentsRepository } from '../src/modules/community/community-comments.repository.js'
import { CommunityModerationActionsService } from '../src/modules/community/community-moderation.actions.js'
import { CommunityPreferencesService } from '../src/modules/community/community-preferences.service.js'
import {
  CommunityAccessService,
  assertCommunityDatabaseAccess,
} from '../src/modules/community/community-access.service.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { FeatureFlagsRepository } from '../src/modules/feature-flags/feature-flags.repository.js'
import { PushRegistrationService } from '../src/modules/notifications/push-registration.service.js'
import { PrismaAlertsRepository } from '../src/modules/alerts/alerts.repository.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { GuardianService } from '../src/modules/guardian/guardian.service.js'
import {
  engagementHarness,
  settle,
  until,
  type EngagementHarness,
} from './helpers/community-engagement-harness.js'
let h: EngagementHarness
beforeEach(async () => {
  h = await engagementHarness()
}, 30_000)
afterEach(async () => {
  await h?.close()
}, 30_000)
type Fixture = Awaited<ReturnType<EngagementHarness['fixture']>>
function preferences() {
  const flags = new FeatureFlagsService(
    new FeatureFlagsRepository(h.prisma),
    { getFeatureFlagValue: () => Promise.resolve(true) },
    h.flags
  )
  return new CommunityPreferencesService(
    h.prisma,
    new CommunityAccessService(h.prisma, flags)
  )
}
function guardian() {
  return new GuardianService(
    { capture: vi.fn() },
    h.prisma,
    new GuardianConsentStateService(h.prisma),
    { invalidateUserSessions: vi.fn().mockResolvedValue(undefined) } as never
  )
}
const mutations: {
  name: string
  teen?: boolean
  run: (f: Fixture) => Promise<unknown>
}[] = [
  ...(['actor', 'recipient', 'author', 'parentAuthor'] as const).map((role) => ({
    name: `account erasure linked ${role}`,
    run: (f: Fixture) =>
      new CommunityRepository(h.prisma).requestErasureForUser(f[role].id, new Date()),
  })),
  {
    name: 'community opt-out',
    run: async (f) => {
      const service = preferences()
      const policy = await service.get(f.recipient.id)
      return service.patch(f.recipient.id, {
        baseRevision: policy.revision,
        enabled: false,
      })
    },
  },
  {
    name: 'shared legacy push policy',
    run: (f) =>
      new PrismaAlertsRepository(h.prisma).upsertNotificationPreferences(f.recipient.id, {
        pushEnabled: false,
        quietHoursEnabled: false,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        timezone: 'UTC',
      }),
  },
  {
    name: 'registration unbind',
    run: (f) =>
      new PushRegistrationService(h.prisma).remove(
        f.recipient.id,
        f.binding.registrationId,
        f.binding.bindingGeneration
      ),
  },
  {
    name: 'registration transfer',
    run: (f) =>
      new PushRegistrationService(h.prisma).register(f.actor.id, {
        token: f.token,
        installationId: f.installation,
        permission: 'granted',
        platform: 'ios',
        transfer: true,
        expectedBinding: f.binding,
      }),
  },
  {
    name: 'author withdrawal',
    run: (f) =>
      new CommunityRepository(h.prisma).withdrawPostAndRequestErasure(
        f.post.id,
        new Date()
      ),
  },
  {
    name: 'erasure maintenance',
    run: async (f) => {
      await new CommunityRepository(h.prisma).requestErasureForUser(
        f.author.id,
        new Date()
      )
      return new CommunityMaintenanceService(
        h.prisma,
        new InMemoryCommunityStorage()
      ).sweepErasureRequests()
    },
  },
  {
    name: 'moderator takedown',
    run: (f) =>
      new CommunityModerationActionsService(h.prisma, {
        getFeatureFlag: () => Promise.resolve(true),
      }).takeDownPublishedPost({
        postId: f.post.id,
        operatorId: f.author.id,
        reason: 'Controlled acceptance takedown',
      }),
  },
  {
    name: 'comment author deletion',
    run: (f) =>
      new CommunityCommentsRepository(h.prisma).delete({
        userId: f.actor.id,
        postId: f.post.id,
        commentId: f.comment!.id,
        platform: 'web',
        eligible: (tx) => assertCommunityDatabaseAccess(tx, f.actor.id),
      }),
  },
  {
    name: 'guardian revocation',
    teen: true,
    run: (f) => guardian().revokeConsent(f.author.id, f.actor.id),
  },
  {
    name: 'guardian emancipation',
    teen: true,
    run: async (f) => {
      const profile = await h.prisma.userProfile.findUniqueOrThrow({
        where: { user_id: f.actor.id },
      })
      const adulthood = new Date(profile.birthdate!)
      adulthood.setUTCFullYear(adulthood.getUTCFullYear() + 18)
      return guardian().emancipateEligibleTeens(adulthood)
    },
  },
]
async function verifyEffect(name: string, f: Fixture) {
  const reads: Record<string, () => Promise<unknown>> = {
    'community opt-out': () =>
      h.prisma.communityNotificationPreference.findUnique({
        where: { user_id: f.recipient.id },
      }),
    'shared legacy push policy': () =>
      h.prisma.notificationPreference.findUnique({ where: { user_id: f.recipient.id } }),
    'registration unbind': () =>
      h.prisma.pushToken.findUnique({ where: { id: f.binding.registrationId } }),
    'registration transfer': () =>
      h.prisma.pushToken.findUnique({ where: { id: f.binding.registrationId } }),
    'author withdrawal': () =>
      h.prisma.lookbookPost.findUnique({ where: { id: f.post.id } }),
    'erasure maintenance': () =>
      h.prisma.lookbookPost.findUnique({ where: { id: f.post.id } }),
    'moderator takedown': () =>
      h.prisma.lookbookPost.findUnique({ where: { id: f.post.id } }),
    'comment author deletion': () =>
      h.prisma.communityComment.findUnique({ where: { id: f.comment!.id } }),
    'guardian revocation': () =>
      h.prisma.communityComment.findUnique({ where: { id: f.comment!.id } }),
    'guardian emancipation': () =>
      h.prisma.userProfile.findUnique({ where: { user_id: f.actor.id } }),
  }
  const expected: Record<string, Record<string, unknown>> = {
    'community opt-out': { enabled: false },
    'shared legacy push policy': { push_enabled: false },
    'registration transfer': {
      user_id: f.actor.id,
      binding_generation: f.binding.bindingGeneration + 1,
    },
    'author withdrawal': { status: 'withdrawn' },
    'erasure maintenance': {
      caption: null,
      anonymized_at: expect.any(Date),
      objects_purged_at: expect.any(Date),
    },
    'moderator takedown': { status: 'flagged' },
    'comment author deletion': { status: 'author_deleted', body: null },
    'guardian revocation': { status: 'consent_suspended', body: null },
    'guardian emancipation': {
      preferences: { compliance: { guardianConsentRequired: false } },
    },
  }
  if (name === 'registration unbind') expect(await reads[name]!()).toBeNull()
  else if (reads[name]) {
    const value = await reads[name]()
    expect(value).toMatchObject(expected[name]!)
    if (name === 'guardian emancipation')
      z.object({
        preferences: z.object({
          compliance: z.object({ guardianConsentAgedOutAt: z.string().datetime() }),
        }),
      }).parse(value)
  }
}
describe('6.5-INT-019..024 actual cross-feature privacy entry points and subject roles', () => {
  it('parent harness guard sends only to its owned provider recorder', async () => {
    const f = await h.fixture()
    await h.prisma
      .$executeRaw`UPDATE "CommunityTokenDelivery" SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=${f.delivery.id}::uuid`
    const [schedule] = await h.prisma.$queryRaw<
      { due: boolean }[]
    >`SELECT next_attempt_at<=clock_timestamp() AS due FROM "CommunityTokenDelivery" WHERE id=${f.delivery.id}::uuid`
    expect(schedule?.due).toBe(true)
    await h.worker.dispatch()
    const delivery = await h.prisma.communityTokenDelivery.findUniqueOrThrow({
      where: { id: f.delivery.id },
      include: { attempts: { select: { status: true, reason: true } } },
    })
    expect(
      await h.ledger(),
      JSON.stringify({ status: delivery.status, attempts: delivery.attempts })
    ).toHaveLength(1)
    expect(delivery).toMatchObject({ status: 'accepted' })
  }, 10_000)
  it('parent recorder sends nothing before its delivery is due on the database clock', async () => {
    const f = await h.fixture()
    await h.prisma
      .$executeRaw`UPDATE "CommunityTokenDelivery" SET next_attempt_at=clock_timestamp()+interval '1 minute' WHERE id=${f.delivery.id}::uuid`
    await h.worker.dispatch()
    expect(await h.ledger()).toHaveLength(0)
    await h.prisma
      .$executeRaw`UPDATE "CommunityTokenDelivery" SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=${f.delivery.id}::uuid`
    await h.worker.dispatch()
    expect(await h.ledger()).toHaveLength(1)
  }, 10_000)
  it.each(['actor', 'recipient', 'author', 'parentAuthor'] as const)(
    'erasure of linked %s wins after the durable claim and before final authorization',
    async (role) => {
      const f = await h.fixture('reply')
      const { child } = await h.sender()
      await child.call('barrier', 'claim')
      const dispatch = settle(child.call('dispatch', f.delivery.id))
      await child.event('claimed')
      await new CommunityRepository(h.prisma).requestErasureForUser(
        f[role].id,
        new Date()
      )
      await child.call('continue')
      expect(await dispatch).toEqual({ status: 'fulfilled' })
      await child.call('dispatch', f.delivery.id)
      expect(await h.ledger()).toHaveLength(0)
      expect(
        await h.prisma.communityTokenDelivery.findUniqueOrThrow({
          where: { id: f.delivery.id },
        })
      ).toMatchObject({ status: 'unknown' })
      const attempts = await h.prisma.communityDeliveryAttempt.findMany({
        where: { delivery_id: f.delivery.id },
      })
      expect(attempts).toHaveLength(1)
      expect(attempts[0]).toMatchObject({ status: 'unknown', reason: 'subject_removed' })
      expect(
        await h.prisma.communityArtifactSubject.count({
          where: { member_id: f[role].id },
        })
      ).toBe(0)
    },
    10_000
  )

  it('same claim barrier without erasure fulfills and sends exactly once', async () => {
    const f = await h.fixture('reply')
    const { child } = await h.sender()
    await child.call('barrier', 'claim')
    const dispatch = settle(child.call('dispatch', f.delivery.id))
    await child.event('claimed')
    await child.call('continue')
    expect(await dispatch).toEqual({ status: 'fulfilled' })
    await child.call('dispatch', f.delivery.id)
    expect(await h.ledger()).toHaveLength(1)
    expect(
      await h.prisma.communityTokenDelivery.findUniqueOrThrow({
        where: { id: f.delivery.id },
      })
    ).toMatchObject({ status: 'accepted' })
    const attempts = await h.prisma.communityDeliveryAttempt.findMany({
      where: { delivery_id: f.delivery.id },
    })
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({
      status: 'accepted',
      completed_at: expect.any(Date) as Date,
    })
  }, 10_000)

  it.each(mutations)(
    '$name serializes behind an actual provider guard and does not recreate old work',
    async ({ run, teen, name }) => {
      const f = await h.fixture('reply', teen)
      const immutable = await h.prisma.moderationEvent.create({
        data: {
          post_id: f.post.id,
          action: 'synthetic_prior_review',
          reason: 'Retained audit fact',
        },
      })
      await h.provider.call('mode', 'hold')
      const sender = await h.sender()
      const dispatch = settle(sender.child.call('dispatch', f.delivery.id))
      await h.provider.event('request')
      const start = performance.now()
      const work = run(f)
      const mutation = settle(work)
      await until(
        async () => {
          const rows = await h.prisma.$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND ${sender.backend}::integer = ANY(pg_blocking_pids(pid))`
          return Number(rows[0]!.count)
        },
        (count) => count > 0,
        1000
      )
      await h.provider.call('release')
      await work
      expect(await mutation).toEqual({ status: 'fulfilled' })
      await dispatch
      const elapsedMs = performance.now() - start
      expect(elapsedMs).toBeLessThan(4000)
      await sender.child.call('dispatch', f.delivery.id)
      expect(await h.ledger()).toHaveLength(1)
      expect(
        await h.prisma.moderationEvent.findUnique({ where: { id: immutable.id } })
      ).toMatchObject({ action: 'synthetic_prior_review', reason: 'Retained audit fact' })
      await verifyEffect(name, f)
      if (name.startsWith('account erasure')) {
        const role = name.split(' ').at(-1) as
          | 'actor'
          | 'recipient'
          | 'author'
          | 'parentAuthor'
        expect(
          await h.prisma.communityArtifactSubject.count({
            where: { member_id: f[role].id },
          })
        ).toBe(0)
      }
      console.log(
        JSON.stringify({
          evidence: 'privacy-entrypoint',
          name,
          elapsedMs,
          providerCalls: 1,
        })
      )
    },
    15_000
  )
  it('unguarded direct SQL cannot bypass any privacy mutation trigger', async () => {
    const f = await h.fixture('reply', true)
    const writes = [
      () =>
        h.prisma.lookbookPost.update({
          where: { id: f.post.id },
          data: { status: 'withdrawn' },
        }),
      () => h.prisma.lookbookPost.delete({ where: { id: f.post.id } }),
      () =>
        h.prisma.communityComment.update({
          where: { id: f.comment!.id },
          data: { status: 'author_deleted' },
        }),
      () => h.prisma.communityComment.delete({ where: { id: f.comment!.id } }),
      () => h.prisma.user.delete({ where: { id: f.actor.id } }),
      () =>
        h.prisma.guardianConsent.updateMany({
          where: { teen_id: f.actor.id },
          data: { status: 'revoked' },
        }),
      () => h.prisma.guardianConsent.deleteMany({ where: { teen_id: f.actor.id } }),
      () => h.prisma.pushToken.delete({ where: { id: f.binding.registrationId } }),
      () =>
        h.prisma.pushToken.update({
          where: { id: f.binding.registrationId },
          data: { permission: 'denied' },
        }),
      () =>
        h.prisma.notificationPreference.update({
          where: { user_id: f.recipient.id },
          data: { push_enabled: false },
        }),
      () =>
        h.prisma.communityNotificationPreference.update({
          where: { user_id: f.recipient.id },
          data: { enabled: false },
        }),
    ]
    for (const write of writes)
      await expect(write()).rejects.toThrow('community privacy entry point required')
    expect(
      await h.prisma.lookbookPost.findUnique({ where: { id: f.post.id } })
    ).toMatchObject({ status: 'published' })
    expect(
      await h.prisma.pushToken.count({ where: { id: f.binding.registrationId } })
    ).toBe(1)
  })
})
