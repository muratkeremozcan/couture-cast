// Step 8 API analytics owner: searchable owner anchor
// Story 1.4 Task 4 step 1 owner: integrate signup telemetry in `apps/api/src/modules/auth/auth.service.ts`
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import {
  AGE_GATE_MESSAGES,
  evaluateAgeGate,
  parseBirthdateInput,
  type AgeGateResult,
} from '@couture/utils'
import { TelemetryService } from '../telemetry/telemetry.service'
import {
  InjectAnalyticsClient,
  type AnalyticsClient,
} from '../../analytics/analytics.service'
import { createBaseLogger } from '../../logger/pino.config'
import {
  federatedSignupInputSchema,
  federatedSignupStatusResponseSchema,
  guardianConsentInputSchema,
  guardianConsentResponseSchema,
  signupInputSchema,
  signupResponseSchema,
  type FederatedSignupInput,
  type FederatedSignupStatusResponse,
  type GuardianConsentInput,
  type SignupInput,
  type SignupResponse,
} from '../../contracts/http'
import { interactiveTransaction } from '../../prisma/prisma-client.js'
import {
  AccessTokenIdentityService,
  type VerifiedSupabaseIdentity,
} from './access-token-identity.service.js'
import { SUPABASE_AUTH_ADMIN, type SupabaseAuthAdmin } from './supabase-auth-admin'

/** Story 6.17 TEA-2: a guardian-only account that holds a granted consent stays adult. */
export const FEDERATED_GUARDIAN_MINOR_MESSAGE =
  'Guardian accounts need an adult birthdate.'

/**
 * The federated endpoints call Auth inside the address lock (identity re-read, Admin
 * deletion), each bounded at five seconds, so the transaction gets room for both.
 */
const FEDERATED_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 }

/** An age gate the caller already checked as allowed. */
type AgeGate = AgeGateResult

const accountConflict = () =>
  new ConflictException('This address already has a CoutureCast account.')
const identityUnusable = () => new UnauthorizedException('Invalid access token')

type SignUpOptions = {
  today?: Date
}

function parseBirthdate(value: string) {
  try {
    return parseBirthdateInput(value)
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : 'Invalid signup payload'
    )
  }
}

