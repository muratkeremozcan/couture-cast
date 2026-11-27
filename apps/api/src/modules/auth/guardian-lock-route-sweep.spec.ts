// A-LOCK-ROUTE-SWEEP (teen-path review, 2026-11-15): every API route either runs the guardian
// lock (RequestAuthGuard, which refuses a teen the policy locks) or is named below with a reason.
// A new route without the guard fails here until someone decides which it is.
import 'reflect-metadata'
import { RequestMethod, type Type } from '@nestjs/common'
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants'
import { afterEach, describe, expect, it } from 'vitest'
import { AppModule } from '../../app.module'
import { GuardianConsentPolicyGuard } from './guardian-consent-policy'
import {
  API_ALLOW_PENDING_GUARDIAN_TEEN_KEY,
  API_TRANSACTIONAL_CONSENT_KEY,
} from './security.decorators'
import { RequestAuthGuard } from './security.guards'

type Route = {
  route: string
  handler: string
  guards: unknown[]
  allowsPendingGuardianTeen: boolean
  consentCheckedInTransaction: boolean
}

const join = (...parts: string[]) =>
  `/${parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/')}`

function collectRoutes(): Route[] {
  const seen = new Set<unknown>()
  const controllers = new Set<Type>()
  const walk = (entry: unknown) => {
    if (!entry || seen.has(entry)) return
    seen.add(entry)
    const dynamic = entry as { module?: Type; imports?: unknown[]; controllers?: Type[] }
    const target = dynamic.module ?? (entry as Type)
    for (const controller of Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, target) ??
      [])
      controllers.add(controller as Type)
    for (const child of Reflect.getMetadata(MODULE_METADATA.IMPORTS, target) ?? [])
      walk(child)
    for (const child of dynamic.imports ?? []) walk(child)
    for (const controller of dynamic.controllers ?? []) controllers.add(controller)
  }
  walk(AppModule)

  const routes: Route[] = []
  for (const controller of controllers) {
    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '')
    const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) ??
      []) as unknown[]
    const prototype = controller.prototype as Record<string, unknown>
    for (const key of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[key]
      if (key === 'constructor' || typeof handler !== 'function') continue
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined
      if (path === undefined) continue
      const method =
        RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number]
      routes.push({
        route: `${method} ${join(base, path)}`,
        handler: `${controller.name}.${key}`,
        guards: [
          ...classGuards,
          ...((Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[]),
        ],
        allowsPendingGuardianTeen:
          (Reflect.getMetadata(API_ALLOW_PENDING_GUARDIAN_TEEN_KEY, handler) ??
            Reflect.getMetadata(API_ALLOW_PENDING_GUARDIAN_TEEN_KEY, controller)) ===
          true,
        consentCheckedInTransaction:
          Reflect.getMetadata(API_TRANSACTIONAL_CONSENT_KEY, handler) === true,
      })
    }
  }
  return routes
}

/** Routes without RequestAuthGuard, each with the reason it needs none. */
const OUTSIDE_THE_LOCK: Record<string, string> = {
  'GET /': 'The root banner: no account data.',
  'GET /api/health': 'Deployment health probe: no account data.',
  'GET /api/v1/health/queues': 'Queue health probe: counts only, no account data.',
  'POST /api/v1/auth/signup': 'Creates the account; the caller has none yet.',
  'GET /api/v1/auth/signup/federated':
    'Reads the bearer through Supabase itself (readVerifiedSupabaseIdentity); the caller may have no account yet.',
  'POST /api/v1/auth/signup/federated':
    'Creates the account from the verified Supabase identity; the caller has none yet.',
  'DELETE /api/v1/auth/signup/federated':
    'Deletes only an orphan Supabase identity the bearer owns; the caller has no account.',
  'POST /api/v1/commerce/affiliate/webhook':
    'Signed by the affiliate network, not a user.',
  'POST /api/v1/commerce/subscription/webhooks/revenuecat':
    'Signed by RevenueCat, not a user.',
  'POST /api/v1/commerce/subscription/webhooks/stripe': 'Signed by Stripe, not a user.',
  'POST /api/v1/guardian/invitations':
    'Refused by GuardianConsentPolicyGuard while consent is off. Taking a teen bearer is teen-path finding B-1, a precondition of turning consent back on.',
  'POST /api/v1/guardian/accept':
    'Refused by GuardianConsentPolicyGuard while consent is off. Requiring the invited guardian signed in is teen-path finding B-1.',
}

