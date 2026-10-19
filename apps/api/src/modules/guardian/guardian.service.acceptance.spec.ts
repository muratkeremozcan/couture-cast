// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGuardianProfileFixture,
  createTeenProfileFixture,
} from '../../../test/factories.js'
import {
  createService,
  INVITATION_REFERENCE_TIME,
  seedUser,
  seedInvitation,
  signTokenBody,
  signInvitationToken,
  buildInvitationTokenPayload,
  registerGuardianServiceLifecycle,
} from '../../testing/guardian/guardian-service.fixture'

describe('GuardianService invitation acceptance', () => {
  registerGuardianServiceLifecycle()

  it('accepts invitations, links or creates the guardian account, and records consent', async () => {
    vi.setSystemTime(INVITATION_REFERENCE_TIME)
    const teen = createTeenProfileFixture({
      id: 'teen-consent',
      email: 'teen.consent@example.com',
      age: 14,
    })
    const { prisma, capture, markTeenAccessGranted, service } = createService()
    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        preferences: {
          compliance: {
            accountStatus: 'pending_guardian_consent',
            guardianConsentRequired: true,
          },
        },
      },
    })

    const invite = await service.inviteGuardian(
      teen.id,
      'guardian.accept@example.com',
      'full_access'
    )
    const token = new URL(invite.invitationLink).searchParams.get('token')
    if (!token) {
      throw new Error('Expected invite link to contain a token')
    }

    const accepted = await service.acceptInvitation(token, '203.0.113.44')

    expect(accepted.teenId).toBe(teen.id)
    expect(accepted.teenEmail).toBe(teen.email)
    expect(accepted.guardianEmail).toBe('guardian.accept@example.com')
    expect(accepted.consentLevel).toBe('full_access')

    const consent = [...prisma.consents.values()][0]
    expect(consent).toMatchObject({
      teen_id: teen.id,
      consent_level: 'full_access',
      ip_address: '203.0.113.44',
      revoked_ip_address: null,
      status: 'granted',
    })

    const updatedTeen = prisma.users.get(teen.id)
    const compliance = updatedTeen?.profile?.preferences?.compliance as
      | Record<string, unknown>
      | undefined
    expect(compliance?.accountStatus).toBe('active')
    expect(compliance?.guardianConsentRequired).toBe(false)

    const invitation = [...prisma.invitations.values()][0]
    expect(invitation?.accepted_at).toBeInstanceOf(Date)
    expect(invitation?.accepted_guardian_id).toBeTruthy()
    expect(prisma.auditLogs).toHaveLength(1)
    expect(prisma.auditLogs[0]).toMatchObject({
      user_id: teen.id,
      event_type: 'consent_granted',
      ip_address: '203.0.113.44',
      event_data: {
        guardian_id: accepted.guardianId,
        teen_id: teen.id,
        consent_level: 'full_access',
        ip_address: '203.0.113.44',
      },
    })
    expect(prisma.eventEnvelopes).toHaveLength(3)
    expect(capture).toHaveBeenCalledOnce()
    expect(markTeenAccessGranted).toHaveBeenCalledWith(teen.id)
  })

  it('rejects invitations that were already accepted', async () => {
    vi.setSystemTime(INVITATION_REFERENCE_TIME)
    const teen = createTeenProfileFixture({
      id: 'teen-replay',
      email: 'teen.replay@example.com',
      age: 14,
    })
    const guardian = createGuardianProfileFixture({
      id: 'guardian-replay',
      email: 'guardian.replay@example.com',
    })
    const { prisma, service } = createService()
    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        preferences: {
          compliance: {
            accountStatus: 'pending_guardian_consent',
            guardianConsentRequired: true,
          },
        },
      },
    })
    prisma.users.set(guardian.id, {
      id: guardian.id,
      email: guardian.email,
      profile: null,
    })

    const invite = await service.inviteGuardian(teen.id, guardian.email, 'read_only')
    const token = new URL(invite.invitationLink).searchParams.get('token')
    if (!token) {
      throw new Error('Expected invite link to contain a token')
    }

    await service.acceptInvitation(token, '198.51.100.10')

    await expect(service.acceptInvitation(token, '198.51.100.10')).rejects.toThrow(
      /already been accepted/
    )
  })

  describe('acceptInvitation token verification', () => {
    beforeEach(() => vi.setSystemTime(INVITATION_REFERENCE_TIME))
    const acceptWith = (token: string) => {
      const { service } = createService()
      return service.acceptInvitation(token)
    }

    it('rejects a token that is not three dot-separated segments', async () => {
      await expect(acceptWith('not-a-real-token')).rejects.toThrow(/malformed/)
    })

    it('rejects a token whose signature length has been tampered with', async () => {
      const token = `${signInvitationToken(buildInvitationTokenPayload())}extra`

      await expect(acceptWith(token)).rejects.toThrow(/invalid/)
    })

    it('rejects a token signed with a different secret', async () => {
      // Same signature length, different bytes: this is the timing-safe compare path.
      const token = signInvitationToken(
        buildInvitationTokenPayload(),
        'attacker-controlled-secret'
      )

      await expect(acceptWith(token)).rejects.toThrow(/invalid/)
    })

    it('rejects a correctly signed token whose payload is not JSON', async () => {
      const token = signTokenBody('this-is-not-json')

      await expect(acceptWith(token)).rejects.toThrow(/malformed/)
    })

    it('rejects a correctly signed token whose payload fails the schema', async () => {
      const token = signInvitationToken({
        ...buildInvitationTokenPayload(),
        type: 'password_reset',
      })

      await expect(acceptWith(token)).rejects.toThrow(/invalid/)
    })

    it('rejects a token at its exact expiry boundary', async () => {
      const token = signInvitationToken(
        buildInvitationTokenPayload({
          exp: Math.floor(INVITATION_REFERENCE_TIME.getTime() / 1000),
        })
      )

      await expect(acceptWith(token)).rejects.toThrow(/expired/)
    })
  })

  describe('acceptInvitation refusals', () => {
    beforeEach(() => vi.setSystemTime(INVITATION_REFERENCE_TIME))
    it('rejects a token that references an invitation which no longer exists', async () => {
      const { service } = createService()
      const token = signInvitationToken(
        buildInvitationTokenPayload({ sub: 'invitation-deleted' })
      )

      await expect(service.acceptInvitation(token)).rejects.toThrow(
        /Guardian invitation not found/
      )
    })

    it('rejects an invitation at its stored expiry boundary while the token remains valid', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-seeded', email: 'teen.seeded@example.com' })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
        expiresAt: INVITATION_REFERENCE_TIME,
      })

      await expect(
        service.acceptInvitation(signInvitationToken(buildInvitationTokenPayload()))
      ).rejects.toThrow(/Guardian invitation has expired/)
      expect(prisma.consents.size).toBe(0)
    })

    it.each([
      { field: 'teenId', overrides: { teenId: 'teen-other' } },
      {
        field: 'guardianEmail',
        overrides: { guardianEmail: 'someone.else@example.com' },
      },
      { field: 'consentLevel', overrides: { consentLevel: 'full_access' } },
    ])(
      'rejects a token whose $field disagrees with the stored invitation',
      async ({ overrides }) => {
        // A token must never be able to upgrade or retarget the stored invitation.
        const { prisma, service } = createService()
        seedUser(prisma, { id: 'teen-seeded', email: 'teen.seeded@example.com' })
        seedUser(prisma, { id: 'teen-other', email: 'teen.other@example.com' })
        seedInvitation(prisma, {
          teenId: 'teen-seeded',
          guardianEmail: 'guardian.seeded@example.com',
          consentLevel: 'read_only',
        })

        await expect(
          service.acceptInvitation(
            signInvitationToken(buildInvitationTokenPayload(overrides))
          )
        ).rejects.toThrow(/Guardian invitation token is invalid/)
        expect(prisma.consents.size).toBe(0)
      }
    )

    it('rejects an invitation whose guardian email equals the teen email', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-seeded', email: 'guardian.seeded@example.com' })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
      })

      await expect(
        service.acceptInvitation(signInvitationToken(buildInvitationTokenPayload()))
      ).rejects.toThrow(/must differ from the teen account email/)
      expect(prisma.consents.size).toBe(0)
    })

    it('rejects an invitation when the guardian address resolves to the teen account', async () => {
      // Defence in depth: the address differs but the account behind it is the teen.
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-seeded', email: 'teen.seeded@example.com' })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
      })
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'teen-seeded',
        email: 'guardian.seeded@example.com',
      })

      await expect(
        service.acceptInvitation(signInvitationToken(buildInvitationTokenPayload()))
      ).rejects.toThrow(/must differ from the teen account email/)
      expect(prisma.consents.size).toBe(0)
    })

    it('rejects acceptance once the teen has reached the age of majority', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-seeded',
        email: 'teen.seeded@example.com',
        birthdate: new Date('2000-01-01T00:00:00.000Z'),
      })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
      })

      await expect(
        service.acceptInvitation(signInvitationToken(buildInvitationTokenPayload()))
      ).rejects.toThrow(/no longer required for adult accounts/)
      expect(prisma.consents.size).toBe(0)
    })
  })

  describe('acceptInvitation edge paths', () => {
    beforeEach(() => vi.setSystemTime(INVITATION_REFERENCE_TIME))
    it('accepts one millisecond before the stored invitation expires', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-seeded', email: 'teen.seeded@example.com' })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
        expiresAt: new Date(INVITATION_REFERENCE_TIME.getTime() + 1),
      })

      await expect(
        service.acceptInvitation(signInvitationToken(buildInvitationTokenPayload()))
      ).resolves.toMatchObject({ teenId: 'teen-seeded' })
      expect(prisma.consents.size).toBe(1)
    })

    it('records consent for a teen that has no profile row yet', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-seeded',
        email: 'teen.seeded@example.com',
        withProfile: false,
      })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
      })

      const accepted = await service.acceptInvitation(
        signInvitationToken(buildInvitationTokenPayload())
      )

      expect(accepted.teenId).toBe('teen-seeded')
      expect(prisma.consents.size).toBe(1)
      // Nothing to update when there is no profile, so no write is attempted.
      expect(prisma.userProfile.update).not.toHaveBeenCalled()
      expect(prisma.auditLogs.at(-1)?.event_type).toBe('consent_granted')
    })

    it('stores a null IP rather than an empty string when the address is blank', async () => {
      // Audit records are immutable, so a blank forwarded-for must not be persisted.
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-seeded', email: 'teen.seeded@example.com' })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
      })

      await service.acceptInvitation(
        signInvitationToken(buildInvitationTokenPayload()),
        '   '
      )

      expect(prisma.auditLogs.at(-1)).toMatchObject({
        event_type: 'consent_granted',
        ip_address: null,
        event_data: { ip_address: null },
      })
      expect([...prisma.consents.values()][0]?.ip_address).toBeNull()
    })

    it('rebuilds compliance state when the teen profile has no preferences', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-seeded',
        email: 'teen.seeded@example.com',
        preferences: null,
      })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
      })

      await service.acceptInvitation(signInvitationToken(buildInvitationTokenPayload()))

      expect(prisma.users.get('teen-seeded')?.profile?.preferences).toMatchObject({
        compliance: {
          accountStatus: 'active',
          guardianConsentRequired: false,
          guardianConsentRevokedAt: null,
        },
      })
    })

    it('replaces a non-object compliance block instead of spreading it', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-seeded',
        email: 'teen.seeded@example.com',
        preferences: { theme: 'dark', compliance: 'corrupt' },
      })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
      })

      await service.acceptInvitation(signInvitationToken(buildInvitationTokenPayload()))

      const preferences = prisma.users.get('teen-seeded')?.profile?.preferences
      expect(preferences).toMatchObject({
        theme: 'dark',
        compliance: { accountStatus: 'active', guardianConsentRequired: false },
      })
    })
  })
})
