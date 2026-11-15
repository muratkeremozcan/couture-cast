// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 TEA red spec: the federated signup endpoints over real HTTP and a real database.
//
// A Google first sign-up has a verified Supabase session and no app account. The endpoints decide
// the route (GET), create the account from the bearer's verified address (POST) and abandon it
// (DELETE). Supabase `/auth/v1/user` is doubled at the fetch boundary; the Auth Admin API is the
// SUPABASE_AUTH_ADMIN double. Races are forced with held promises; no sleeps.
// Plan: _bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGE_GATE_MESSAGES } from '@couture/utils'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { listenHttpApp } from '../src/testing/loopback-http-app.js'
import { birthdateForAge } from '../src/testing/birthdate.js'
import { bindRequestContext } from '../src/logger/request-context.js'
import {
  ANALYTICS_CLIENT,
  type AnalyticsClient,
} from '../src/analytics/analytics.service.js'
import { AuthController } from '../src/modules/auth/auth.controller.js'
import {
  AuthService,
  FEDERATED_GUARDIAN_MINOR_MESSAGE,
} from '../src/modules/auth/auth.service.js'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { RequestAuthGuard, RolesGuard } from '../src/modules/auth/security.guards.js'
import {
  SUPABASE_AUTH_ADMIN,
  type SupabaseAuthAdmin,
} from '../src/modules/auth/supabase-auth-admin.js'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'

const IDENTITY_ORIGIN = 'https://story617.identity.invalid'
const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const identity = new AccessTokenIdentityService(prisma)

type Deferred = { promise: Promise<void>; release: () => void }
function deferred(): Deferred {
  let release = () => undefined as void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

/** One Supabase auth user as `/auth/v1/user` returns it, keyed by its bearer. */
type AuthUser = {
  id: string
  email: string
  email_verified?: boolean
  email_confirmed_at?: string | null
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
}
const authUsers = new Map<string, AuthUser>()
const deletedAuthUsers = new Set<string>()
/** Bearer -> number of `/auth/v1/user` reads so far, and an optional hold on the Nth read. */
const identityReads = new Map<string, number>()
const identityHolds = new Map<string, { onRead: number; gate: Deferred }>()

const admin = {
  deleteUser: vi.fn<(authUserId: string) => Promise<void>>(),
  listUsers: vi.fn(),
}
let deleteHold: Deferred | undefined
const telemetry = {
  captureEvent: vi.fn(
    (_userId: string, _event: string, _properties: Record<string, unknown>) =>
      Promise.resolve()
  ),
}
const analytics = { capture: vi.fn() }

let app: INestApplication
let url: string
let nativeFetch: typeof fetch

function googleUser(email: string, overrides: Partial<AuthUser> = {}) {
  const bearer = `fed-bearer-${randomUUID()}`
  const user: AuthUser = {
    id: randomUUID(),
    email,
    email_verified: true,
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: {
      name: 'Ada Federated',
      picture: 'https://lh3.googleusercontent.invalid/a/ada-federated',
      sub: '109876543210987654321',
      email_verified: true,
    },
    ...overrides,
  }
  authUsers.set(bearer, user)
  return { bearer, user }
}

const address = () => `fed-${randomUUID()}@synthetic.test`
const isoDate = (date: Date) => date.toISOString().slice(0, 10)
const birthdate = (age: number) => isoDate(birthdateForAge(age))
/** Someone who turns `age` today (UTC). */
function birthdayToday(age: number) {
  const now = new Date()
  return isoDate(
    new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()))
  )
}
/** Someone who turns `age` tomorrow (UTC): still `age - 1` today. */
function birthdayTomorrow(age: number) {
  const now = new Date()
  return isoDate(
    new Date(
      Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate() + 1)
    )
  )
}

