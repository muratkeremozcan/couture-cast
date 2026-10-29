// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
import { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import {
  createGuardianProfileFixture,
  createTeenProfileFixture,
} from '../../../test/factories.js'
import {
  createService,
  seedUser,
  seedRevocableConsent,
  buildPrismaKnownRequestError,
  registerGuardianServiceLifecycle,
} from '../../testing/guardian/guardian-service.fixture'

describe('GuardianService consent revocation', () => {
  registerGuardianServiceLifecycle()

  it('revokes the last active guardian consent, queues a notification, and invalidates teen access', async () => {
    const teen = createTeenProfileFixture({
      id: 'teen-revoke',
      email: 'teen.revoke@example.com',
      age: 14,
    })
    const guardian = createGuardianProfileFixture({
      id: 'guardian-revoke',
      email: 'guardian.revoke@example.com',
    })
    const { prisma, capture, invalidateUserSessions, markTeenAccessRevoked, service } =
      createService()

    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        preferences: {
          compliance: {
            accountStatus: 'active',
            guardianConsentRequired: false,
            guardianConsentGrantedAt: '2026-04-17T06:00:00.000Z',
          },
        },
      },
    })
    prisma.users.set(guardian.id, {
      id: guardian.id,
      email: guardian.email,
      profile: null,
    })
    prisma.consents.set(`${guardian.id}:${teen.id}`, {
      guardian_id: guardian.id,
      teen_id: teen.id,
      consent_level: 'full_access',
      consent_granted_at: new Date('2026-04-17T06:00:00.000Z'),
      revoked_at: null,
      ip_address: '198.51.100.10',
      revoked_ip_address: null,
      status: 'granted',
    })

    const result = await service.revokeConsent(guardian.id, teen.id, '203.0.113.99')

    expect(result).toMatchObject({
      guardianId: guardian.id,
      teenId: teen.id,
      remainingActiveGuardians: 0,
      sessionInvalidated: true,
      notificationQueued: true,
    })

    const revokedConsent = prisma.consents.get(`${guardian.id}:${teen.id}`)
    expect(revokedConsent).toMatchObject({
      status: 'revoked',
      ip_address: '198.51.100.10',
      revoked_ip_address: '203.0.113.99',
    })
    expect(revokedConsent?.revoked_at).toBeInstanceOf(Date)

    const compliance = prisma.users.get(teen.id)?.profile?.preferences?.compliance as
      | Record<string, unknown>
      | undefined
    expect(compliance).toMatchObject({
      accountStatus: 'pending_guardian_consent',
      guardianConsentRequired: true,
      guardianConsentGrantedAt: null,
    })

    expect(prisma.eventEnvelopes).toHaveLength(1)
    expect(prisma.eventEnvelopes[0]).toMatchObject({
      channel: 'email.guardian-consent-revoked',
      user_id: teen.id,
    })

    expect(prisma.auditLogs.at(-1)).toMatchObject({
      user_id: teen.id,
      event_type: 'consent_revoked',
      ip_address: '203.0.113.99',
      event_data: {
        guardian_id: guardian.id,
        teen_id: teen.id,
        consent_level: 'full_access',
      },
    })
    expect(invalidateUserSessions).toHaveBeenCalledWith(teen.id)
    expect(markTeenAccessRevoked).toHaveBeenCalledWith(teen.id)
    expect(prisma.garmentItem.updateMany).toHaveBeenCalledOnce()
    const retentionUpdate = prisma.garmentItem.updateMany.mock.calls[0]?.[0]
    expect(retentionUpdate).toMatchObject({
      where: {
        user_id: teen.id,
        retention_status: 'active',
      },
      data: {
        retention_status: 'deletion_pending',
        retention_trigger: 'guardian_consent_revoked',
      },
    })
    expect(retentionUpdate?.data.deletion_requested_at).toBeInstanceOf(Date)

    // Story 6.1 HIGH-1: `consent_suspended` had NO PRODUCER. The enum member
    // existed, both feed status filters honoured it, nine locales shipped copy
    // and Pact asserted it, and nothing ever wrote it, so a 13-to-15-year-old's
    // published post stayed live after their guardian's consent lapsed. The
    // integration test that covered it inserted a row ALREADY at
    // `consent_suspended` and asserted the read filters, so no test drove the
    // transition. This one drives it.
    expect(prisma.lookbookPost.updateMany).toHaveBeenCalledOnce()
    const suspension = prisma.lookbookPost.updateMany.mock.calls[0]?.[0]
    expect(suspension).toMatchObject({
      where: { user_id: teen.id },
      data: { status: 'consent_suspended' },
    })
    // `pending_review` as well as `published`: the moderation processor
    // publishes with `where: { id, status: 'pending_review' }`, so moving the row
    // out of that status is what stops a post already in the screening queue
    // from going live seconds after consent lapsed.
    expect(suspension?.where.status.in).toEqual(
      expect.arrayContaining(['published', 'pending_review'])
    )
    // `flagged` and `review_failed` are deliberately left alone: both are
    // already invisible and both carry a moderation verdict that folding them
    // into `consent_suspended` would erase.
    expect(suspension?.where.status.in).not.toContain('flagged')
    expect(suspension?.where.status.in).not.toContain('review_failed')

    expect(capture).toHaveBeenCalledOnce()
    const analyticsEvent = capture.mock.calls[0]?.[0]
    expect(analyticsEvent).toMatchObject({
      distinctId: guardian.id,
      event: 'guardian_consent_revoked',
    })
    expect(analyticsEvent?.properties).toMatchObject({
      guardian_id: guardian.id,
      teen_id: teen.id,
      consent_level: 'full_access',
      remainingActiveGuardians: 0,
      sessionInvalidated: true,
    })
  })

  it('keeps teen access active when another guardian consent remains', async () => {
    const teen = createTeenProfileFixture({
      id: 'teen-multi',
      email: 'teen.multi@example.com',
      age: 14,
    })
    const revokingGuardian = createGuardianProfileFixture({
      id: 'guardian-a',
      email: 'guardian.a@example.com',
    })
    const remainingGuardian = createGuardianProfileFixture({
      id: 'guardian-b',
      email: 'guardian.b@example.com',
    })
    const { prisma, invalidateUserSessions, markTeenAccessGranted, service } =
      createService()

    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        preferences: {
          compliance: {
            accountStatus: 'active',
            guardianConsentRequired: false,
          },
        },
      },
    })
    prisma.users.set(revokingGuardian.id, {
      id: revokingGuardian.id,
      email: revokingGuardian.email,
      profile: null,
    })
    prisma.users.set(remainingGuardian.id, {
      id: remainingGuardian.id,
      email: remainingGuardian.email,
      profile: null,
    })
    prisma.consents.set(`${revokingGuardian.id}:${teen.id}`, {
      guardian_id: revokingGuardian.id,
      teen_id: teen.id,
      consent_level: 'read_only',
      consent_granted_at: new Date('2026-04-17T06:00:00.000Z'),
      revoked_at: null,
      ip_address: '198.51.100.10',
      revoked_ip_address: null,
      status: 'granted',
    })
    prisma.consents.set(`${remainingGuardian.id}:${teen.id}`, {
      guardian_id: remainingGuardian.id,
      teen_id: teen.id,
      consent_level: 'full_access',
      consent_granted_at: new Date('2026-04-18T06:00:00.000Z'),
      revoked_at: null,
      ip_address: '198.51.100.11',
      revoked_ip_address: null,
      status: 'granted',
    })

    const result = await service.revokeConsent(
      revokingGuardian.id,
      teen.id,
      '203.0.113.100'
    )

    expect(result).toMatchObject({
      remainingActiveGuardians: 1,
      sessionInvalidated: false,
    })

    const compliance = prisma.users.get(teen.id)?.profile?.preferences?.compliance as
      | Record<string, unknown>
      | undefined
    expect(compliance).toMatchObject({
      accountStatus: 'active',
      guardianConsentRequired: false,
    })
    expect(compliance?.guardianConsentRevokedAt).toBeUndefined()
    expect(invalidateUserSessions).not.toHaveBeenCalled()
    expect(markTeenAccessGranted).toHaveBeenCalledWith(teen.id)
    // Consent has not lapsed while another guardian still holds it, so the
    // member's community posts stay published. The suspension is keyed on the
    // last active consent going, not on any one guardian withdrawing.
    expect(prisma.lookbookPost.updateMany).not.toHaveBeenCalled()
  })

  it('retries revokeConsent when the serializable transaction hits a write conflict', async () => {
    const teen = createTeenProfileFixture({
      id: 'teen-retry',
      email: 'teen.retry@example.com',
      age: 14,
    })
    const guardian = createGuardianProfileFixture({
      id: 'guardian-retry',
      email: 'guardian.retry@example.com',
    })
    const { prisma, service } = createService()

    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        preferences: {
          compliance: {
            accountStatus: 'active',
            guardianConsentRequired: false,
          },
        },
      },
    })
    prisma.users.set(guardian.id, {
      id: guardian.id,
      email: guardian.email,
      profile: null,
    })
    prisma.consents.set(`${guardian.id}:${teen.id}`, {
      guardian_id: guardian.id,
      teen_id: teen.id,
      consent_level: 'read_only',
      consent_granted_at: new Date('2026-04-18T06:00:00.000Z'),
      revoked_at: null,
      ip_address: '198.51.100.15',
      revoked_ip_address: null,
      status: 'granted',
    })

    const originalTransaction = prisma.$transaction
    let attempts = 0
    prisma.$transaction = vi.fn(async (callback, options) => {
      attempts += 1
      expect(options).toMatchObject({
        isolationLevel: 'ReadCommitted',
      })

      if (attempts === 1) {
        throw Object.assign(new Error('serialization failure'), { code: 'P2034' })
      }

      return originalTransaction(callback, options)
    })

    await expect(
      service.revokeConsent(guardian.id, teen.id, '203.0.113.101')
    ).resolves.toMatchObject({
      guardianId: guardian.id,
      teenId: teen.id,
      remainingActiveGuardians: 0,
    })

    expect(attempts).toBe(2)
  })

  describe('revokeConsent refusals and edge paths', () => {
    it('refuses to revoke when there is no active consent to revoke', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-none', email: 'teen.none@example.com' })

      await expect(
        service.revokeConsent('guardian-none', 'teen-none', '203.0.113.5')
      ).rejects.toThrow(/Active guardian consent not found/)
      expect(prisma.auditLogs).toHaveLength(0)
      expect(prisma.eventEnvelopes).toHaveLength(0)
    })

    it('stores a null revoking IP when no address is supplied', async () => {
      const { prisma, service } = createService()
      const { guardianId, teenId } = seedRevocableConsent(prisma)

      await service.revokeConsent(guardianId, teenId)

      expect(
        prisma.consents.get(`${guardianId}:${teenId}`)?.revoked_ip_address
      ).toBeNull()
      expect(prisma.auditLogs.at(-1)).toMatchObject({
        event_type: 'consent_revoked',
        ip_address: null,
      })
    })

    it('rebuilds compliance state on revocation when preferences are absent', async () => {
      const { prisma, service } = createService()
      const { guardianId, teenId } = seedRevocableConsent(prisma, null)

      await service.revokeConsent(guardianId, teenId, '203.0.113.6')

      expect(prisma.users.get(teenId)?.profile?.preferences).toMatchObject({
        compliance: {
          accountStatus: 'pending_guardian_consent',
          guardianConsentRequired: true,
          guardianConsentGrantedAt: null,
        },
      })
    })
  })

  describe('serializable transaction retry classification', () => {
    const runRevokeWithFailure = (error: unknown, failures: number) => {
      const { prisma, service } = createService()
      const { guardianId, teenId } = seedRevocableConsent(prisma)
      const originalTransaction = prisma.$transaction
      let attempts = 0

      prisma.$transaction = vi.fn(async (callback, options) => {
        attempts += 1
        if (attempts <= failures) {
          throw error
        }

        return originalTransaction(callback, options)
      })

      const promise = service.revokeConsent(guardianId, teenId, '203.0.113.7')

      return { attempts: () => attempts, promise }
    }

    it.each([
      {
        name: 'a Prisma P2034 write conflict',
        error: buildPrismaKnownRequestError('P2034'),
      },
      {
        name: 'a Prisma error whose meta.code is SQLSTATE 40001',
        error: buildPrismaKnownRequestError('P2010', { code: '40001' }),
      },
      {
        name: 'a Prisma error whose meta.sqlstate is 40001',
        error: buildPrismaKnownRequestError('P2010', { sqlstate: '40001' }),
      },
      {
        name: 'a plain object carrying meta.code 40001',
        error: { meta: { code: '40001' } },
      },
      {
        name: 'a plain object carrying meta.sqlstate 40001',
        error: { meta: { sqlstate: '40001' } },
      },
      {
        name: 'a bare Error whose message embeds SQLSTATE 40001',
        error: new Error('could not serialize access (40001)'),
      },
      {
        name: 'the plpgsql_check pldbgapi2 stack error (XX000)',
        error: buildPrismaKnownRequestError('P2010', {
          code: 'XX000',
          message: 'ERROR: cannot find parent statement on pldbgapi2 call stack',
        }),
      },
    ])('retries revocation after $name', async ({ error }) => {
      const { attempts, promise } = runRevokeWithFailure(error, 1)

      await expect(promise).resolves.toMatchObject({ sessionInvalidated: true })
      expect(attempts()).toBe(2)
    })

    it.each([
      {
        name: 'an unrelated Prisma error code',
        error: buildPrismaKnownRequestError('P2025'),
      },
      {
        name: 'a Prisma error whose meta holds no recognisable code',
        error: buildPrismaKnownRequestError('P2010', { hint: 'nope' }),
      },
      { name: 'a plain object with an empty meta', error: { meta: {} } },
      { name: 'an object with no code, meta, or message', error: {} },
      { name: 'an object whose message is not a string', error: { message: 42 } },
      { name: 'a thrown string', error: 'connection reset by peer' },
      {
        name: 'another XX000 internal error',
        error: buildPrismaKnownRequestError('P2010', {
          code: 'XX000',
          message: 'ERROR: unexpected internal state',
        }),
      },
    ])('rethrows immediately after $name', async ({ error }) => {
      const { attempts, promise } = runRevokeWithFailure(error, 1)

      await expect(promise).rejects.toBeDefined()
      expect(attempts()).toBe(1)
    })

    it('gives up on a repeating pldbgapi2 stack error and surfaces it', async () => {
      const error = buildPrismaKnownRequestError('P2010', {
        code: 'XX000',
        message: 'ERROR: cannot find parent statement on pldbgapi2 call stack',
      })
      const { attempts, promise } = runRevokeWithFailure(error, 3)

      await expect(promise).rejects.toBe(error)
      expect(attempts()).toBe(3)
    })

    it('gives up after exhausting the retry budget', async () => {
      const { attempts, promise } = runRevokeWithFailure(
        buildPrismaKnownRequestError('P2034'),
        3
      )

      await expect(promise).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
      expect(attempts()).toBe(3)
    })

    it('rethrows a non-retryable failure raised during emancipation', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-emancipate-error',
        email: 'teen.emancipate.error@example.com',
        birthdate: new Date('2008-04-22T12:00:00.000Z'),
      })
      prisma.$transaction = vi.fn(() => {
        throw buildPrismaKnownRequestError('P2025')
      })

      await expect(
        service.emancipateEligibleTeens(new Date('2026-04-22T03:00:00.000Z'))
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
    })
  })
})
