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
  guardianConsentRevokeResponseSchema,
  guardianInvitationAcceptResponseSchema,
  guardianInvitationInputSchema,
  guardianInvitationResponseSchema,
  type ConsentLevel,
} from '../../contracts/http'
import { z } from 'zod'

type InvitationTokenPayload = {
  sub: string
  teenId: string
  guardianEmail: string
  consentLevel: ConsentLevel
  type: 'guardian_invitation'
  iat: number
  exp: number
}

type ConsentAuditEvent = {
  eventType: 'consent_granted' | 'consent_revoked' | 'guardian_deleted'
  teenId: string
  guardianId: string
  consentLevel?: ConsentLevel
  ipAddress?: string | null
  timestamp: Date
}

const GUARDIAN_INVITATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEVELOPMENT_INVITATION_SECRET = 'guardian-invite-development-secret'
const invitationTokenPayloadSchema = z.object({
  sub: z.string().min(1),
  teenId: z.string().min(1),
  guardianEmail: z.string().email(),
  consentLevel: consentLevelSchema,
  type: z.literal('guardian_invitation'),
  iat: z.number().int(),
  exp: z.number().int(),
})

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
  const configuredSecret = process.env.GUARDIAN_INVITE_JWT_SECRET
  if (configuredSecret?.trim()) {
    return configuredSecret.trim()
  }

  if (
    process.env.NODE_ENV === 'test' ||
    process.env.ALLOW_DEV_GUARDIAN_SECRET === 'true'
  ) {
    return DEVELOPMENT_INVITATION_SECRET
  }

  throw new Error('GUARDIAN_INVITE_JWT_SECRET is required for guardian invitation tokens')
}

function encodeBase64Url(value: string) {
  return Buffer.from(value).toString('base64url')
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
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

  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(decodeBase64Url(body))
  } catch {
    throw new BadRequestException('Guardian invitation token is malformed')
  }

  const parsedPayload = invitationTokenPayloadSchema.safeParse(parsedBody)
  if (!parsedPayload.success) {
    throw new BadRequestException('Guardian invitation token is invalid')
  }

  const payload: InvitationTokenPayload = parsedPayload.data

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
  nextCompliance.guardianConsentRevokedAt = null
  nextPreferences.compliance = nextCompliance

  return nextPreferences as Prisma.InputJsonValue
}

function buildRevokedPreferences(
  preferences: Prisma.JsonValue | null | undefined,
  revokedAt: Date
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

  nextCompliance.accountStatus = 'pending_guardian_consent'
  nextCompliance.guardianConsentRequired = true
  nextCompliance.guardianConsentGrantedAt = null
  nextCompliance.guardianConsentRevokedAt = revokedAt.toISOString()
  nextPreferences.compliance = nextCompliance

  return nextPreferences as Prisma.InputJsonValue
}

function buildConsentAuditPayload(event: ConsentAuditEvent): Prisma.InputJsonValue {
  return {
    guardian_id: event.guardianId,
    teen_id: event.teenId,
    consent_level: event.consentLevel ?? null,
    ip_address: event.ipAddress ?? null,
    timestamp: event.timestamp.toISOString(),
  } satisfies Record<string, string | null>
}

@Injectable()
export class GuardianService {
  constructor(
    @InjectAnalyticsClient() private readonly analyticsClient: AnalyticsClient,
    @Inject(PrismaClient) private readonly prisma: PrismaClient
  ) {}