/** The advisory lock email signup has always taken; the federated paths share it (TEA-1). */
async function lockAddress(tx: Prisma.TransactionClient, normalized: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('user_email:' || ${normalized}))`
}

function accountStatusFor(gate: AgeGate) {
  return gate.requiresGuardian ? 'pending_guardian_consent' : 'active'
}

function complianceFor(gate: AgeGate) {
  return {
    compliance: {
      accountStatus: accountStatusFor(gate),
      guardianConsentRequired: gate.requiresGuardian,
    },
  }
}

function isUniqueConstraintError(
  error: unknown
): error is Prisma.PrismaClientKnownRequestError {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2002'
  }

  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false
  }

  return error.code === 'P2002'
}

@Injectable()
export class AuthService {
  private readonly logger = createBaseLogger().child({ feature: 'auth' })

  constructor(
    @InjectAnalyticsClient() private readonly analyticsClient: AnalyticsClient,
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(TelemetryService) private readonly telemetryService: TelemetryService,
    @Inject(AccessTokenIdentityService)
    private readonly identityService: AccessTokenIdentityService,
    @Inject(SUPABASE_AUTH_ADMIN) private readonly authAdmin: SupabaseAuthAdmin
  ) {}

  /**
   * Shared account creation (Story 6.17 D3): email signup and the federated finish step
   * create the same rows. Runs inside the caller's address lock.
   */
  private createAccount(
    tx: Prisma.TransactionClient,
    email: string,
    birthdate: Date,
    gate: AgeGate
  ) {
    return tx.user.create({
      data: {
        email,
        profile: {
          create: {
            birthdate,
            preferences: complianceFor(gate),
          },
        },
        comfort_profile: {
          create: {},
        },
      },
      select: { id: true },
    })
  }

  /** Telemetry and the response every created account shares. */
  private accountCreated(userId: string, gate: AgeGate): SignupResponse {
    const telemetryPromise = this.telemetryService.captureEvent(
      userId,
      'profile_completed',
      {
        userId,
        age: gate.age,
        guardianConsentRequired: gate.requiresGuardian,
      }
    )
    if (
      telemetryPromise !== undefined &&
      typeof (telemetryPromise as unknown as { catch: unknown }).catch === 'function'
    ) {
      telemetryPromise.catch((err: unknown) => {
        this.logger.error({ err, userId }, 'signUp_telemetry_failed')
      })
    }

    return signupResponseSchema.parse({
      userId,
      age: gate.age,
      accountStatus: accountStatusFor(gate),
      guardianConsentRequired: gate.requiresGuardian,
    })
  }

  async signUp(input: SignupInput, options: SignUpOptions = {}) {
    const parsed = signupInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new BadRequestException('Invalid signup payload')
    }

    const birthdate = parseBirthdate(parsed.data.birthdate)
    const gate = evaluateAgeGate(birthdate, options.today ?? new Date())

    if (!gate.allowed) {
      throw new ForbiddenException(gate.message)
    }

    // One account per address whatever its case: verified-email identity mapping treats
    // case variants as ambiguous and denies every one of them. The column's unique index
    // is case-sensitive, so the check runs under a transaction lock on the lowercased
    // address; concurrent case-variant signups serialize and only the first is created.
    // The address is stored as typed.
    const normalized = parsed.data.email.toLowerCase()
    let user: { id: string }
    try {
      user = await interactiveTransaction(this.prisma, async (tx) => {
        await lockAddress(tx, normalized)
        const existingUser = await tx.user.findFirst({
          where: { email: { equals: normalized, mode: 'insensitive' } },
          select: { id: true },
        })
        if (existingUser) {
          throw new BadRequestException('Email already registered')
        }
        return this.createAccount(tx, parsed.data.email, birthdate, gate)
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException('Email already registered')
      }

      throw error
    }

    return this.accountCreated(user.id, gate)
  }

  /** Rows for a verified address, case-insensitively; two or more is ambiguous. */
  private addressRows(tx: Prisma.TransactionClient | PrismaClient, normalized: string) {
    return tx.user.findMany({
      where: { email: { equals: normalized, mode: 'insensitive' } },
      select: {
        id: true,
        profile: { select: { id: true, birthdate: true, preferences: true } },
      },
      take: 2,
    })
  }

  /**
   * Story 6.17 D3: where a verified identity whose profile check answered 401 goes next.
   * `complete` only when one account with a birthdate owns the address.
   */
  async getFederatedSignupStatus(token: string): Promise<FederatedSignupStatusResponse> {
    const identity = await this.identityService.readVerifiedSupabaseIdentity(token)
    const rows = await this.addressRows(this.prisma, identity.email.toLowerCase())
    if (rows.length > 1) throw identityUnusable()
    const status = rows[0]?.profile?.birthdate ? 'complete' : 'needs_birthdate'
    return federatedSignupStatusResponseSchema.parse({ status })
  }

  /** Inside the lock: the identity must still exist and still own the same address. */
  private async rereadIdentity(token: string, first: VerifiedSupabaseIdentity) {
    const again = await this.identityService.readVerifiedSupabaseIdentity(token)
    if (
      again.authUserId !== first.authUserId ||
      again.email.toLowerCase() !== first.email.toLowerCase()
    )
      throw identityUnusable()
  }

  /**
   * Story 6.17 D3: the finish step. The address comes from the verified bearer identity,
   * the age gate is the email signup gate, and the address lock is the email signup lock.
   * Under 13 deletes the Auth identity (with Google's profile data) inside the lock.
   */
  async signUpFederated(
    token: string,
    input: FederatedSignupInput,
    options: SignUpOptions = {}
  ): Promise<SignupResponse> {
    const parsed = federatedSignupInputSchema.safeParse(input)
    if (!parsed.success) throw new BadRequestException('Invalid signup payload')
    const birthdate = parseBirthdate(parsed.data.birthdate)
    const gate = evaluateAgeGate(birthdate, options.today ?? new Date())

    const identity = await this.identityService.readVerifiedSupabaseIdentity(token)
    const normalized = identity.email.toLowerCase()

    const outcome = await interactiveTransaction(
      this.prisma,
      async (tx) => {
        await lockAddress(tx, normalized)
        await this.rereadIdentity(token, identity)
        const rows = await this.addressRows(tx, normalized)
        if (rows.length > 1) throw identityUnusable()
        const row = rows[0]
        if (row?.profile?.birthdate) throw accountConflict()

        if (!row) {
          // No account owns the address, so an under-13 refusal deletes the Auth identity.
          if (!gate.allowed) {
            await this.deleteRefusedIdentity(identity.authUserId)
            return { refused: true as const }
          }
          const created = await this.createAccount(tx, identity.email, birthdate, gate)
          return { refused: false as const, userId: created.id }
        }

        // A row without a birthdate: guardian acceptance creates one with no profile. The
        // guardian check runs first (TEA-2), and no Auth identity is deleted while any row
        // exists for the address.
        if (gate.age < 18) {
          const grantedConsent = await tx.guardianConsent.findFirst({
            where: { guardian_id: row.id, status: 'granted' },
            select: { id: true },
          })
          if (grantedConsent)
            throw new ForbiddenException(FEDERATED_GUARDIAN_MINOR_MESSAGE)
        }
        if (!gate.allowed) return { refused: true as const }
        await this.attachProfile(tx, row, birthdate, gate)
        return { refused: false as const, userId: row.id }
      },
      FEDERATED_TRANSACTION_OPTIONS
    )

    if (outcome.refused) throw new ForbiddenException(AGE_GATE_MESSAGES.underage)
    return this.accountCreated(outcome.userId, gate)
  }

  private async attachProfile(
    tx: Prisma.TransactionClient,
    row: {
      id: string
      profile: { id: string; preferences: Prisma.JsonValue | null } | null
    },
    birthdate: Date,
    gate: AgeGate
  ) {
    const existing =
      row.profile?.preferences &&
      typeof row.profile.preferences === 'object' &&
      !Array.isArray(row.profile.preferences)
        ? row.profile.preferences
        : {}
    const preferences = { ...existing, ...complianceFor(gate) }
    await tx.userProfile.upsert({
      where: { user_id: row.id },
      create: { user_id: row.id, birthdate, preferences },
      update: { birthdate, preferences },
    })
    await tx.comfortPreferences.upsert({
      where: { user_id: row.id },
      create: { user_id: row.id },
      update: {},
    })
  }

  /**
   * A failed deletion still refuses the person; the orphan sweep (TEA-4) retries it.
   * Logs carry no address, birthdate or token (TEA-8).
   */
  private async deleteRefusedIdentity(authUserId: string) {
    try {
      await this.authAdmin.deleteUser(authUserId)
    } catch (err) {
      this.logger.warn({ err }, 'federated_refusal_identity_delete_failed')
    }
  }

  /**
   * Story 6.17 D3 Cancel: deletes the Auth identity when its address has no account, inside
   * the address lock so a finish in another tab cannot strand an account (TEA-1).
   */
  async abandonFederatedSignup(token: string): Promise<void> {
    const identity = await this.identityService.readVerifiedSupabaseIdentity(token)
    const normalized = identity.email.toLowerCase()
    await interactiveTransaction(
      this.prisma,
      async (tx) => {
        await lockAddress(tx, normalized)
        const rows = await this.addressRows(tx, normalized)
        if (rows.length > 0) return
        await this.authAdmin.deleteUser(identity.authUserId)
      },
      FEDERATED_TRANSACTION_OPTIONS
    )
  }

  /** Story 0.7 support file: API-side analytics boundary for guardian consent.
   * Why typed validation exists here: API callers are external to UI wrappers, so we enforce schema before capture.
   * Problems solved: request payload drift, inconsistent property keys, and weaker incident visibility from bad events.
   * Alternatives: reuse shared contract builders server-side, or enqueue events for async contract validation.
   * Flow refs:
   * - S0.7/T3/1: API endpoints are also part of the shared analytics surface, not a separate event contract.
   * - S0.7/T2/2: API capture still emits canonical snake_case properties.
   */
  grantGuardianConsent(input: GuardianConsentInput) {
    // Flow ref S0.7/T3/1: validate the API payload at the boundary before
    // emitting the shared analytics event.
    const parsed = guardianConsentInputSchema.parse(input)
    // Flow ref S0.7/T2/2: normalize timestamp so every emitted payload keeps
    // the shared temporal field contract.
    const timestamp = parsed.timestamp ?? new Date().toISOString()

    // Flow ref S0.7/T3/1: capture one canonical guardian_consent_granted event
    // payload instead of shaping a route-specific variant.
    this.analyticsClient.capture({
      distinctId: parsed.guardianId,
      event: 'guardian_consent_granted',
      properties: {
        guardian_id: parsed.guardianId,
        teen_id: parsed.teenId,
        consent_level: parsed.consentLevel,
        timestamp,
        consent_timestamp: timestamp,
      },
    })

    return guardianConsentResponseSchema.parse({ tracked: true })
  }
}
