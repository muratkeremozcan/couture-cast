import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import {
  InjectAnalyticsClient,
  type AnalyticsClient,
} from '../../analytics/analytics.service'
import {
  consentLevelSchema,
  guardianInvitationAcceptResponseSchema,
  guardianInvitationInputSchema,
  guardianInvitationResponseSchema,
  type ConsentLevel,
} from '../../contracts/http'

type InvitationTokenPayload = {
  sub: string
  teenId: string
  guardianEmail: string
  consentLevel: ConsentLevel
  type: 'guardian_invitation'
  iat: number
  exp: number
}

const GUARDIAN_INVITATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEVELOPMENT_INVITATION_SECRET = 'guardian-invite-development-secret'

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '')
}

function resolveInvitationBaseUrl() {
  const configuredBaseUrl =
    process.env.GUARDIAN_INVITE_WEB_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    'http://localhost:3000'

  return normalizeBaseUrl(configuredBaseUrl)
}

function resolveInvitationSecret() {
  const configuredSecret =
    process.env.GUARDIAN_INVITE_JWT_SECRET ?? process.env.JWT_SECRET

  if (configuredSecret?.trim()) {
    return configuredSecret.trim()
  }

  if (process.env.NODE_ENV !== 'production') {
    return DEVELOPMENT_INVITATION_SECRET
  }

  throw new Error('GUARDIAN_INVITE_JWT_SECRET is required in production')
}

function encodeBase64Url(value: string) {
  return Buffer.from(value).toString('base64url')
}

function decodeBase64Url<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T
}

function signJwt(payload: InvitationTokenPayload, secret: string) {
  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = encodeBase64Url(JSON.stringify(payload))
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url')

  return `${header}.${body}.${signature}`
}

function verifyJwt(token: string, secret: string) {
  const [header, body, signature] = token.split('.')

  if (!header || !body || !signature) {
    throw new BadRequestException('Guardian invitation token is malformed')
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url')
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new BadRequestException('Guardian invitation token is invalid')
  }

  const payload = decodeBase64Url<InvitationTokenPayload>(body)

  if (payload.type !== 'guardian_invitation') {
    throw new BadRequestException('Guardian invitation token is invalid')
  }

  if (!consentLevelSchema.safeParse(payload.consentLevel).success) {
    throw new BadRequestException('Guardian invitation token is invalid')
  }

  if (payload.exp * 1000 <= Date.now()) {
    throw new BadRequestException('Guardian invitation token has expired')
  }

  return payload
}

function extractComplianceState(
  preferences: Prisma.JsonValue | null | undefined
): Record<string, unknown> {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    return {}
  }

  const compliance = (preferences as Record<string, unknown>).compliance
  if (!compliance || typeof compliance !== 'object' || Array.isArray(compliance)) {
    return {}
  }

  return compliance as Record<string, unknown>
}

function buildUpdatedPreferences(
  preferences: Prisma.JsonValue | null | undefined,
  grantedAt: Date
): Prisma.InputJsonValue {
  const nextPreferences =
    preferences && typeof preferences === 'object' && !Array.isArray(preferences)
      ? { ...(preferences as Record<string, unknown>) }
      : {}
  const nextCompliance =
    nextPreferences.compliance &&
    typeof nextPreferences.compliance === 'object' &&
    !Array.isArray(nextPreferences.compliance)
      ? { ...(nextPreferences.compliance as Record<string, unknown>) }
      : {}

  nextCompliance.accountStatus = 'active'
  nextCompliance.guardianConsentRequired = false
  nextCompliance.guardianConsentGrantedAt = grantedAt.toISOString()
  nextPreferences.compliance = nextCompliance

  return nextPreferences as Prisma.InputJsonValue
}

@Injectable()
export class GuardianService {
  constructor(
    @InjectAnalyticsClient() private readonly analyticsClient: AnalyticsClient,
    @Inject(PrismaClient) private readonly prisma: PrismaClient
  ) {}

  async inviteGuardian(
    teenId: string,
    guardianEmail: string,
    consentLevel: ConsentLevel = 'read_only'
  ) {
    const parsed = guardianInvitationInputSchema.parse({
      teenId,
      guardianEmail,
      consentLevel,
    })
    const normalizedGuardianEmail = normalizeEmail(parsed.guardianEmail)
    const teen = await this.prisma.user.findUnique({
      where: { id: parsed.teenId },
      include: { profile: true },
    })

    if (!teen) {
      throw new NotFoundException('Teen account not found')
    }

    if (normalizeEmail(teen.email) === normalizedGuardianEmail) {
      throw new BadRequestException(
        'Guardian email must differ from the teen account email'
      )
    }

    const compliance = extractComplianceState(teen.profile?.preferences)
    if (compliance.accountStatus !== 'pending_guardian_consent') {
      throw new BadRequestException(
        'Guardian invitations are only available for teen accounts awaiting consent'
      )
    }

    const expiresAt = new Date(Date.now() + GUARDIAN_INVITATION_TOKEN_TTL_MS)
    const invitation = await this.prisma.guardianInvitation.create({
      data: {
        teen_id: teen.id,
        guardian_email: normalizedGuardianEmail,
        consent_level: parsed.consentLevel,
        expires_at: expiresAt,
      },
    })
    const token = signJwt(
      {
        sub: invitation.id,
        teenId: teen.id,
        guardianEmail: normalizedGuardianEmail,
        consentLevel: parsed.consentLevel,
        type: 'guardian_invitation',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(expiresAt.getTime() / 1000),
      },
      resolveInvitationSecret()
    )
    const invitationLink = `${resolveInvitationBaseUrl()}/guardian/accept?token=${encodeURIComponent(token)}`

    await this.prisma.eventEnvelope.create({
      data: {
        channel: 'email.guardian-invitation',
        user_id: teen.id,
        payload: {
          to: normalizedGuardianEmail,
          teenId: teen.id,
          teenEmail: teen.email,
          invitationId: invitation.id,
          invitationLink,
          consentLevel: parsed.consentLevel,
          expiresAt: expiresAt.toISOString(),
        },
      },
    })

    return guardianInvitationResponseSchema.parse({
      invitationId: invitation.id,
      teenId: teen.id,
      guardianEmail: normalizedGuardianEmail,
      consentLevel: parsed.consentLevel,
      expiresAt: expiresAt.toISOString(),
      invitationLink,
      deliveryQueued: true,
    })
  }