  private logConsentAuditEvent(tx: Prisma.TransactionClient, event: ConsentAuditEvent) {
    return tx.auditLog.create({
      data: {
        user_id: event.teenId,
        event_type: event.eventType,
        event_data: buildConsentAuditPayload(event),
        timestamp: event.timestamp,
        ip_address: event.ipAddress ?? null,
      },
    })
  }

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
    const invitationSecret = resolveInvitationSecret()
    const invitationBaseUrl = resolveInvitationBaseUrl()
    const { invitation, invitationLink } = await this.prisma.$transaction(async (tx) => {
      const createdInvitation = await tx.guardianInvitation.create({
        data: {
          teen_id: teen.id,
          guardian_email: normalizedGuardianEmail,
          consent_level: parsed.consentLevel,
          expires_at: expiresAt,
        },
      })
      const token = signJwt(
        {
          sub: createdInvitation.id,
          teenId: teen.id,
          guardianEmail: normalizedGuardianEmail,
          consentLevel: parsed.consentLevel,
          type: 'guardian_invitation',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(expiresAt.getTime() / 1000),
        },
        invitationSecret
      )
      const nextInvitationLink = `${invitationBaseUrl}/guardian/accept?token=${encodeURIComponent(token)}`

      await tx.eventEnvelope.create({
        data: {
          channel: 'email.guardian-invitation',
          user_id: teen.id,
          payload: {
            to: normalizedGuardianEmail,
            teenId: teen.id,
            teenEmail: teen.email,
            invitationId: createdInvitation.id,
            invitationLink: nextInvitationLink,
            consentLevel: parsed.consentLevel,
            expiresAt: expiresAt.toISOString(),
          },
        },
      })

      return {
        invitation: createdInvitation,
        invitationLink: nextInvitationLink,
      }
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

      await this.logConsentAuditEvent(tx, {
        eventType: 'consent_granted',
        teenId: invitation.teen.id,
        guardianId: guardian.id,
        consentLevel: invitation.consent_level,
        ipAddress: normalizedIpAddress,
        timestamp: acceptedAt,
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

  async revokeConsent(guardianId: string, teenId: string, ipAddress?: string) {
    const revokedAt = new Date()
    const normalizedIpAddress = ipAddress?.trim() || null

    const result = await this.prisma.$transaction(async (tx) => {
      const consent = await tx.guardianConsent.findFirst({
        where: {
          guardian_id: guardianId,
          teen_id: teenId,
          status: 'granted',
          revoked_at: null,
        },
        include: {
          guardian: true,
          teen: {
            include: {
              profile: true,
            },
          },
        },
      })

      if (!consent) {
        throw new NotFoundException('Active guardian consent not found')
      }

      await tx.guardianConsent.update({
        where: {
          guardian_id_teen_id: {
            guardian_id: guardianId,
            teen_id: teenId,
          },
        },
        data: {
          revoked_at: revokedAt,
          status: 'revoked',
          ip_address: normalizedIpAddress,
        },
      })

      const remainingActiveGuardians = await tx.guardianConsent.count({
        where: {
          teen_id: teenId,
          status: 'granted',
          revoked_at: null,
        },
      })

      const sessionInvalidated = remainingActiveGuardians === 0
      if (sessionInvalidated && consent.teen.profile) {
        await tx.userProfile.update({
          where: { user_id: teenId },
          data: {
            preferences: buildRevokedPreferences(
              consent.teen.profile.preferences,
              revokedAt
            ),
          },
        })
      }

      await tx.eventEnvelope.create({
        data: {
          channel: 'email.guardian-consent-revoked',
          user_id: teenId,
          payload: {
            to: consent.teen.email,
            teenId,
            teenEmail: consent.teen.email,
            guardianId,
            guardianEmail: consent.guardian.email,
            revokedAt: revokedAt.toISOString(),
            remainingActiveGuardians,
            sessionInvalidated,
          },
        },
      })

      await this.logConsentAuditEvent(tx, {
        eventType: 'consent_revoked',
        teenId,
        guardianId,
        consentLevel: consent.consent_level,
        ipAddress: normalizedIpAddress,
        timestamp: revokedAt,
      })

      return {
        guardianId,
        teenId,
        revokedAt: revokedAt.toISOString(),
        remainingActiveGuardians,
        sessionInvalidated,
        notificationQueued: true,
      }
    })

    return guardianConsentRevokeResponseSchema.parse(result)
  }
}
