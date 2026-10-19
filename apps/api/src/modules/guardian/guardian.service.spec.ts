// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTeenProfileFixture } from '../../../test/factories.js'
import { buildGuardianInvitationEmailTemplate } from './guardian.service'
import { type GuardianInvitationEmailEventPayload } from '../../testing/guardian/in-memory-guardian-prisma'
import {
  createService,
  INVITATION_REFERENCE_TIME,
  DEVELOPMENT_INVITATION_SECRET,
  seedUser,
  registerGuardianServiceLifecycle,
} from '../../testing/guardian/guardian-service.fixture'

describe('GuardianService invitations', () => {
  registerGuardianServiceLifecycle()

  it('creates guardian invitations for teens awaiting consent and queues an email event', async () => {
    vi.setSystemTime(INVITATION_REFERENCE_TIME)
    const teen = createTeenProfileFixture({
      id: 'teen-pending',
      email: 'teen.pending@example.com',
      age: 14,
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

    const result = await service.inviteGuardian(
      teen.id,
      'Guardian.Pending@Example.com',
      'full_access'
    )

    expect(result.teenId).toBe(teen.id)
    expect(result.guardianEmail).toBe('guardian.pending@example.com')
    expect(result.consentLevel).toBe('full_access')
    expect(result.invitationLink).toContain('/guardian/accept?token=')
    expect(prisma.invitations.size).toBe(1)
    expect(prisma.eventEnvelopes).toHaveLength(1)
    expect(prisma.eventEnvelopes[0]?.channel).toBe('email.guardian-invitation')
    const invitationEmailPayload = prisma.eventEnvelopes[0]
      ?.payload as GuardianInvitationEmailEventPayload
    expect(invitationEmailPayload.to).toBe('guardian.pending@example.com')
    expect(invitationEmailPayload.template.templateId).toBe('guardian-consent-invitation')
    expect(invitationEmailPayload.template.subject).toBe(
      'CoutureCast guardian consent invitation'
    )
    expect(invitationEmailPayload.template.text).toContain(result.invitationLink)
    expect(invitationEmailPayload.template.html).toContain(result.invitationLink)
  })

  it('rejects guardian invitations for teens that are not awaiting guardian consent', async () => {
    vi.setSystemTime(INVITATION_REFERENCE_TIME)
    const teen = createTeenProfileFixture({
      id: 'teen-active',
      email: 'teen.active@example.com',
      age: 16,
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

    await expect(
      service.inviteGuardian(teen.id, 'guardian@example.com', 'read_only')
    ).rejects.toThrow(/awaiting consent/)
  })

  it('rejects guardian invitations once the teen has reached adulthood', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-22T03:00:00.000Z'))

    const teen = createTeenProfileFixture({
      id: 'teen-adult',
      email: 'teen.adult@example.com',
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

    await expect(
      service.inviteGuardian(teen.id, 'guardian.adult@example.com', 'read_only')
    ).rejects.toThrow(/no longer required for adult accounts/)
  })

  describe('guardian invitation email template', () => {
    beforeEach(() => vi.setSystemTime(INVITATION_REFERENCE_TIME))
    it('escapes HTML metacharacters so account emails cannot inject markup', () => {
      // The invitation email is sent to an address the teen supplies, so every
      // interpolated value is attacker-influenced and must be escaped.
      const template = buildGuardianInvitationEmailTemplate({
        teenEmail: '"><script>alert(1)</script>&teen@example.com',
        guardianEmail: `o${String.fromCharCode(39)}brien@example.com`,
        consentLevel: 'full_access',
        invitationLink: 'https://app.test/guardian/accept?token=a&b=c',
        expiresAt: new Date('2026-05-01T00:00:00.000Z'),
      })

      expect(template.html).not.toContain('<script>')
      expect(template.html).toContain('&lt;script&gt;')
      expect(template.html).toContain('&quot;')
      expect(template.html).toContain('&#39;')
      expect(template.html).toContain('token=a&amp;b=c')
      expect(template.html).toContain('full access')
      // The text part is never rendered as HTML, so it stays verbatim.
      expect(template.text).toContain('<script>')
      expect(template.text).toContain('https://app.test/guardian/accept?token=a&b=c')
    })
  })

  describe('invitation link base URL resolution', () => {
    beforeEach(() => vi.setSystemTime(INVITATION_REFERENCE_TIME))
    const inviteAndReadLink = async () => {
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-base-url', email: 'teen.baseurl@example.com' })

      const result = await service.inviteGuardian(
        'teen-base-url',
        'guardian.baseurl@example.com',
        'read_only'
      )

      return result.invitationLink
    }

    it('falls back to NEXT_PUBLIC_APP_URL when the guardian base URL is unset', async () => {
      vi.stubEnv('GUARDIAN_INVITE_WEB_BASE_URL', undefined)
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://next.couturecast.test')
      vi.stubEnv('APP_URL', 'https://ignored.couturecast.test')

      await expect(inviteAndReadLink()).resolves.toContain(
        'https://next.couturecast.test/guardian/accept?token='
      )
    })

    it('falls back to APP_URL when no web-specific base URL is configured', async () => {
      vi.stubEnv('GUARDIAN_INVITE_WEB_BASE_URL', undefined)
      vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined)
      vi.stubEnv('APP_URL', 'https://app-url.couturecast.test/')

      // Trailing slashes are normalised away so the link never doubles up.
      await expect(inviteAndReadLink()).resolves.toContain(
        'https://app-url.couturecast.test/guardian/accept?token='
      )
    })

    it('falls back to localhost when nothing is configured', async () => {
      vi.stubEnv('GUARDIAN_INVITE_WEB_BASE_URL', undefined)
      vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined)
      vi.stubEnv('APP_URL', undefined)

      await expect(inviteAndReadLink()).resolves.toContain(
        'http://localhost:3000/guardian/accept?token='
      )
    })
  })

  describe('invitation signing secret resolution', () => {
    beforeEach(() => vi.setSystemTime(INVITATION_REFERENCE_TIME))
    const issueTokenAndReadSignature = async () => {
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-secret', email: 'teen.secret@example.com' })

      const result = await service.inviteGuardian(
        'teen-secret',
        'guardian.secret@example.com',
        'read_only'
      )
      const token = new URL(result.invitationLink).searchParams.get('token') ?? ''
      const [header, body, signature] = token.split('.')

      return { header, body, signature }
    }

    const expectSignedWith = (
      parts: { header?: string; body?: string; signature?: string },
      secret: string
    ) => {
      const expected = createHmac('sha256', secret)
        .update(`${parts.header}.${parts.body}`)
        .digest('base64url')
      expect(parts.signature).toBe(expected)
    }

    it('falls back to the development secret inside the test environment', async () => {
      vi.stubEnv('GUARDIAN_INVITE_JWT_SECRET', undefined)

      expectSignedWith(await issueTokenAndReadSignature(), DEVELOPMENT_INVITATION_SECRET)
    })

    it('treats a whitespace-only configured secret as unset', async () => {
      // A blank env var must not be accepted as a signing key.
      vi.stubEnv('GUARDIAN_INVITE_JWT_SECRET', '   ')

      expectSignedWith(await issueTokenAndReadSignature(), DEVELOPMENT_INVITATION_SECRET)
    })

    it('allows the development secret outside tests only behind an explicit opt-in', async () => {
      vi.stubEnv('GUARDIAN_INVITE_JWT_SECRET', undefined)
      vi.stubEnv('NODE_ENV', 'development')
      vi.stubEnv('ALLOW_DEV_GUARDIAN_SECRET', 'true')

      expectSignedWith(await issueTokenAndReadSignature(), DEVELOPMENT_INVITATION_SECRET)
    })

    it('refuses to sign invitations when no secret is configured in production', async () => {
      // Failing closed here is what stops production issuing forgeable tokens.
      vi.stubEnv('GUARDIAN_INVITE_JWT_SECRET', undefined)
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('ALLOW_DEV_GUARDIAN_SECRET', undefined)

      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-no-secret', email: 'teen.nosecret@example.com' })

      await expect(
        service.inviteGuardian('teen-no-secret', 'guardian.nosecret@example.com')
      ).rejects.toThrow(/GUARDIAN_INVITE_JWT_SECRET is required/)
      // No invitation row may be created when the token cannot be signed.
      expect(prisma.invitations.size).toBe(0)
    })
  })

  describe('inviteGuardian refusals', () => {
    beforeEach(() => vi.setSystemTime(INVITATION_REFERENCE_TIME))
    it('rejects invitations for an unknown teen account', async () => {
      const { prisma, service } = createService()

      await expect(
        service.inviteGuardian('teen-missing', 'guardian.missing@example.com')
      ).rejects.toThrow(/Teen account not found/)
      expect(prisma.invitations.size).toBe(0)
    })

    it('rejects a guardian email that matches the teen account email', async () => {
      // Self-consent would let a minor approve their own wardrobe access.
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-self', email: 'teen.self@example.com' })

      await expect(
        service.inviteGuardian('teen-self', 'Teen.Self@Example.com')
      ).rejects.toThrow(/must differ from the teen account email/)
      expect(prisma.invitations.size).toBe(0)
    })

    it('rejects invitations when the profile carries no compliance block at all', async () => {
      // Missing compliance state must fail closed rather than read as "active".
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-no-prefs',
        email: 'teen.noprefs@example.com',
        preferences: null,
      })

      await expect(
        service.inviteGuardian('teen-no-prefs', 'guardian.noprefs@example.com')
      ).rejects.toThrow(/awaiting consent/)
    })

    it('rejects invitations when compliance state is not an object', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-bad-prefs',
        email: 'teen.badprefs@example.com',
        preferences: { compliance: 'pending_guardian_consent' },
      })

      await expect(
        service.inviteGuardian('teen-bad-prefs', 'guardian.badprefs@example.com')
      ).rejects.toThrow(/awaiting consent/)
    })
  })
})
