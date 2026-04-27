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
import { createBaseLogger } from '../../logger/pino.config'
import { GuardianConsentStateService } from '../auth/guardian-consent-state.service'
import { UserSessionService } from '../auth/user-session.service'
import {
  consentLevelSchema,
  guardianConsentRevokeResponseSchema,
  guardianInvitationAcceptResponseSchema,
  guardianInvitationInputSchema,
  guardianInvitationResponseSchema,
  type ConsentLevel,
} from '../../contracts/http'
import { calculateAge } from '@couture/utils'
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
  eventType:
    | 'consent_granted'
    | 'consent_revoked'
    | 'guardian_deleted'
    | 'guardian_consent_aged_out'
  teenId: string
  guardianId?: string | null
  consentLevel?: ConsentLevel | null
  ipAddress?: string | null
  timestamp: Date
  metadata?: Record<string, string | number | boolean | null>
}

type EmancipateEligibleTeensResult = {
  processed: number
  teenIds: string[]
  revokedConsentCount: number
  notificationsQueued: number
}

type GuardianInvitationEmailTemplateInput = {
  teenEmail: string
  guardianEmail: string
  consentLevel: ConsentLevel
  invitationLink: string
  expiresAt: Date
}

const GUARDIAN_INVITATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEVELOPMENT_INVITATION_SECRET = 'guardian-invite-development-secret'
const MAX_REVOKE_CONSENT_TRANSACTION_RETRIES = 3
const AGE_OF_MAJORITY = 18
const GUARDIAN_CONSENT_NO_LONGER_REQUIRED_MESSAGE =
  'Guardian consent is no longer required for adult accounts'
const HTML_ESCAPE_REPLACEMENTS: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  [String.fromCharCode(39)]: '&#39;',
}
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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    return HTML_ESCAPE_REPLACEMENTS[character] ?? character
  })
}

export function buildGuardianInvitationEmailTemplate(
  input: GuardianInvitationEmailTemplateInput
) {
  const consentLabel =
    input.consentLevel === 'full_access' ? 'full access' : 'read-only access'
  const expiresAt = input.expiresAt.toISOString()

  return {
    templateId: 'guardian-consent-invitation',
    subject: 'CoutureCast guardian consent invitation',
    previewText: `${input.teenEmail} invited you to approve CoutureCast wardrobe access.`,
    text: [
      'CoutureCast guardian consent invitation',
      '',
      `${input.teenEmail} invited ${input.guardianEmail} to approve ${consentLabel} for their CoutureCast wardrobe account.`,
      `Accept invitation: ${input.invitationLink}`,
      `This invitation expires at ${expiresAt}.`,
    ].join('\n'),
    html: [
      '<h1>CoutureCast guardian consent invitation</h1>',
      `<p>${escapeHtml(input.teenEmail)} invited ${escapeHtml(input.guardianEmail)} to approve ${escapeHtml(consentLabel)} for their CoutureCast wardrobe account.</p>`,
      `<p><a href="${escapeHtml(input.invitationLink)}">Accept guardian invitation</a></p>`,
      `<p>This invitation expires at ${escapeHtml(expiresAt)}.</p>`,
    ].join(''),
  }
}

