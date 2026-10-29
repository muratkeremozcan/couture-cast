// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
import { describe, expect, it, vi } from 'vitest'
import {
  createGuardianProfileFixture,
  createTeenProfileFixture,
} from '../../../test/factories.js'
import {
  buildPrismaKnownRequestError,
  createService,
  activeCompliancePreferences,
  seedUser,
  seedRevocableConsent,
  registerGuardianServiceLifecycle,
} from '../../testing/guardian/guardian-service.fixture'

describe('GuardianService emancipation', () => {
  registerGuardianServiceLifecycle()

  it('emancipates pending teens on their eighteenth birthday and grants access', async () => {
    const today = new Date('2026-04-22T03:00:00.000Z')
    const teen = createTeenProfileFixture({
      id: 'teen-birthday',
      email: 'teen.birthday@example.com',
      age: 18,
      birthdate: new Date('2008-04-22T12:00:00.000Z'),
    })
    const { markTeenAccessGranted, prisma, service } = createService()

    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        birthdate: teen.birthdate,
        preferences: {
          compliance: {
            accountStatus: 'pending_guardian_consent',
            guardianConsentRequired: true,
          },
        },
      },
    })

    const result = await service.emancipateEligibleTeens(today)

    expect(result).toEqual({
      processed: 1,
      teenIds: [teen.id],
      revokedConsentCount: 0,
      notificationsQueued: 1,
    })

    const compliance = prisma.users.get(teen.id)?.profile?.preferences?.compliance as
      | Record<string, unknown>
      | undefined
    expect(compliance).toMatchObject({
      accountStatus: 'active',
      guardianConsentRequired: false,
      guardianConsentAgedOutAt: today.toISOString(),
    })
    expect(prisma.eventEnvelopes[0]).toMatchObject({
      channel: 'email.guardian-consent-aged-out',
      user_id: teen.id,
    })
    expect(prisma.auditLogs.at(-1)).toMatchObject({
      user_id: teen.id,
      event_type: 'guardian_consent_aged_out',
      event_data: {
        teen_id: teen.id,
        revoked_guardian_access: true,
        revoked_guardian_count: 0,
      },
    })
    expect(markTeenAccessGranted).toHaveBeenCalledWith(teen.id)
  })

  it.each([
    {
      name: 'the serializable transaction hits a write conflict',
      error: Object.assign(new Error('serialization failure'), { code: 'P2034' }),
    },
    {
      name: 'the plpgsql_check pldbgapi2 stack error (XX000) aborts it',
      error: buildPrismaKnownRequestError('P2010', {
        code: 'XX000',
        message: 'ERROR: cannot find parent statement on pldbgapi2 call stack',
      }),
    },
  ])('retries emancipation when $name', async ({ error }) => {
    const today = new Date('2026-04-22T03:00:00.000Z')
    const teen = createTeenProfileFixture({
      id: 'teen-emancipation-retry',
      email: 'teen.emancipation.retry@example.com',
      age: 18,
      birthdate: new Date('2008-04-22T12:00:00.000Z'),
    })
    const { prisma, service } = createService()

    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        birthdate: teen.birthdate,
        preferences: {
          compliance: {
            accountStatus: 'pending_guardian_consent',
            guardianConsentRequired: true,
          },
        },
      },
    })

    const originalTransaction = prisma.$transaction
    let attempts = 0
    prisma.$transaction = vi.fn(async (callback, options) => {
      attempts += 1
      expect(options).toMatchObject({
        isolationLevel: 'Serializable',
      })

      if (attempts === 1) {
        throw error
      }

      return originalTransaction(callback, options)
    })

    await expect(service.emancipateEligibleTeens(today)).resolves.toEqual({
      processed: 1,
      teenIds: [teen.id],
      revokedConsentCount: 0,
      notificationsQueued: 1,
    })

    expect(attempts).toBe(2)
  })

  it('revokes active guardian links by default when a teen ages out of consent', async () => {
    const today = new Date('2026-04-22T03:00:00.000Z')
    const teen = createTeenProfileFixture({
      id: 'teen-emancipated',
      email: 'teen.emancipated@example.com',
      age: 18,
      birthdate: new Date('2008-04-22T12:00:00.000Z'),
    })
    const guardian = createGuardianProfileFixture({
      id: 'guardian-emancipated',
      email: 'guardian.emancipated@example.com',
    })
    const { markTeenAccessGranted, prisma, service } = createService()

    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        birthdate: teen.birthdate,
        preferences: {
          compliance: {
            accountStatus: 'active',
            guardianConsentRequired: false,
            guardianConsentGrantedAt: '2026-04-15T03:00:00.000Z',
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
      consent_granted_at: new Date('2026-04-15T03:00:00.000Z'),
      revoked_at: null,
      ip_address: '198.51.100.10',
      revoked_ip_address: null,
      status: 'granted',
    })

    const result = await service.emancipateEligibleTeens(today)

    expect(result).toEqual({
      processed: 1,
      teenIds: [teen.id],
      revokedConsentCount: 1,
      notificationsQueued: 1,
    })

    const consent = prisma.consents.get(`${guardian.id}:${teen.id}`)
    expect(consent).toMatchObject({
      status: 'revoked',
      revoked_at: today,
      revoked_ip_address: null,
    })

    const compliance = prisma.users.get(teen.id)?.profile?.preferences?.compliance as
      | Record<string, unknown>
      | undefined
    expect(compliance).toMatchObject({
      accountStatus: 'active',
      guardianConsentRequired: false,
      guardianConsentAgedOutAt: today.toISOString(),
      guardianConsentRevokedAt: today.toISOString(),
    })
    const revokedAuditLog = prisma.auditLogs.find(
      (entry) => entry.user_id === teen.id && entry.event_type === 'consent_revoked'
    )
    expect(revokedAuditLog).toBeDefined()
    if (!revokedAuditLog?.event_data) {
      throw new Error('Expected consent_revoked audit log with event data')
    }
    expect(revokedAuditLog.event_data).toMatchObject({
      guardian_id: guardian.id,
      teen_id: teen.id,
      consent_level: 'full_access',
    })

    const agedOutAuditLog = prisma.auditLogs.find(
      (entry) =>
        entry.user_id === teen.id && entry.event_type === 'guardian_consent_aged_out'
    )
    expect(agedOutAuditLog).toBeDefined()
    if (!agedOutAuditLog?.event_data) {
      throw new Error('Expected guardian_consent_aged_out audit log with event data')
    }
    expect(agedOutAuditLog.event_data).toMatchObject({
      teen_id: teen.id,
      revoked_guardian_access: true,
      revoked_guardian_count: 1,
    })
    expect(markTeenAccessGranted).toHaveBeenCalledWith(teen.id)
  })

  it('can keep guardian links after emancipation when the config disables auto-revocation', async () => {
    process.env.GUARDIAN_EMANCIPATION_REVOKE_CONSENTS = 'false'

    const today = new Date('2026-04-22T03:00:00.000Z')
    const teen = createTeenProfileFixture({
      id: 'teen-configurable',
      email: 'teen.configurable@example.com',
      age: 18,
      birthdate: new Date('2008-04-22T12:00:00.000Z'),
    })
    const guardian = createGuardianProfileFixture({
      id: 'guardian-configurable',
      email: 'guardian.configurable@example.com',
    })
    const { prisma, service } = createService()

    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        birthdate: teen.birthdate,
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
      consent_granted_at: new Date('2026-04-12T03:00:00.000Z'),
      revoked_at: null,
      ip_address: '198.51.100.20',
      revoked_ip_address: null,
      status: 'granted',
    })

    const result = await service.emancipateEligibleTeens(today)

    expect(result).toEqual({
      processed: 1,
      teenIds: [teen.id],
      revokedConsentCount: 0,
      notificationsQueued: 1,
    })

    const consent = prisma.consents.get(`${guardian.id}:${teen.id}`)
    expect(consent).toMatchObject({
      status: 'granted',
      revoked_at: null,
    })
    expect(prisma.auditLogs.at(-1)).toMatchObject({
      user_id: teen.id,
      event_type: 'guardian_consent_aged_out',
      event_data: {
        teen_id: teen.id,
        active_guardian_count: 1,
        revoked_guardian_access: false,
        revoked_guardian_count: 0,
      },
    })
  })

  describe('emancipateEligibleTeens skip conditions', () => {
    const TODAY = new Date('2026-04-22T03:00:00.000Z')
    const ADULT_BIRTHDATE = new Date('2008-04-22T12:00:00.000Z')

    it('skips candidates whose profile row is missing', async () => {
      const { prisma, service } = createService()
      prisma.user.findMany.mockResolvedValueOnce([
        { id: 'teen-no-profile', email: 'teen.noprofile@example.com', profile: null },
      ])

      await expect(service.emancipateEligibleTeens(TODAY)).resolves.toEqual({
        processed: 0,
        teenIds: [],
        revokedConsentCount: 0,
        notificationsQueued: 0,
      })
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('skips teens that were already aged out so the cron stays idempotent', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-already-aged-out',
        email: 'teen.agedout@example.com',
        birthdate: ADULT_BIRTHDATE,
        preferences: {
          compliance: {
            accountStatus: 'active',
            guardianConsentAgedOutAt: '2026-04-21T00:00:00.000Z',
          },
        },
      })

      await expect(service.emancipateEligibleTeens(TODAY)).resolves.toMatchObject({
        processed: 0,
        notificationsQueued: 0,
      })
      expect(prisma.auditLogs).toHaveLength(0)
    })

    it('treats a blank aged-out marker as not yet aged out', async () => {
      // A whitespace-only timestamp is corrupt state, not a completed emancipation.
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-blank-marker',
        email: 'teen.blank@example.com',
        birthdate: ADULT_BIRTHDATE,
        preferences: {
          compliance: {
            accountStatus: 'pending_guardian_consent',
            guardianConsentAgedOutAt: '   ',
          },
        },
      })

      await expect(service.emancipateEligibleTeens(TODAY)).resolves.toMatchObject({
        processed: 1,
        teenIds: ['teen-blank-marker'],
      })
    })

    it('skips adults that neither require guardian consent nor have an active link', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-unmanaged',
        email: 'teen.unmanaged@example.com',
        birthdate: ADULT_BIRTHDATE,
        preferences: activeCompliancePreferences(),
      })

      await expect(service.emancipateEligibleTeens(TODAY)).resolves.toMatchObject({
        processed: 0,
      })
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('emancipates an adult whose only signal is an active guardian link', async () => {
      const { prisma, service } = createService()
      const { teenId } = seedRevocableConsent(prisma, null)
      const teen = prisma.users.get(teenId)
      if (teen?.profile) {
        teen.profile.birthdate = ADULT_BIRTHDATE
      }

      await expect(service.emancipateEligibleTeens(TODAY)).resolves.toMatchObject({
        processed: 1,
        revokedConsentCount: 1,
      })
      expect(prisma.users.get(teenId)?.profile?.preferences).toMatchObject({
        compliance: {
          accountStatus: 'active',
          guardianConsentRequired: false,
          guardianConsentAgedOutAt: TODAY.toISOString(),
          guardianConsentRevokedAt: TODAY.toISOString(),
        },
      })
    })

    it('replaces a non-object compliance block during emancipation', async () => {
      const { prisma, service } = createService()
      const { teenId } = seedRevocableConsent(prisma, { compliance: ['corrupt'] })
      const teen = prisma.users.get(teenId)
      if (teen?.profile) {
        teen.profile.birthdate = ADULT_BIRTHDATE
      }

      await expect(service.emancipateEligibleTeens(TODAY)).resolves.toMatchObject({
        processed: 1,
      })
      expect(prisma.users.get(teenId)?.profile?.preferences).toMatchObject({
        compliance: { accountStatus: 'active', guardianConsentRequired: false },
      })
    })

    it.each([
      {
        name: 'the teen row disappeared before the transaction opened',
        reread: null,
      },
      {
        name: 'the teen profile was deleted before the transaction opened',
        reread: {
          id: 'teen-race',
          email: 'teen.race@example.com',
          profile: null,
          teen_roles: [],
        },
      },
      {
        name: 'the birthdate was corrected to a minor before the transaction opened',
        reread: {
          id: 'teen-race',
          email: 'teen.race@example.com',
          profile: {
            user_id: 'teen-race',
            birthdate: new Date('2012-04-22T12:00:00.000Z'),
            preferences: {
              compliance: { accountStatus: 'pending_guardian_consent' },
            },
          },
          teen_roles: [],
        },
      },
      {
        name: 'a concurrent run already aged the teen out',
        reread: {
          id: 'teen-race',
          email: 'teen.race@example.com',
          profile: {
            user_id: 'teen-race',
            birthdate: new Date('2008-04-22T12:00:00.000Z'),
            preferences: {
              compliance: { guardianConsentAgedOutAt: '2026-04-22T02:00:00.000Z' },
            },
          },
          teen_roles: [],
        },
      },
      {
        name: 'the last guardian link was revoked before the transaction opened',
        reread: {
          id: 'teen-race',
          email: 'teen.race@example.com',
          profile: {
            user_id: 'teen-race',
            birthdate: new Date('2008-04-22T12:00:00.000Z'),
            preferences: { compliance: { accountStatus: 'active' } },
          },
          teen_roles: [],
        },
      },
    ])('takes no action when $name', async ({ reread }) => {
      // The candidate scan is not transactional, so the in-transaction re-check is
      // the only thing preventing a duplicated or wrongly-issued emancipation.
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-race',
        email: 'teen.race@example.com',
        birthdate: ADULT_BIRTHDATE,
      })
      prisma.user.findUnique.mockResolvedValueOnce(reread)

      await expect(service.emancipateEligibleTeens(TODAY)).resolves.toEqual({
        processed: 0,
        teenIds: [],
        revokedConsentCount: 0,
        notificationsQueued: 0,
      })
      expect(prisma.auditLogs).toHaveLength(0)
      expect(prisma.eventEnvelopes).toHaveLength(0)
    })
  })
})