  async acceptInvitation(token: string, ipAddress?: string) {
    const payload = verifyJwt(token, resolveInvitationSecret())
    const normalizedGuardianEmail = normalizeEmail(payload.guardianEmail)
    const acceptedAt = new Date()
    const normalizedIpAddress = ipAddress?.trim() || null

    const result = await this.prisma.$transaction(async (tx) => {
      const invitation = await tx.guardianInvitation.findUnique({
        where: { id: payload.sub },
        include: {
          teen: {
            include: {
              profile: true,
            },
          },
        },
      })

      if (!invitation) {
        throw new NotFoundException('Guardian invitation not found')
      }

      if (invitation.accepted_at) {
        throw new BadRequestException('Guardian invitation has already been accepted')
      }

      if (invitation.expires_at.getTime() <= Date.now()) {
        throw new BadRequestException('Guardian invitation has expired')
      }

      if (
        invitation.teen_id !== payload.teenId ||
        normalizeEmail(invitation.guardian_email) !== normalizedGuardianEmail ||
        invitation.consent_level !== payload.consentLevel
      ) {
        throw new BadRequestException('Guardian invitation token is invalid')
      }

      if (normalizeEmail(invitation.teen.email) === normalizedGuardianEmail) {
        throw new BadRequestException(
          'Guardian email must differ from the teen account email'
        )
      }

      let guardian = await tx.user.findUnique({
        where: { email: normalizedGuardianEmail },
      })

      if (guardian?.id === invitation.teen.id) {
        throw new BadRequestException(
          'Guardian email must differ from the teen account email'
        )
      }

      if (!guardian) {
        guardian = await tx.user.create({
          data: {
            email: normalizedGuardianEmail,
          },
        })
      }

      await tx.guardianConsent.upsert({
        where: {
          guardian_id_teen_id: {
            guardian_id: guardian.id,
            teen_id: invitation.teen.id,
          },
        },
        update: {
          consent_level: invitation.consent_level,
          consent_granted_at: acceptedAt,
          revoked_at: null,
          ip_address: normalizedIpAddress,
          status: 'granted',
        },
        create: {
          guardian_id: guardian.id,
          teen_id: invitation.teen.id,
          consent_level: invitation.consent_level,
          consent_granted_at: acceptedAt,
          revoked_at: null,
          ip_address: normalizedIpAddress,
          status: 'granted',
        },
      })

      if (invitation.teen.profile) {
        await tx.userProfile.update({
          where: { user_id: invitation.teen.id },
          data: {
            preferences: buildUpdatedPreferences(
              invitation.teen.profile.preferences,
              acceptedAt
            ),
          },
        })
      }

      await tx.guardianInvitation.update({
        where: { id: invitation.id },
        data: {
          accepted_at: acceptedAt,
          accepted_guardian_id: guardian.id,
        },
      })

      await tx.eventEnvelope.createMany({
        data: [
          {
            channel: 'email.guardian-consent-confirmation',
            user_id: invitation.teen.id,
            payload: {
              to: invitation.teen.email,
              teenId: invitation.teen.id,
              guardianId: guardian.id,
              guardianEmail: normalizedGuardianEmail,
              consentLevel: invitation.consent_level,
              grantedAt: acceptedAt.toISOString(),
              recipientRole: 'teen',
            },
          },
          {
            channel: 'email.guardian-consent-confirmation',
            user_id: guardian.id,
            payload: {
              to: normalizedGuardianEmail,
              teenId: invitation.teen.id,
              teenEmail: invitation.teen.email,
              guardianId: guardian.id,
              consentLevel: invitation.consent_level,
              grantedAt: acceptedAt.toISOString(),
              recipientRole: 'guardian',
            },
          },
        ],
      })

      return {
        teenId: invitation.teen.id,
        teenEmail: invitation.teen.email,
        guardianId: guardian.id,
        guardianEmail: normalizedGuardianEmail,
        consentLevel: invitation.consent_level,
        grantedAt: acceptedAt.toISOString(),
      }
    })

    this.analyticsClient.capture({
      distinctId: result.guardianId,
      event: 'guardian_consent_granted',
      properties: {
        guardian_id: result.guardianId,
        teen_id: result.teenId,
        consent_level: result.consentLevel,
        timestamp: result.grantedAt,
        consent_timestamp: result.grantedAt,
      },
    })

    return guardianInvitationAcceptResponseSchema.parse(result)
  }
}