function resolveAdultConsentRevocationSetting() {
  const normalizedValue =
    process.env.GUARDIAN_EMANCIPATION_REVOKE_CONSENTS?.trim().toLowerCase() ?? ''

  return !['0', 'false', 'no', 'off'].includes(normalizedValue)
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

function hasGuardianConsentAgedOut(preferences: Prisma.JsonValue | null | undefined) {
  const compliance = extractComplianceState(preferences)
  const agedOutAt = compliance.guardianConsentAgedOutAt

  return typeof agedOutAt === 'string' && agedOutAt.trim().length > 0
}

function requiresGuardianComplianceState(
  preferences: Prisma.JsonValue | null | undefined
) {
  const compliance = extractComplianceState(preferences)

  return (
    compliance.accountStatus === 'pending_guardian_consent' ||
    compliance.guardianConsentRequired === true ||
    compliance.guardianConsentRequired === 'true'
  )
}

function hasReachedAgeOfMajority(birthdate: Date | null | undefined, today = new Date()) {
  if (!(birthdate instanceof Date)) {
    return false
  }

  return calculateAge(birthdate, today) >= AGE_OF_MAJORITY
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

function buildEmancipatedPreferences(
  preferences: Prisma.JsonValue | null | undefined,
  emancipatedAt: Date,
  consentRevokedAt?: Date | null
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
  nextCompliance.guardianConsentAgedOutAt = emancipatedAt.toISOString()

  if (consentRevokedAt) {
    nextCompliance.guardianConsentRevokedAt = consentRevokedAt.toISOString()
  }

  nextPreferences.compliance = nextCompliance

  return nextPreferences as Prisma.InputJsonValue
}

function buildConsentAuditPayload(event: ConsentAuditEvent): Prisma.InputJsonValue {
  return {
    guardian_id: event.guardianId ?? null,
    teen_id: event.teenId,
    consent_level: event.consentLevel ?? null,
    ip_address: event.ipAddress ?? null,
    timestamp: event.timestamp.toISOString(),
    ...(event.metadata ?? {}),
  } satisfies Record<string, string | number | boolean | null>
}

function extractPrismaSerializationCode(error: Prisma.PrismaClientKnownRequestError) {
  if (error.code === 'P2034') {
    return error.code
  }

  if (typeof error.meta?.code === 'string') {
    return error.meta.code
  }

  if (typeof error.meta?.sqlstate === 'string') {
    return error.meta.sqlstate
  }

  return undefined
}

function extractObjectSerializationCode(error: object) {
  if ('code' in error && typeof error.code === 'string') {
    return error.code
  }

  const meta = 'meta' in error ? error.meta : undefined
  if (meta && typeof meta === 'object') {
    if ('code' in meta && typeof meta.code === 'string') {
      return meta.code
    }

    if ('sqlstate' in meta && typeof meta.sqlstate === 'string') {
      return meta.sqlstate
    }
  }

  return 'message' in error && typeof error.message === 'string'
    ? error.message
    : undefined
}

function extractRetryableSerializationCode(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return extractPrismaSerializationCode(error)
  }

  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  return extractObjectSerializationCode(error)
}

function isRetryableSerializationFailure(error: unknown) {
  const code = extractRetryableSerializationCode(error)
  return code === 'P2034' || code === '40001' || code?.includes('40001') === true
}

@Injectable()
export class GuardianService {
  private readonly logger = createBaseLogger().child({ feature: 'guardian-consent' })

  constructor(
    @InjectAnalyticsClient() private readonly analyticsClient: AnalyticsClient,
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    private readonly guardianConsentStateService: GuardianConsentStateService,
    private readonly userSessionService: UserSessionService
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

    if (hasReachedAgeOfMajority(teen.profile?.birthdate)) {
      throw new BadRequestException(GUARDIAN_CONSENT_NO_LONGER_REQUIRED_MESSAGE)
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
            template: buildGuardianInvitationEmailTemplate({
              teenEmail: teen.email,
              guardianEmail: normalizedGuardianEmail,
              consentLevel: parsed.consentLevel,
              invitationLink: nextInvitationLink,
              expiresAt,
            }),
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

      if (hasReachedAgeOfMajority(invitation.teen.profile?.birthdate, acceptedAt)) {
        throw new BadRequestException(GUARDIAN_CONSENT_NO_LONGER_REQUIRED_MESSAGE)
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
          revoked_ip_address: null,
          status: 'granted',
        },
        create: {
          guardian_id: guardian.id,
          teen_id: invitation.teen.id,
          consent_level: invitation.consent_level,
          consent_granted_at: acceptedAt,
          revoked_at: null,
          ip_address: normalizedIpAddress,
          revoked_ip_address: null,
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

    this.guardianConsentStateService.markTeenAccessGranted(result.teenId)
    return guardianInvitationAcceptResponseSchema.parse(result)
  }

  async revokeConsent(guardianId: string, teenId: string, ipAddress?: string) {
    const revokedAt = new Date()
    const normalizedIpAddress = ipAddress?.trim() || null

    let result:
      | {
          guardianId: string
          teenId: string
          revokedAt: string
          consentLevel: ConsentLevel
          remainingActiveGuardians: number
          sessionInvalidated: boolean
          notificationQueued: true
        }
      | undefined

    for (
      let attempt = 1;
      attempt <= MAX_REVOKE_CONSENT_TRANSACTION_RETRIES;
      attempt += 1
    ) {
      try {
        result = await this.prisma.$transaction(
          async (tx) => {
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
                revoked_ip_address: normalizedIpAddress,
                status: 'revoked',
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
              consentLevel: consent.consent_level,
              remainingActiveGuardians,
              sessionInvalidated,
              notificationQueued: true as const,
            }
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          }
        )
        break
      } catch (error) {
        if (
          attempt < MAX_REVOKE_CONSENT_TRANSACTION_RETRIES &&
          isRetryableSerializationFailure(error)
        ) {
          this.logger.warn(
            {
              attempt,
              guardianId,
              teenId,
              maxRetries: MAX_REVOKE_CONSENT_TRANSACTION_RETRIES,
            },
            'guardian_consent_revoke_retrying_serializable_transaction'
          )
          continue
        }

        throw error
      }
    }

    if (!result) {
      throw new Error('Failed to revoke guardian consent after retrying the transaction')
    }

    if (result.sessionInvalidated) {
      await this.userSessionService.invalidateUserSessions(result.teenId)
      this.guardianConsentStateService.markTeenAccessRevoked(result.teenId)
    } else {
      this.guardianConsentStateService.markTeenAccessGranted(result.teenId)
    }

    this.analyticsClient.capture({
      distinctId: result.guardianId,
      event: 'guardian_consent_revoked',
      properties: {
        guardian_id: result.guardianId,
        teen_id: result.teenId,
        consent_level: result.consentLevel,
        timestamp: result.revokedAt,
        consent_timestamp: result.revokedAt,
        remainingActiveGuardians: result.remainingActiveGuardians,
        sessionInvalidated: result.sessionInvalidated,
      },
    })

    return guardianConsentRevokeResponseSchema.parse(result)
  }

  async emancipateEligibleTeens(
    now = new Date()
  ): Promise<EmancipateEligibleTeensResult> {
    const adulthoodCutoff = new Date(
      Date.UTC(
        now.getUTCFullYear() - AGE_OF_MAJORITY,
        now.getUTCMonth(),
        now.getUTCDate(),
        23,
        59,
        59,
        999
      )
    )
    const revokeActiveConsents = resolveAdultConsentRevocationSetting()
    const candidates = await this.prisma.user.findMany({
      where: {
        profile: {
          is: {
            birthdate: {
              not: null,
              lte: adulthoodCutoff,
            },
          },
        },
      },
      include: {
        profile: true,
        teen_roles: {
          where: {
            status: 'granted',
            revoked_at: null,
          },
          include: {
            guardian: true,
          },
        },
      },
    })

    const teenIds: string[] = []
    let revokedConsentCount = 0
    let notificationsQueued = 0

    for (const candidate of candidates) {
      if (!candidate.profile) {
        continue
      }

      if (hasGuardianConsentAgedOut(candidate.profile.preferences)) {
        continue
      }

      const hasActiveGuardianConsent = candidate.teen_roles.length > 0
      if (
        !requiresGuardianComplianceState(candidate.profile.preferences) &&
        !hasActiveGuardianConsent
      ) {
        continue
      }

      const emancipatedAt = new Date(now)
      let result:
        | {
            teenId: string
            revokedConsentCount: number
          }
        | null
        | undefined

      for (
        let attempt = 1;
        attempt <= MAX_REVOKE_CONSENT_TRANSACTION_RETRIES;
        attempt += 1
      ) {
        try {
          result = await this.prisma.$transaction(
            async (tx) => {
              const teen = await tx.user.findUnique({
                where: { id: candidate.id },
                include: {
                  profile: true,
                  teen_roles: {
                    where: {
                      status: 'granted',
                      revoked_at: null,
                    },
                    include: {
                      guardian: true,
                    },
                  },
                },
              })

              if (!teen?.profile) {
                return null
              }

              if (!hasReachedAgeOfMajority(teen.profile.birthdate, now)) {
                return null
              }

              if (hasGuardianConsentAgedOut(teen.profile.preferences)) {
                return null
              }

              const activeGuardianConsents = teen.teen_roles
              const stillRequiresGuardian = requiresGuardianComplianceState(
                teen.profile.preferences
              )

              if (!stillRequiresGuardian && activeGuardianConsents.length === 0) {
                return null
              }

              if (revokeActiveConsents && activeGuardianConsents.length > 0) {
                await tx.guardianConsent.updateMany({
                  where: {
                    teen_id: teen.id,
                    status: 'granted',
                    revoked_at: null,
                  },
                  data: {
                    status: 'revoked',
                    revoked_at: emancipatedAt,
                    revoked_ip_address: null,
                  },
                })

                for (const consent of activeGuardianConsents) {
                  await this.logConsentAuditEvent(tx, {
                    eventType: 'consent_revoked',
                    teenId: teen.id,
                    guardianId: consent.guardian_id,
                    consentLevel: consent.consent_level,
                    ipAddress: null,
                    timestamp: emancipatedAt,
                  })
                }
              }

              await tx.userProfile.update({
                where: { user_id: teen.id },
                data: {
                  preferences: buildEmancipatedPreferences(
                    teen.profile.preferences,
                    emancipatedAt,
                    revokeActiveConsents && activeGuardianConsents.length > 0
                      ? emancipatedAt
                      : null
                  ),
                },
              })

              await tx.eventEnvelope.create({
                data: {
                  channel: 'email.guardian-consent-aged-out',
                  user_id: teen.id,
                  payload: {
                    to: teen.email,
                    teenId: teen.id,
                    teenEmail: teen.email,
                    emancipatedAt: emancipatedAt.toISOString(),
                    message: 'You no longer require guardian consent',
                    activeGuardianCount: activeGuardianConsents.length,
                    revokedGuardianCount: revokeActiveConsents
                      ? activeGuardianConsents.length
                      : 0,
                    revokedGuardianAccess: revokeActiveConsents,
                  },
                },
              })

              await this.logConsentAuditEvent(tx, {
                eventType: 'guardian_consent_aged_out',
                teenId: teen.id,
                guardianId: null,
                consentLevel: null,
                ipAddress: null,
                timestamp: emancipatedAt,
                metadata: {
                  active_guardian_count: activeGuardianConsents.length,
                  revoked_guardian_count: revokeActiveConsents
                    ? activeGuardianConsents.length
                    : 0,
                  revoked_guardian_access: revokeActiveConsents,
                },
              })

              return {
                teenId: teen.id,
                revokedConsentCount: revokeActiveConsents
                  ? activeGuardianConsents.length
                  : 0,
              }
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            }
          )
          break
        } catch (error) {
          if (
            attempt < MAX_REVOKE_CONSENT_TRANSACTION_RETRIES &&
            isRetryableSerializationFailure(error)
          ) {
            this.logger.warn(
              {
                attempt,
                teenId: candidate.id,
                maxRetries: MAX_REVOKE_CONSENT_TRANSACTION_RETRIES,
              },
              'guardian_consent_emancipation_retrying_serializable_transaction'
            )
            continue
          }

          throw error
        }
      }

      if (result === undefined) {
        throw new Error(
          'Failed to emancipate eligible teen after retrying the transaction'
        )
      }

      if (!result) {
        continue
      }

      teenIds.push(result.teenId)
      revokedConsentCount += result.revokedConsentCount
      notificationsQueued += 1
      this.guardianConsentStateService.markTeenAccessGranted(result.teenId)
    }

    return {
      processed: teenIds.length,
      teenIds,
      revokedConsentCount,
      notificationsQueued,
    }
  }
}