function federated(method: 'GET' | 'POST' | 'DELETE', bearer?: string, body?: unknown) {
  return nativeFetch(`${url}/api/v1/auth/signup/federated`, {
    method,
    headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function emailSignup(email: string, birth: string) {
  return nativeFetch(`${url}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, birthdate: birth }),
  })
}

const accountsFor = (email: string) =>
  prisma.user.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    include: { profile: true, comfort_profile: true },
  })

const profileCompletedCalls = () =>
  telemetry.captureEvent.mock.calls.filter((call) => call[1] === 'profile_completed')

async function guardianOnlyRow(email: string) {
  // The shape guardian acceptance creates: a User with an address and no profile.
  const guardian = await prisma.user.create({ data: { email } })
  const teen = await prisma.user.create({
    data: {
      email: address(),
      profile: {
        create: {
          birthdate: birthdateForAge(14),
          preferences: {
            compliance: {
              accountStatus: 'pending_guardian_consent',
              guardianConsentRequired: true,
            },
          },
        },
      },
    },
  })
  const consent = await prisma.guardianConsent.create({
    data: {
      guardian_id: guardian.id,
      teen_id: teen.id,
      consent_level: 'read_only',
      status: 'granted',
    },
  })
  return { guardian, teen, consent }
}

beforeAll(async () => {
  await database.migrate()
  vi.stubEnv('TEST_ENV', '')
  vi.stubEnv('VERCEL_ENV', '')
  vi.stubEnv('SUPABASE_URL', IDENTITY_ORIGIN)
  vi.stubEnv('SUPABASE_ANON_KEY', 'story617-synthetic-anon-key')
  nativeFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const target =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!target.startsWith(IDENTITY_ORIGIN)) return nativeFetch(input, init)
    if (new URL(target).pathname !== '/auth/v1/user')
      throw new Error(`Unexpected Supabase call ${new URL(target).pathname}`)
    const headers = new Headers(init?.headers)
    const bearer = headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
    const read = (identityReads.get(bearer) ?? 0) + 1
    identityReads.set(bearer, read)
    const hold = identityHolds.get(bearer)
    if (hold && hold.onRead === read) await hold.gate.promise
    const user = authUsers.get(bearer)
    if (!user) return Response.json({ msg: 'invalid JWT' }, { status: 401 })
    // Supabase answers 403 for a JWT whose user no longer exists.
    if (deletedAuthUsers.has(user.id))
      return Response.json(
        { msg: 'User from sub claim in JWT does not exist' },
        { status: 403 }
      )
    return Response.json(user)
  })
  admin.deleteUser.mockImplementation(async (authUserId: string) => {
    if (deleteHold) await deleteHold.promise
    deletedAuthUsers.add(authUserId)
  })

  const module = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      {
        // Vitest's transform emits no decorator metadata, so the constructor is called directly.
        provide: AuthService,
        useFactory: () =>
          new AuthService(
            analytics as unknown as AnalyticsClient,
            prisma,
            telemetry as unknown as TelemetryService,
            identity,
            admin as unknown as SupabaseAuthAdmin
          ),
      },
      RequestAuthGuard,
      RolesGuard,
      { provide: PrismaClient, useValue: prisma },
      { provide: ANALYTICS_CLIENT, useValue: analytics },
      { provide: TelemetryService, useValue: telemetry },
      { provide: AccessTokenIdentityService, useValue: identity },
      {
        provide: GuardianConsentStateService,
        useValue: new GuardianConsentStateService(prisma),
      },
      { provide: SUPABASE_AUTH_ADMIN, useValue: admin },
    ],
  }).compile()
  app = module.createNestApplication()
  app.useLogger(false)
  app.use(bindRequestContext)
  url = await listenHttpApp(app)
}, 60_000)

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
  await database.drop()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

beforeEach(() => {
  // Reset, not clear: an unconsumed mockRejectedValueOnce must not leak into the next test.
  admin.deleteUser.mockReset()
  admin.deleteUser.mockImplementation(async (authUserId: string) => {
    if (deleteHold) await deleteHold.promise
    deletedAuthUsers.add(authUserId)
  })
  admin.listUsers.mockClear()
  telemetry.captureEvent.mockClear()
  deleteHold = undefined
  identityHolds.clear()
})

describe('A-FED-GET-STATUS: GET decides the route after a 401 profile check', () => {
  it('answers needs_birthdate when the verified address has no account', async () => {
    const { bearer } = googleUser(address())
    const response = await federated('GET', bearer)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'needs_birthdate' })
  })

  it('answers needs_birthdate for a guardian-only row without a profile', async () => {
    const email = address()
    await guardianOnlyRow(email)
    const { bearer } = googleUser(email)
    const response = await federated('GET', bearer)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'needs_birthdate' })
  })

  it('answers complete when one account with a profile matches, case-insensitively', async () => {
    const email = address()
    expect((await emailSignup(email, birthdate(30))).status).toBe(201)
    const { bearer } = googleUser(email.toUpperCase())
    const response = await federated('GET', bearer)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'complete' })
  })

  it.each([
    ['no bearer', undefined],
    ['an unknown bearer', 'fed-bearer-unknown'],
  ])('answers 401 with %s', async (_label, bearer) => {
    const response = await federated('GET', bearer)
    expect(response.status).toBe(401)
  })

  it('A-FED-UNVERIFIED: answers 401 for an unverified address on every verb', async () => {
    const email = address()
    const { bearer } = googleUser(email, {
      email_verified: false,
      email_confirmed_at: null,
      user_metadata: {},
    })
    expect((await federated('GET', bearer)).status).toBe(401)
    expect((await federated('POST', bearer, { birthdate: birthdate(30) })).status).toBe(
      401
    )
    expect((await federated('DELETE', bearer)).status).toBe(401)
    expect(await accountsFor(email)).toEqual([])
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it('A-FED-AMBIGUOUS: GET and POST answer 401, DELETE deletes nothing', async () => {
    const email = address()
    await prisma.user.createMany({ data: [{ email }, { email: email.toUpperCase() }] })
    const before = await accountsFor(email)
    const { bearer } = googleUser(email)
    expect((await federated('GET', bearer)).status).toBe(401)
    expect((await federated('POST', bearer, { birthdate: birthdate(30) })).status).toBe(
      401
    )
    // Rows exist for the address, so cancel is a no-op (D3: 204 when nothing is deleted).
    expect((await federated('DELETE', bearer)).status).toBe(204)
    expect(await accountsFor(email)).toEqual(before)
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })
})

describe('A-FED-CREATE: POST creates the account from the verified address', () => {
  it('A-FED-CREATE-ADULT: creates one active account, profile and comfort row', async () => {
    const email = address()
    const birth = birthdate(30)
    const { bearer } = googleUser(email)
    const response = await federated('POST', bearer, { birthdate: birth })
    expect(response.status).toBe(201)
    const body = (await response.json()) as { userId: string }
    const accounts = await accountsFor(email)
    expect(accounts).toHaveLength(1)
    const [account] = accounts
    expect(body).toEqual({
      userId: account!.id,
      age: 30,
      accountStatus: 'active',
      guardianConsentRequired: false,
    })
    expect(account!.email).toBe(email)
    expect(isoDate(account!.profile!.birthdate!)).toBe(birth)
    expect(account!.profile!.preferences).toEqual({
      compliance: { accountStatus: 'active', guardianConsentRequired: false },
    })
    expect(account!.comfort_profile).not.toBeNull()
    expect(profileCompletedCalls()).toEqual([
      [
        account!.id,
        'profile_completed',
        { userId: account!.id, age: 30, guardianConsentRequired: false },
      ],
    ])
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it('A-FED-TEEN: a 14-year-old is pending guardian consent and resolves as teen', async () => {
    const email = address()
    const { bearer } = googleUser(email)
    const response = await federated('POST', bearer, { birthdate: birthdate(14) })
    expect(response.status).toBe(201)
    const body = (await response.json()) as { userId: string }
    expect(body).toEqual({
      userId: body.userId,
      age: 14,
      accountStatus: 'pending_guardian_consent',
      guardianConsentRequired: true,
    })
    const [account] = await accountsFor(email)
    expect(account!.profile!.preferences).toEqual({
      compliance: {
        accountStatus: 'pending_guardian_consent',
        guardianConsentRequired: true,
      },
    })
    await expect(identity.resolveIdentity(bearer)).resolves.toEqual({
      userId: body.userId,
      role: 'teen',
    })
  })

  it('A-SHARED-CREATION: email and federated signup store identical defaults', async () => {
    const birth = birthdate(15)
    const viaEmail = address()
    const viaGoogle = address()
    expect((await emailSignup(viaEmail, birth)).status).toBe(201)
    const { bearer } = googleUser(viaGoogle)
    expect((await federated('POST', bearer, { birthdate: birth })).status).toBe(201)
    const [emailAccount] = await accountsFor(viaEmail)
    const [googleAccount] = await accountsFor(viaGoogle)
    expect(googleAccount!.profile!.preferences).toEqual(
      emailAccount!.profile!.preferences
    )
    expect(googleAccount!.profile!.display_name).toBe(emailAccount!.profile!.display_name)
    const comfortShape = (row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).filter(
          ([key]) => !['id', 'user_id', 'created_at', 'updated_at'].includes(key)
        )
      )
    expect(comfortShape(googleAccount!.comfort_profile!)).toEqual(
      comfortShape(emailAccount!.comfort_profile!)
    )
    const [emailEvent, googleEvent] = profileCompletedCalls()
    expect(Object.keys(googleEvent![2]).sort()).toEqual(
      Object.keys(emailEvent![2]).sort()
    )
  })

  it('A-NO-GOOGLE-FIELDS: no Google name, photo or subject reaches an app row', async () => {
    const email = address()
    const { bearer, user } = googleUser(email)
    expect((await federated('POST', bearer, { birthdate: birthdate(30) })).status).toBe(
      201
    )
    const [account] = await accountsFor(email)
    const stored = JSON.stringify(account)
    for (const value of [
      'Ada Federated',
      String(user.user_metadata!.picture),
      String(user.user_metadata!.sub),
      user.id,
      bearer,
    ])
      expect(stored).not.toContain(value)
    expect(account!.profile!.display_name).toBeNull()
  })

  it('A-ROLE-CLAIMS: Google metadata never sets the role, age or status', async () => {
    const email = address()
    const { bearer } = googleUser(email, {
      user_metadata: {
        name: 'Claimed Guardian',
        role: 'guardian',
        app_role: 'admin',
        birthdate: birthdate(40),
        age: 40,
      },
    })
    const response = await federated('POST', bearer, { birthdate: birthdate(14) })
    expect(response.status).toBe(201)
    const body = (await response.json()) as { userId: string }
    await expect(identity.resolveIdentity(bearer)).resolves.toEqual({
      userId: body.userId,
      role: 'teen',
    })
  })
})

describe('A-FED-BOUNDARY: the email signup age gate, unchanged', () => {
  it('admits a person on their 13th birthday as pending guardian consent', async () => {
    const { bearer } = googleUser(address())
    const response = await federated('POST', bearer, { birthdate: birthdayToday(13) })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      age: 13,
      accountStatus: 'pending_guardian_consent',
      guardianConsentRequired: true,
    })
  })

  it.each([
    [15, 'pending_guardian_consent', true],
    [16, 'active', false],
  ] as const)('age %i is %s', async (age, accountStatus, guardianConsentRequired) => {
    const { bearer } = googleUser(address())
    const response = await federated('POST', bearer, { birthdate: birthdayToday(age) })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      age,
      accountStatus,
      guardianConsentRequired,
    })
  })

  // Invalid input answers exactly what email signup answers for the same value (one gate).
  it.each([
    ['an impossible date', '2010-02-30', 400, 'Invalid signup payload'],
    ['a short date', '2010-2-3', 400, 'Invalid signup payload'],
    ['an empty value', '', 400, 'Invalid signup payload'],
  ] as const)(
    'refuses %s exactly as email signup does and creates nothing',
    async (_label, value, status, message) => {
      const viaEmail = await emailSignup(address(), value)
      expect([
        viaEmail.status,
        ((await viaEmail.json()) as { message: string }).message,
      ]).toEqual([status, message])
      const email = address()
      const { bearer } = googleUser(email)
      const response = await federated('POST', bearer, { birthdate: value })
      expect([
        response.status,
        ((await response.json()) as { message: string }).message,
      ]).toEqual([status, message])
      expect(await accountsFor(email)).toEqual([])
      expect(admin.deleteUser).not.toHaveBeenCalled()
    }
  )

  it('refuses a future date as under 13, as email signup does, and deletes the identity', async () => {
    const value = isoDate(new Date(Date.now() + 86_400_000 * 30))
    const viaEmail = await emailSignup(address(), value)
    expect([
      viaEmail.status,
      ((await viaEmail.json()) as { message: string }).message,
    ]).toEqual([403, AGE_GATE_MESSAGES.underage])
    const email = address()
    const { bearer, user } = googleUser(email)
    const response = await federated('POST', bearer, { birthdate: value })
    expect([
      response.status,
      ((await response.json()) as { message: string }).message,
    ]).toEqual([403, AGE_GATE_MESSAGES.underage])
    expect(admin.deleteUser.mock.calls).toEqual([[user.id]])
    expect(await accountsFor(email)).toEqual([])
  })
})

describe('A-FED-UNDER13: refusal deletes the Supabase identity and stores nothing', () => {
  it('answers 403, deletes the bearer auth user once and creates no row', async () => {
    const email = address()
    const { bearer, user } = googleUser(email)
    const response = await federated('POST', bearer, { birthdate: birthdayTomorrow(13) })
    expect(response.status).toBe(403)
    expect(((await response.json()) as { message: string }).message).toBe(
      AGE_GATE_MESSAGES.underage
    )
    expect(admin.deleteUser.mock.calls).toEqual([[user.id]])
    expect(await accountsFor(email)).toEqual([])
    expect(profileCompletedCalls()).toEqual([])
  })

  it('A-FED-UNDER13-DELETE-FAILS: a failed deletion still refuses and stores nothing', async () => {
    const email = address()
    const { bearer, user } = googleUser(email)
    admin.deleteUser.mockRejectedValueOnce(new Error('Auth Admin unavailable'))
    const response = await federated('POST', bearer, { birthdate: birthdate(10) })
    expect(response.status).toBe(403)
    expect(((await response.json()) as { message: string }).message).toBe(
      AGE_GATE_MESSAGES.underage
    )
    expect(admin.deleteUser.mock.calls).toEqual([[user.id]])
    expect(await accountsFor(email)).toEqual([])
  })

  it('L-C-REFUSED-THEN-RETRY: a second attempt with a new auth user starts clean', async () => {
    const email = address()
    const first = googleUser(email)
    expect(
      (await federated('POST', first.bearer, { birthdate: birthdate(12) })).status
    ).toBe(403)
    expect((await federated('GET', first.bearer)).status).toBe(401)
    const second = googleUser(email)
    expect(await (await federated('GET', second.bearer)).json()).toEqual({
      status: 'needs_birthdate',
    })
    expect(
      (await federated('POST', second.bearer, { birthdate: birthdate(12) })).status
    ).toBe(403)
    expect(admin.deleteUser.mock.calls).toEqual([[first.user.id], [second.user.id]])
    expect(await accountsFor(email)).toEqual([])
  })

  it('L-C-REFUSED-THEN-ADULT: a later adult claim is accepted, as email signup does', async () => {
    const email = address()
    const first = googleUser(email)
    expect(
      (await federated('POST', first.bearer, { birthdate: birthdate(12) })).status
    ).toBe(403)
    const second = googleUser(email)
    expect(
      (await federated('POST', second.bearer, { birthdate: birthdate(30) })).status
    ).toBe(201)
    expect(await accountsFor(email)).toHaveLength(1)
  })
})

describe('A-FED-BODY: the address comes from the bearer only', () => {
  it.each([
    ['email', { email: 'someone-else@synthetic.test' }],
    ['userId', { userId: 'user-someone-else' }],
    ['role', { role: 'guardian' }],
    ['accountStatus', { accountStatus: 'active' }],
  ])('refuses a body carrying %s with 400 and creates nothing', async (_key, extra) => {
    const email = address()
    const { bearer } = googleUser(email)
    const response = await federated('POST', bearer, {
      birthdate: birthdate(30),
      ...extra,
    })
    expect(response.status).toBe(400)
    expect(await accountsFor(email)).toEqual([])
    expect(await accountsFor('someone-else@synthetic.test')).toEqual([])
  })
})

describe('A-FED-409: an address that already has an account', () => {
  it('answers 409 and leaves the account byte-identical', async () => {
    const email = address()
    expect((await emailSignup(email, birthdate(30))).status).toBe(201)
    const before = await accountsFor(email)
    telemetry.captureEvent.mockClear()
    const { bearer } = googleUser(email)
    const response = await federated('POST', bearer, { birthdate: birthdate(14) })
    expect(response.status).toBe(409)
    expect(await accountsFor(email)).toEqual(before)
    expect(profileCompletedCalls()).toEqual([])
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it('A-FED-CASE: a case-variant Google address is the same account', async () => {
    const email = address()
    expect((await emailSignup(email, birthdate(30))).status).toBe(201)
    const { bearer } = googleUser(email.toUpperCase())
    expect((await federated('POST', bearer, { birthdate: birthdate(30) })).status).toBe(
      409
    )
    expect(await accountsFor(email)).toHaveLength(1)
  })

  it('A-FED-REPLAY: a repeated POST after success answers 409', async () => {
    const email = address()
    const { bearer } = googleUser(email)
    expect((await federated('POST', bearer, { birthdate: birthdate(30) })).status).toBe(
      201
    )
    expect((await federated('POST', bearer, { birthdate: birthdate(30) })).status).toBe(
      409
    )
    expect(await accountsFor(email)).toHaveLength(1)
    expect(profileCompletedCalls()).toHaveLength(1)
  })

  it('A-PREREG-PINNED: a pre-registered row signs in with its stored birthdate (D4)', async () => {
    const email = address()
    const signup = (await (await emailSignup(email, birthdate(17))).json()) as {
      userId: string
    }
    const { bearer } = googleUser(email)
    expect(await (await federated('GET', bearer)).json()).toEqual({ status: 'complete' })
    await expect(identity.resolveIdentity(bearer)).resolves.toEqual({
      userId: signup.userId,
      role: 'teen',
    })
  })
})

describe('A-FED-GUARDIAN: guardian-only rows (D3, TEA-2)', () => {
  it('A-FED-GUARDIAN-ATTACH: an adult birthdate attaches a profile to the same row', async () => {
    const email = address()
    const { guardian, consent } = await guardianOnlyRow(email)
    const { bearer } = googleUser(email)
    const response = await federated('POST', bearer, { birthdate: birthdate(40) })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      userId: guardian.id,
      age: 40,
      accountStatus: 'active',
      guardianConsentRequired: false,
    })
    const accounts = await accountsFor(email)
    expect(accounts.map((account) => account.id)).toEqual([guardian.id])
    expect(accounts[0]!.profile!.preferences).toEqual({
      compliance: { accountStatus: 'active', guardianConsentRequired: false },
    })
    expect(accounts[0]!.comfort_profile).not.toBeNull()
    expect(
      await prisma.guardianConsent.findUnique({ where: { id: consent.id } })
    ).toEqual(consent)
    await expect(identity.resolveIdentity(bearer)).resolves.toEqual({
      userId: guardian.id,
      role: 'guardian',
    })
    expect(profileCompletedCalls()).toHaveLength(1)
  })

  it.each([12, 16, 17])(
    'A-FED-GUARDIAN-MINOR: a granted guardian claiming age %i gets 403 and nothing attached',
    async (age) => {
      const email = address()
      const { guardian, consent } = await guardianOnlyRow(email)
      const { bearer } = googleUser(email)
      const response = await federated('POST', bearer, { birthdate: birthdate(age) })
      expect(response.status).toBe(403)
      expect(((await response.json()) as { message: string }).message).toBe(
        FEDERATED_GUARDIAN_MINOR_MESSAGE
      )
      expect(FEDERATED_GUARDIAN_MINOR_MESSAGE).toBe(
        'Guardian accounts need an adult birthdate.'
      )
      const [account] = await accountsFor(email)
      expect(account!.id).toBe(guardian.id)
      expect(account!.profile).toBeNull()
      expect(account!.comfort_profile).toBeNull()
      expect(
        await prisma.guardianConsent.findUnique({ where: { id: consent.id } })
      ).toEqual(consent)
      // The row exists, so its auth user is not an orphan and is not deleted.
      expect(admin.deleteUser).not.toHaveBeenCalled()
      expect(profileCompletedCalls()).toEqual([])
    }
  )
})

describe('A-FED-DELETE: cancel deletes only an orphan auth user', () => {
  it('deletes the bearer auth user when no account exists', async () => {
    const email = address()
    const { bearer, user } = googleUser(email)
    const response = await federated('DELETE', bearer)
    expect(response.status).toBe(204)
    expect(admin.deleteUser.mock.calls).toEqual([[user.id]])
    expect(await accountsFor(email)).toEqual([])
  })

  it('does nothing when an account exists for the address', async () => {
    const email = address()
    expect((await emailSignup(email, birthdate(30))).status).toBe(201)
    const before = await accountsFor(email)
    const { bearer } = googleUser(email)
    const response = await federated('DELETE', bearer)
    expect(response.status).toBe(204)
    expect(admin.deleteUser).not.toHaveBeenCalled()
    expect(await accountsFor(email)).toEqual(before)
  })
})

describe('L-FINISH: ordered pairs and races on account creation', () => {
  it('L-FINISH-PARALLEL: two POSTs for one bearer create one account', async () => {
    const email = address()
    const { bearer } = googleUser(email)
    const statuses = await Promise.all([
      federated('POST', bearer, { birthdate: birthdate(30) }),
      federated('POST', bearer, { birthdate: birthdate(30) }),
    ]).then((responses) => responses.map((response) => response.status).sort())
    expect(statuses).toEqual([201, 409])
    expect(await accountsFor(email)).toHaveLength(1)
    expect(profileCompletedCalls()).toHaveLength(1)
  })

  it('L-FINISH-VS-EMAIL-SIGNUP: email signup first, then federated answers 409', async () => {
    const email = address()
    expect((await emailSignup(email, birthdate(30))).status).toBe(201)
    const { bearer } = googleUser(email)
    expect((await federated('POST', bearer, { birthdate: birthdate(30) })).status).toBe(
      409
    )
    expect(await accountsFor(email)).toHaveLength(1)
  })

  it('L-FINISH-VS-EMAIL-SIGNUP: federated first, then email signup is refused', async () => {
    const email = address()
    const { bearer } = googleUser(email)
    expect((await federated('POST', bearer, { birthdate: birthdate(30) })).status).toBe(
      201
    )
    const refused = await emailSignup(email, birthdate(30))
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { message: string }).message).toBe(
      'Email already registered'
    )
    expect(await accountsFor(email)).toHaveLength(1)
  })

  it('L-FINISH-VS-EMAIL-SIGNUP: concurrent attempts leave one account', async () => {
    const email = address()
    const { bearer } = googleUser(email)
    await Promise.all([
      federated('POST', bearer, { birthdate: birthdate(30) }),
      emailSignup(email, birthdate(30)),
    ])
    expect(await accountsFor(email)).toHaveLength(1)
  })
})

describe('L-CANCEL-VS-FINISH (TEA-1): never an account whose only auth user was deleted', () => {
  it('cancel holds the lock: the finish waits, re-reads the identity and creates nothing', async () => {
    const email = address()
    const { bearer, user } = googleUser(email)
    deleteHold = deferred()
    const cancel = federated('DELETE', bearer)
    await vi.waitFor(() => expect(admin.deleteUser).toHaveBeenCalledTimes(1))
    const finish = federated('POST', bearer, { birthdate: birthdate(30) })
    deleteHold.release()
    expect((await cancel).status).toBe(204)
    expect((await finish).status).toBe(401)
    expect(deletedAuthUsers.has(user.id)).toBe(true)
    expect(await accountsFor(email)).toEqual([])
  })

  it('finish holds the lock: the cancel waits, finds the account and deletes nothing', async () => {
    const email = address()
    const { bearer, user } = googleUser(email)
    // The POST's second identity read happens inside the lock (TEA-1); hold it there.
    const gate = deferred()
    identityHolds.set(bearer, { onRead: (identityReads.get(bearer) ?? 0) + 2, gate })
    const finish = federated('POST', bearer, { birthdate: birthdate(30) })
    await vi.waitFor(() => expect(identityReads.get(bearer)).toBe(2))
    const cancel = federated('DELETE', bearer)
    gate.release()
    expect((await finish).status).toBe(201)
    expect((await cancel).status).toBe(204)
    expect(admin.deleteUser).not.toHaveBeenCalled()
    expect(deletedAuthUsers.has(user.id)).toBe(false)
    expect(await accountsFor(email)).toHaveLength(1)
  })
})

describe('L-E-THEN-GOOGLE and L-N-THEN-OTP: one account per address across methods', () => {
  it('an email member signing in with Google keeps the same account and profile', async () => {
    const email = address()
    const created = (await (await emailSignup(email, birthdate(30))).json()) as {
      userId: string
    }
    const before = await accountsFor(email)
    const { bearer } = googleUser(email, {
      app_metadata: { provider: 'email', providers: ['email', 'google'] },
    })
    expect(await (await federated('GET', bearer)).json()).toEqual({ status: 'complete' })
    await expect(identity.resolveIdentity(bearer)).resolves.toEqual({
      userId: created.userId,
      role: 'guardian',
    })
    expect(await accountsFor(email)).toEqual(before)
  })

  it('a Google-created account resolves for an email-code session on the same address', async () => {
    const email = address()
    const google = googleUser(email)
    const created = (await (
      await federated('POST', google.bearer, { birthdate: birthdate(30) })
    ).json()) as { userId: string }
    const otp = googleUser(email, {
      id: google.user.id,
      app_metadata: { provider: 'email', providers: ['email', 'google'] },
      user_metadata: {},
    })
    await expect(identity.resolveIdentity(otp.bearer)).resolves.toEqual({
      userId: created.userId,
      role: 'guardian',
    })
  })
})

describe('L-CANCEL-VS-FINISH-HELD (TEA-1, S-9): the finish blocks on the lock the cancel holds', () => {
  it('the cancel deletes inside the lock while the finish waits on it', async () => {
    const email = address()
    const { bearer, user } = googleUser(email)
    deleteHold = deferred()
    const cancel = federated('DELETE', bearer)
    await vi.waitFor(() => expect(admin.deleteUser).toHaveBeenCalledTimes(1))
    let finishSettled = false
    const finish = federated('POST', bearer, { birthdate: birthdate(30) }).then(
      (response) => {
        finishSettled = true
        return response
      }
    )
    // Release the held deletion only once the finish has read the still-live identity and is
    // blocked on this database's address lock (or, with the lock bug, has already answered).
    await vi.waitFor(
      async () => {
        expect(identityReads.get(bearer)).toBeGreaterThanOrEqual(2)
        const waiting = await prisma.$queryRaw<{ count: bigint }[]>`
          SELECT count(*)::bigint AS count FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`
        expect(finishSettled || waiting[0]!.count > 0n).toBe(true)
      },
      { timeout: 10_000, interval: 25 }
    )
    deleteHold.release()
    expect((await cancel).status).toBe(204)
    expect((await finish).status).toBe(401)
    expect(deletedAuthUsers.has(user.id)).toBe(true)
    expect(await accountsFor(email)).toEqual([])
  })
})

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const

describe('T-API-LOGS (TEA-8, S-19)', () => {
  it('no log line carries an address, birthdate or bearer on any federated path', async () => {
    // The service's own pino child, which is private: read by name.
    const logger = Reflect.get(app.get(AuthService), 'logger') as Record<
      (typeof LOG_LEVELS)[number],
      (...args: unknown[]) => void
    >
    const captured: unknown[] = []
    const spies = LOG_LEVELS.map((level) =>
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        captured.push([level, ...args])
      })
    )
    const secrets: string[] = []
    try {
      const child = birthdate(10)
      const refused = googleUser(address())
      secrets.push(refused.user.email, refused.bearer, child)
      expect((await federated('POST', refused.bearer, { birthdate: child })).status).toBe(
        403
      )
      const failing = googleUser(address())
      secrets.push(failing.user.email, failing.bearer)
      admin.deleteUser.mockRejectedValueOnce(new Error('Auth Admin unavailable'))
      expect((await federated('POST', failing.bearer, { birthdate: child })).status).toBe(
        403
      )
      const adult = birthdate(31)
      const created = googleUser(address())
      secrets.push(created.user.email, created.bearer, adult)
      expect((await federated('POST', created.bearer, { birthdate: adult })).status).toBe(
        201
      )
      expect((await federated('POST', created.bearer, { birthdate: adult })).status).toBe(
        409
      )
      const minorGuardianEmail = address()
      await guardianOnlyRow(minorGuardianEmail)
      const minorGuardian = googleUser(minorGuardianEmail)
      const sixteen = birthdate(16)
      secrets.push(minorGuardianEmail, minorGuardian.bearer, sixteen)
      expect(
        (await federated('POST', minorGuardian.bearer, { birthdate: sixteen })).status
      ).toBe(403)
      const cancelled = googleUser(address())
      secrets.push(cancelled.user.email, cancelled.bearer)
      expect((await federated('DELETE', cancelled.bearer)).status).toBe(204)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
    // The failed deletion is logged, so the capture is live.
    expect(captured.length).toBeGreaterThan(0)
    const text = JSON.stringify(captured, (_key, value: unknown) =>
      value instanceof Error ? { message: value.message, stack: value.stack } : value
    )
    for (const secret of secrets) expect(text).not.toContain(secret)
    for (const secret of secrets) expect(text).not.toContain(secret.toLowerCase())
  })
})

describe('A-FED-NO-BYPASS: no test-token or fixture bypass on the federated endpoints', () => {
  it.each([
    ['TEST_ENV', 'local'],
    ['VERCEL_ENV', 'preview'],
  ])('answers 401 on every verb with %s=%s and fixture tokens', async (name, value) => {
    vi.stubEnv(name, value)
    try {
      for (const bearer of [
        'test-token:guardian-1',
        'k6-guardian-user-1',
        'playwright-e2e-token',
      ]) {
        expect((await federated('GET', bearer)).status).toBe(401)
        expect(
          (await federated('POST', bearer, { birthdate: birthdate(30) })).status
        ).toBe(401)
        expect((await federated('DELETE', bearer)).status).toBe(401)
      }
      expect(admin.deleteUser).not.toHaveBeenCalled()
    } finally {
      vi.stubEnv(name, '')
    }
  })
})

describe('A-FED-AUTH-DOWN: an Auth outage creates and deletes nothing', () => {
  it.each(['GET', 'POST', 'DELETE'] as const)(
    '%s answers 503 when Supabase Auth cannot be reached',
    async (method) => {
      const email = address()
      const { bearer } = googleUser(email)
      // The next Supabase identity read fails at the transport.
      const real = vi.mocked(globalThis.fetch).getMockImplementation()!
      vi.mocked(globalThis.fetch).mockImplementationOnce((input, init) => {
        const target =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        return target.startsWith(IDENTITY_ORIGIN)
          ? Promise.reject(new TypeError('connect ECONNREFUSED'))
          : real(input, init)
      })
      const response = await federated(
        method,
        bearer,
        method === 'POST' ? { birthdate: birthdate(10) } : undefined
      )
      expect(response.status).toBe(503)
      expect(await accountsFor(email)).toEqual([])
      expect(admin.deleteUser).not.toHaveBeenCalled()
    }
  )
})

describe('A-FED-ROW-UNDER13 (TEA-2): a row without a profile is never an orphan, at any age', () => {
  it('A-FED-ROW-UNDER13: a profile-less row with no granted consent claiming age 12 gets 403 and keeps its Auth user', async () => {
    const email = address()
    const row = await prisma.user.create({ data: { email } })
    const { bearer } = googleUser(email)
    const response = await federated('POST', bearer, { birthdate: birthdate(12) })
    expect(response.status).toBe(403)
    expect(((await response.json()) as { message: string }).message).toBe(
      AGE_GATE_MESSAGES.underage
    )
    expect(admin.deleteUser).not.toHaveBeenCalled()
    const accounts = await accountsFor(email)
    expect(accounts.map((account) => account.id)).toEqual([row.id])
    expect(accounts[0]!.profile).toBeNull()
    expect(profileCompletedCalls()).toEqual([])
  })
})