/** The guardian consent endpoints: each refuses first while consent is off. */
const GUARDIAN_CONSENT_ROUTES = [
  'POST /api/v1/guardian/invitations',
  'POST /api/v1/guardian/accept',
  'POST /api/v1/guardian/revoke',
  'POST /api/v1/auth/guardian-consent',
]

/**
 * Handlers whose teen consent check runs inside their own transaction instead of the guard
 * (community comments, reactions and sync). Under policy off they let a waiting teen through
 * like the guard does; under required_13_15 some admit a waiting teen to reads, which is
 * teen-path finding B-5 on the re-enable checklist.
 */
const CONSENT_CHECKED_IN_TRANSACTION = [
  'CommunityCommentsController.create',
  'CommunityCommentsController.delete',
  'CommunityCommentsController.replies',
  'CommunityCommentsController.report',
  'CommunityCommentsController.roots',
  'CommunityCommentsController.submissions',
  'CommunityController.editPostText',
  'CommunityController.setReaction',
  'CommunitySyncController.events',
  'CommunitySyncController.preferencesGet',
  'CommunitySyncController.preferencesPatch',
  'CommunitySyncController.resolve',
]

describe.each(['off', 'required_13_15'] as const)(
  'A-LOCK-ROUTE-SWEEP under policy %s',
  (policy) => {
    afterEach(() => {
      delete process.env.GUARDIAN_CONSENT_POLICY
    })

    const routes = collectRoutes()

    it('finds the whole API', () => {
      expect(routes.length).toBeGreaterThan(100)
    })

    it('every route runs the guardian lock or is named with a reason', () => {
      const unguarded = routes
        .filter((route) => !route.guards.includes(RequestAuthGuard))
        .map((route) => route.route)
        .sort()
      expect(unguarded).toEqual(Object.keys(OUTSIDE_THE_LOCK).sort())
    })

    // CC-7.21 Step 78: a pending teen can load their own profile and review comfort.
    it('keeps pending-teen profile and comfort access scoped to the owner routes', () => {
      const ownerRoutes = routes.filter(
        ({ route }) =>
          route.includes(' /api/v1/user/') ||
          route.endsWith(' /api/v1/personalization/comfort')
      )
      expect(
        ownerRoutes
          .filter(({ allowsPendingGuardianTeen }) => allowsPendingGuardianTeen)
          .map(({ route }) => route)
          .sort()
      ).toEqual([
        'GET /api/v1/personalization/comfort',
        'GET /api/v1/user/profile',
        'PUT /api/v1/personalization/comfort',
      ])
    })

    it('every guardian consent endpoint refuses before anything else while consent is off', () => {
      process.env.GUARDIAN_CONSENT_POLICY = policy
      for (const name of GUARDIAN_CONSENT_ROUTES) {
        const route = routes.find((candidate) => candidate.route === name)
        expect(route, name).toBeDefined()
        expect(route!.guards[0], name).toBe(GuardianConsentPolicyGuard)
      }
      const guard = new GuardianConsentPolicyGuard()
      if (policy === 'off') expect(() => guard.canActivate()).toThrow()
      else expect(guard.canActivate()).toBe(true)
    })

    it('names every handler that checks consent in its own transaction', () => {
      expect(
        routes
          .filter((route) => route.consentCheckedInTransaction)
          .map((route) => route.handler)
          .sort()
      ).toEqual([...CONSENT_CHECKED_IN_TRANSACTION].sort())
    })
  }
)
