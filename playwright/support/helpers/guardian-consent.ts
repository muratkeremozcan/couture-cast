// Creates a full accepted guardian-consent state through public API contracts so browser
// specs can start from realistic data without repeating signup/invite/accept setup.
import type { TestInfo } from '@playwright/test'
import { PrismaClient, type Prisma } from '@prisma/client'
import {
  guardianInvitationAcceptResponseSchema,
  guardianInvitationResponseSchema,
  signupResponseSchema,
} from '@couture/api-client/contracts/http'
import {
  createGuardianEmail,
  createTeenSignupPayload,
  extractInvitationToken,
  resolveApiBaseUrl,
  type ApiRequestFixture,
} from './api-test'

type GuardianInvitationPayload = {
  teenId: string
  guardianEmail: string
  consentLevel: 'read_only' | 'full_access'
}

type GuardianAcceptPayload = {
  token: string
}

export type AcceptedGuardianConsent = {
  teenEmail: string
  guardianEmail: string
  teenId: string
  guardianId: string
}

export type GuardianConsentCleanupTarget = {
  guardianEmail?: string
  guardianId?: string
  teenEmail?: string
  teenId?: string
}

function assertStatus(
  actualStatus: number,
  expectedStatus: number,
  context: string,
  body: unknown
) {
  if (actualStatus !== expectedStatus) {
    throw new Error(
      `${context} failed with status ${actualStatus}: ${JSON.stringify(body)}`
    )
  }
}

function uniqueDefined(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function createGuardianInvitationWhere(
  userIds: string[],
  emails: string[]
): Prisma.GuardianInvitationWhereInput | null {
  const or: Prisma.GuardianInvitationWhereInput[] = []

  if (userIds.length > 0) {
    or.push({ teen_id: { in: userIds } })
    or.push({ accepted_guardian_id: { in: userIds } })
  }

  if (emails.length > 0) {
    or.push({ guardian_email: { in: emails } })
  }

  return or.length > 0 ? { OR: or } : null
}

function createUserWhere(
  userIds: string[],
  emails: string[]
): Prisma.UserWhereInput | null {
  const or: Prisma.UserWhereInput[] = []

  if (userIds.length > 0) {
    or.push({ id: { in: userIds } })
  }

  if (emails.length > 0) {
    or.push({ email: { in: emails } })
  }

  return or.length > 0 ? { OR: or } : null
}

export async function cleanupGuardianConsentTestData(
  targets: GuardianConsentCleanupTarget[]
): Promise<void> {
  if (targets.length === 0 || !process.env.DATABASE_URL) {
    return
  }

  const prisma = new PrismaClient()

  try {
    const targetEmails = uniqueDefined(
      targets.flatMap((target) => [target.teenEmail, target.guardianEmail])
    ).map(normalizeEmail)
    const explicitUserIds = uniqueDefined(
      targets.flatMap((target) => [target.teenId, target.guardianId])
    )
    const invitationWhere = createGuardianInvitationWhere(explicitUserIds, targetEmails)
    const invitations = invitationWhere
      ? await prisma.guardianInvitation.findMany({
          where: invitationWhere,
          select: {
            accepted_guardian_id: true,
            guardian_email: true,
            teen_id: true,
          },
        })
      : []
    const discoveredEmails = uniqueDefined([
      ...targetEmails,
      ...invitations.map((invitation) => invitation.guardian_email),
    ]).map(normalizeEmail)
    const discoveredUserIds = uniqueDefined([
      ...explicitUserIds,
      ...invitations.map((invitation) => invitation.teen_id),
      ...invitations.map((invitation) => invitation.accepted_guardian_id),
    ])
    const userWhere = createUserWhere(discoveredUserIds, discoveredEmails)
    const users = userWhere
      ? await prisma.user.findMany({
          where: userWhere,
          select: { id: true },
        })
      : []
    const userIds = uniqueDefined([...discoveredUserIds, ...users.map((user) => user.id)])
    const finalInvitationWhere = createGuardianInvitationWhere(userIds, discoveredEmails)

    if (userIds.length === 0 && !finalInvitationWhere) {
      return
    }

    // Interactive transaction so all operations share one connection.
    // session_replication_role='replica' disables user-defined triggers for this
    // session, which lets us delete AuditLog rows that are otherwise protected by
    // the block_audit_log_mutation trigger added in the harden_audit_log_immutability
    // migration. The postgres superuser (used by local DATABASE_URL) has this privilege.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = 'replica'`
      await tx.eventEnvelope.deleteMany({ where: { user_id: { in: userIds } } })
      await tx.auditLog.deleteMany({ where: { user_id: { in: userIds } } })
      await tx.guardianConsent.deleteMany({
        where: { OR: [{ guardian_id: { in: userIds } }, { teen_id: { in: userIds } }] },
      })
      await tx.guardianInvitation.deleteMany({
        where: finalInvitationWhere ?? { id: { in: [] } },
      })
      await tx.comfortPreferences.deleteMany({ where: { user_id: { in: userIds } } })
      await tx.userProfile.deleteMany({ where: { user_id: { in: userIds } } })
      await tx.user.deleteMany({ where: { id: { in: userIds } } })
    })
  } finally {
    await prisma.$disconnect()
  }
}

export async function createAcceptedGuardianConsent(
  apiRequest: ApiRequestFixture,
  testInfo: TestInfo
): Promise<AcceptedGuardianConsent> {
  const baseUrl = resolveApiBaseUrl(testInfo)
  const teenSignupPayload = createTeenSignupPayload(
    testInfo,
    'guardian-ui-dashboard-teen'
  )
  const guardianEmail = createGuardianEmail(testInfo, 'guardian-ui-dashboard')

  const signupResponse = await apiRequest({
    method: 'POST',
    path: '/api/v1/auth/signup',
    baseUrl,
    body: teenSignupPayload,
  })
  assertStatus(
    signupResponse.status,
    201,
    'Guardian consent signup setup',
    signupResponse.body
  )
  const signupBody = signupResponseSchema.parse(signupResponse.body)

  const invitationPayload: GuardianInvitationPayload = {
    teenId: signupBody.userId,
    guardianEmail,
    consentLevel: 'full_access',
  }
  const invitationResponse = await apiRequest({
    method: 'POST',
    path: '/api/v1/guardian/invitations',
    baseUrl,
    body: invitationPayload,
  })
  assertStatus(
    invitationResponse.status,
    201,
    'Guardian consent invitation setup',
    invitationResponse.body
  )
  const invitationBody = guardianInvitationResponseSchema.parse(invitationResponse.body)

  const acceptResponse = await apiRequest({
    method: 'POST',
    path: '/api/v1/guardian/accept',
    baseUrl,
    body: {
      token: extractInvitationToken(invitationBody.invitationLink),
    } satisfies GuardianAcceptPayload,
  })
  assertStatus(
    acceptResponse.status,
    200,
    'Guardian consent acceptance setup',
    acceptResponse.body
  )
  const acceptBody = guardianInvitationAcceptResponseSchema.parse(acceptResponse.body)

  return {
    teenEmail: teenSignupPayload.email,
    guardianEmail,
    teenId: signupBody.userId,
    guardianId: acceptBody.guardianId,
  }
}
