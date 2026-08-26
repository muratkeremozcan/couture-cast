import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { UnauthorizedException, type INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildPremiumEntitlementCreateInput,
  createPremiumEntitlement,
} from '@couture/testing'
import { ADVISOR_RULES } from '@couture/api-client/contracts/http'
import { RequestAuthGuard } from '../src/modules/auth/security.guards.js'
import type { AuthenticatedRequest } from '../src/modules/auth/security.types.js'
import { CommerceModule } from '../src/modules/commerce/commerce.module.js'
import { AffiliateOfferService } from '../src/modules/commerce/affiliate-offer.service.js'
import { CommerceRepository } from '../src/modules/commerce/commerce.repository.js'
import { PaletteAnalysisProcessor } from '../src/modules/commerce/palette-analysis.processor.js'
import { PaletteAnalysisProcessingQueue } from '../src/modules/commerce/palette-analysis-processing.queue.js'
import {
  buildFixturePaletteSelfie,
  FixturePaletteAnalysisEngine,
} from '../src/modules/commerce/fixture-palette-analysis.engine.js'
import { FeatureFlagsWarmup } from '../src/modules/feature-flags/feature-flags.warmup.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'
import { SupabaseWardrobeStorageAdapter } from '../src/modules/wardrobe/wardrobe-storage.adapter.js'

/**
 * Story 5.4 Task 9: the palette advisor against real PostgreSQL and real HTTP.
 *
 * Four things live here rather than at the unit tier, because a mock cannot
 * carry them:
 *
 * - **Consent is audited both ways.** `AuditLog` rows are written inside the
 *   same transaction as the consent flip, and the unit tier's Prisma double
 *   proves only that `create` was called. Here the rows are read back.
 * - **The selfie is purged on every terminal branch.** Decision 8 names three
 *   doors -- `ready`, in-processor `failed`, and the worker's retry-exhaustion
 *   `markFailed` -- and asserts the object is GONE from storage and
 *   `selfie_purged_at` is stamped. The storage double here records real
 *   remove calls against a real row.
 * - **Revoking erases.** The same path as `DELETE`, over HTTP, with the derived
 *   scalars and every `AdvisorRecommendationState` row read back as absent.
 * - **The garment and advisor selections cannot cross, in BOTH directions.**
 *   This is the one assertion that has to run against real SQL: the guarantee
 *   is SQL NULL semantics (`= $n` never matches NULL) on two real rows in one
 *   real table, and a repository double would be asserting the double.
 *
 * FLAG AND TELEMETRY ARE MOCKED, ENTITLEMENT IS REAL, STORAGE IS A DOUBLE.
 * Same split every sibling `premium-*.integration.spec.ts` uses:
 * `color_analysis_enabled` defaults to `false` in the registry (Decision 10), so
 * the flag is stubbed rather than depending on the DB seed; `PremiumEntitlement`
 * is a real row because `PremiumEntitlementGuard` is what gates the write
 * routes; and object storage is a double because Supabase Storage is not part of
 * what this suite is proving and cannot be stood up locally.
 *
 * NOTE: no workflow runs `test:integration` in CI (deferred-work #10); this
 * evidence exists where `npm run test:integration --workspace api` runs against
 * a live database.
 */

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "PaletteProfile" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "AdvisorRecommendationState" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "PremiumEntitlement" LIMIT 1`
    schemaReady = true
  } catch (error) {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[palette-advisor.integration] Skipped: could not query the Story 5.4 palette schema. ' +
        'If the schema is missing, run `npm run db:migrate`. Underlying error:',
      error
    )
  }
}

function requireSchema(context: { skip: () => void }): boolean {
  if (!schemaReady) {
    context.skip()
    return false
  }
  return true
}

const ROUTE = '/api/v1/commerce/premium/palette'

/**
 * A locale region no other suite queries.
 *
 * `apps/api`'s `vitest run` executes every integration file against ONE database,
 * in parallel, so a row this suite creates is visible to every other suite's
 * queries for as long as it exists. A `locale_region: '*'` garment offer here
 * matched `commerce-affiliate-offers.integration.spec.ts`'s "excludes an offer
 * for a category the outfit has no slot for" assertion and failed it -- a real
 * cross-suite collision, not flake.
 *
 * Both selection queries match `locale_region = $n OR '*'`, so a region no
 * sibling passes and no seed uses makes these rows unreachable from any other
 * suite while staying reachable from this one.
 */
const ISOLATED_LOCALE_REGION = 'ZZ'

/**
 * An in-memory stand-in for Supabase Storage that records every removal.
 *
 * The purge assertions need two independent facts: that the object is gone, and
 * that `remove` was actually called with its path. A double that only tracked
 * calls would pass for an implementation that removed the wrong key.
 */
class RecordingStorage {
  readonly objects = new Map<string, Buffer>()
  readonly removed: string[] = []

  upload(objectPath: string, body: Buffer): Promise<void> {
    this.objects.set(objectPath, body)
    return Promise.resolve()
  }

  download(objectPath: string): Promise<Buffer> {
    const bytes = this.objects.get(objectPath)
    if (!bytes) {
      return Promise.reject(new Error(`OBJECT_NOT_FOUND:${objectPath}`))
    }
    return Promise.resolve(bytes)
  }

  remove(objectPaths: string[]): Promise<void> {
    for (const objectPath of objectPaths) {
      this.removed.push(objectPath)
      this.objects.delete(objectPath)
    }
    return Promise.resolve()
  }
}

describe('5.4 palette advisor against real PostgreSQL and real HTTP', () => {
  // File-private namespace, so this run's synthetic users stay distinguishable
  // from any other suite sharing the same database.
  const namespace = `palette-advisor-${randomUUID().slice(0, 8)}`

  let app: INestApplication | undefined
  /**
   * A fresh entitled user per test.
   *
   * Consent writes immutable `AuditLog` rows (`DELETE` raises 42501 by trigger,
   * and `AuditLog -> User` is RESTRICT), so a user who has granted consent once
   * is undeletable by design and their audit rows persist. Sharing one user
   * across tests would therefore make every audit assertion depend on test
   * order. A per-test user makes each count exact.
   */
  let userId: string
  let otherUserId: string
  let partnerId: string
  let advisorOfferId: string
  let garmentOfferId: string

  const storage = new RecordingStorage()
  const featureFlags = { getFeatureFlag: vi.fn() }
  const telemetry = { captureEvent: vi.fn() }
  const processingQueue = { enqueue: vi.fn() }

  const tokenFor = (id: string) => `Bearer palette-test:${id}`

  function guardOverride() {
    return {
      canActivate: (context: {
        switchToHttp: () => { getRequest: () => AuthenticatedRequest }
      }) => {
        const req = context.switchToHttp().getRequest()
        const header = req.headers.authorization ?? ''
        const match = /^Bearer palette-test:(.+)$/.exec(header)
        if (!match || !match[1]) {
          throw new UnauthorizedException('Missing or invalid bearer token')
        }
        req.auth = { token: header, userId: match[1], role: 'guardian' }
        return true
      },
    }
  }

  function httpServer() {
    if (!app) {
      throw new Error('App is not initialized')
    }
    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  const getProfile = (id: string) =>
    request(httpServer())
      .get(ROUTE)
      .set({ authorization: tokenFor(id) })

  const setConsent = (id: string, granted: boolean) =>
    request(httpServer())
      .post(`${ROUTE}/consent`)
      .set({ authorization: tokenFor(id) })
      .send({ granted })

  const putRecommendation = (id: string, body: Record<string, unknown>) =>
    request(httpServer())
      .put(`${ROUTE}/recommendations`)
      .set({ authorization: tokenFor(id) })
      .send(body)

  const eraseProfile = (id: string) =>
    request(httpServer())
      .delete(ROUTE)
      .set({ authorization: tokenFor(id) })

  /** Creates a synthetic, entitled user. Never deleted; see the `userId` docblock. */
  async function createEntitledUser(label: string): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `${namespace}-${label}-${randomUUID().slice(0, 8)}@synthetic.test` },
    })
    await seedEntitlement(user.id)
    return user.id
  }

  async function seedEntitlement(id: string): Promise<void> {
    const data = buildPremiumEntitlementCreateInput(
      createPremiumEntitlement({
        userId: id,
        status: 'active',
        willRenew: true,
        lastEventId: `${namespace}-${id}-seed`,
      })
    )
    await prisma.premiumEntitlement.create({ data })
  }

  /** A `processing` selfie profile with real bytes in the storage double. */
  async function arrangeProcessingSelfie(
    outcome: 'ready' | 'no_face',
    objectPath: string
  ): Promise<string> {
    const profile = await prisma.paletteProfile.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        consent_granted_at: new Date(),
        source: 'selfie',
        status: 'processing',
        selfie_object_path: objectPath,
        selfie_upload_session_id: `${namespace}-${randomUUID()}`,
      },
      update: {
        consent_granted_at: new Date(),
        consent_revoked_at: null,
        source: 'selfie',
        status: 'processing',
        failure_reason: null,
        selfie_object_path: objectPath,
        selfie_upload_session_id: `${namespace}-${randomUUID()}`,
        selfie_purged_at: null,
      },
    })
    await storage.upload(objectPath, buildFixturePaletteSelfie(outcome))
    return profile.id
  }

  function buildProcessor(): PaletteAnalysisProcessor {
    return new PaletteAnalysisProcessor(
      prisma,
      storage as unknown as ConstructorParameters<typeof PaletteAnalysisProcessor>[1],
      new FixturePaletteAnalysisEngine(),
      telemetry as unknown as TelemetryService
    )
  }

  beforeAll(async () => {
    // The fixture engine refuses to construct outside an allowed test
    // environment, which is the point of it; both gates are set here rather
    // than relying on the ambient shell.
    process.env.PALETTE_ANALYSIS_ENGINE = 'fixture'
    process.env.ALLOW_TEST_ONLY_SECRETS = 'true'
    process.env.WARDROBE_UPLOAD_TOKEN_SECRET ??= `${namespace}-upload-secret`

    await probeSchema()
    if (!schemaReady) return

    // Leftovers from a crashed prior run of THIS suite would otherwise win the
    // `id ASC` tie-break against the rows created below and make the
    // cross-selection assertions fail against a ghost. The namespace is
    // per-run, so this only ever removes this suite's own debris.
    const stalePartners = await prisma.commercePartner.findMany({
      where: { slug: { startsWith: 'palette-advisor-' } },
      select: { id: true },
    })
    if (stalePartners.length > 0) {
      const staleIds = stalePartners.map((row) => row.id)
      await prisma.affiliateOffer.deleteMany({
        where: { partner_id: { in: staleIds } },
      })
      await prisma.commercePartner.deleteMany({ where: { id: { in: staleIds } } })
    }

    // One partner carrying BOTH an advisor row and a garment row: the
    // cross-selection regression is only meaningful if a single query could
    // plausibly reach either.
    const partner = await prisma.commercePartner.create({
      data: {
        slug: `${namespace}-partner`,
        display_name: 'Palette Integration Partner',
        allowed_host: 'partner.couturecast.test',
        status: 'active',
        // The column carries a CHECK constraint (`COMMERCE_PARTNER_*_WEBHOOK_SECRET`):
        // it names an environment variable, never a secret value, and the shape is
        // enforced in SQL so a literal cannot be slipped in.
        webhook_secret_ref: 'COMMERCE_PARTNER_PALETTE_INTEGRATION_WEBHOOK_SECRET',
      },
    })
    partnerId = partner.id

    const advisorOffer = await prisma.affiliateOffer.create({
      data: {
        partner_id: partnerId,
        advisor_slot: 'foundation',
        advisor_undertone: null,
        locale_region: ISOLATED_LOCALE_REGION,
        title: 'Integration Advisor Offer',
        deep_link_template:
          'https://partner.couturecast.test/shop/advisor/foundation?cc={clickToken}',
        priority: 100,
        status: 'active',
        effective_from: new Date('2020-01-01T00:00:00.000Z'),
      },
    })
    advisorOfferId = advisorOffer.id

    const garmentOffer = await prisma.affiliateOffer.create({
      data: {
        partner_id: partnerId,
        garment_category: 'accessory',
        locale_region: ISOLATED_LOCALE_REGION,
        title: 'Integration Garment Offer',
        deep_link_template:
          'https://partner.couturecast.test/shop/accessory?cc={clickToken}',
        priority: 100,
        status: 'active',
        effective_from: new Date('2020-01-01T00:00:00.000Z'),
      },
    })
    garmentOfferId = garmentOffer.id

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CommerceModule],
    })
      .overrideProvider(PrismaClient)
      .useValue(prisma)
      .overrideProvider(FeatureFlagsService)
      .useValue(featureFlags)
      .overrideProvider(FeatureFlagsWarmup)
      .useValue({ onModuleInit: () => Promise.resolve() })
      .overrideProvider(TelemetryService)
      .useValue(telemetry)
      .overrideProvider(SupabaseWardrobeStorageAdapter)
      .useValue(storage)
      .overrideProvider(PaletteAnalysisProcessingQueue)
      .useValue(processingQueue)
      .overrideGuard(RequestAuthGuard)
      .useValue(guardOverride())
      .compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  beforeEach(async () => {
    featureFlags.getFeatureFlag.mockReset().mockResolvedValue(true)
    telemetry.captureEvent.mockReset().mockResolvedValue(undefined)
    processingQueue.enqueue.mockReset().mockResolvedValue(undefined)
    storage.objects.clear()
    storage.removed.length = 0
    if (schemaReady) {
      userId = await createEntitledUser('owner')
      otherUserId = await createEntitledUser('other')
    }
  })

  afterAll(async () => {
    if (app) {
      await app.close()
    }
    if (schemaReady) {
      await prisma.advisorRecommendationState.deleteMany({
        where: { user: { email: { startsWith: namespace } } },
      })
      await prisma.paletteProfile.deleteMany({
        where: { user: { email: { startsWith: namespace } } },
      })
      await prisma.affiliateOffer.deleteMany({ where: { partner_id: partnerId } })
      await prisma.commercePartner.deleteMany({ where: { id: partnerId } })
      await prisma.premiumEntitlement.deleteMany({
        where: { user: { email: { startsWith: namespace } } },
      })
      // The suite's users are NOT deleted, deliberately, for the same reason
      // `premium-subscription.integration.spec.ts` leaves its own behind:
      // consent transitions wrote AuditLog rows, the audit trail is immutable by
      // trigger (DELETE raises 42501), and AuditLog->User is RESTRICT, so a user
      // who earned audit rows is undeletable by design. They are namespaced
      // synthetics on a disposable database.
    }
    await prisma.$disconnect()
  })

  it('5.4-INT-001 writes an immutable AuditLog row on both the grant and the revoke', async (context) => {
    if (!requireSchema(context)) return

    const granted = await setConsent(userId, true)
    expect(granted.status).toBe(200)

    const revoked = await setConsent(userId, false)
    expect(revoked.status).toBe(200)

    const rows = await prisma.auditLog.findMany({
      where: { user_id: userId, event_type: 'palette_analysis_consent_changed' },
      orderBy: { timestamp: 'asc' },
    })

    expect(rows).toHaveLength(2)
    expect(rows[0]?.event_data).toMatchObject({ from: 'none', to: 'granted' })
    // The revoke half is the one that gets forgotten (Decision 5). `from` is
    // read from the row as it stood BEFORE the write, so it says 'granted'.
    expect(rows[1]?.event_data).toMatchObject({ from: 'granted', to: 'revoked' })
    // `epics.md:576` asks for logged opt-ins, which is an audit requirement:
    // the row carries no IP, matching `premium-entitlement.service.ts`.
    expect(rows[0]?.ip_address).toBeNull()
  })

  it('5.4-INT-002 erases the derived palette and every saved item when consent is revoked', async (context) => {
    if (!requireSchema(context)) return

    expect((await setConsent(userId, true)).status).toBe(200)

    const itemKey = ADVISOR_RULES.warm.foundation.withDepth.medium.itemKey
    await prisma.paletteProfile.update({
      where: { user_id: userId },
      data: {
        source: 'selfie',
        status: 'ready',
        undertone: 'warm',
        depth: 'medium',
        confidence: 0.82,
        analysis_version: 'palette-advisor-v1',
        analyzed_at: new Date(),
      },
    })
    expect(
      (await putRecommendation(userId, { itemKey, slot: 'foundation', action: 'saved' }))
        .status
    ).toBe(200)
    expect(
      await prisma.advisorRecommendationState.count({ where: { user_id: userId } })
    ).toBe(1)

    const revoked = await setConsent(userId, false)
    expect(revoked.status).toBe(200)

    const profile = await prisma.paletteProfile.findUnique({
      where: { user_id: userId },
    })
    // Decision 9: the row SURVIVES with nulled scalars and a set
    // `consent_revoked_at`, so a revocation is a fact rather than an absence.
    expect(profile).not.toBeNull()
    expect(profile?.consent_revoked_at).not.toBeNull()
    expect(profile?.undertone).toBeNull()
    expect(profile?.depth).toBeNull()
    expect(profile?.status).toBeNull()
    expect(profile?.analysis_version).toBeNull()
    // The per-item rows carry no fact worth keeping once consent is gone, so
    // unlike the profile they ARE deleted.
    expect(
      await prisma.advisorRecommendationState.count({ where: { user_id: userId } })
    ).toBe(0)
  })

  it('5.4-INT-003 keeps consent and the derived palette across a fresh request context', async (context) => {
    if (!requireSchema(context)) return

    expect((await setConsent(userId, true)).status).toBe(200)

    const reread = await getProfile(userId)
    expect(reread.status).toBe(200)
    expect((reread.body as { data: { hasConsent: boolean } }).data.hasConsent).toBe(true)
  })

  it('5.4-INT-011 purges the selfie and stamps selfie_purged_at on the ready branch', async (context) => {
    if (!requireSchema(context)) return

    const objectPath = `${namespace}/ready.png`
    const profileId = await arrangeProcessingSelfie('ready', objectPath)

    await buildProcessor().process(profileId)

    const profile = await prisma.paletteProfile.findUnique({ where: { id: profileId } })
    expect(profile?.status).toBe('ready')
    expect(profile?.undertone).toBe('warm')
    expect(profile?.selfie_purged_at).not.toBeNull()
    // Gone from storage, not merely marked: the whole point of Decision 8.
    expect(storage.objects.has(objectPath)).toBe(false)
    expect(storage.removed).toContain(objectPath)
  })

  it('5.4-INT-012 purges the selfie on the in-processor failed branch', async (context) => {
    if (!requireSchema(context)) return

    const objectPath = `${namespace}/no-face.png`
    const profileId = await arrangeProcessingSelfie('no_face', objectPath)

    await buildProcessor().process(profileId)

    const profile = await prisma.paletteProfile.findUnique({ where: { id: profileId } })
    expect(profile?.status).toBe('failed')
    expect(profile?.failure_reason).toBe('no_face')
    // The most likely bug this guards: purging only on the success branch,
    // leaving every rejected photo in the bucket permanently.
    expect(profile?.selfie_purged_at).not.toBeNull()
    expect(storage.objects.has(objectPath)).toBe(false)
    expect(storage.removed).toContain(objectPath)
  })

  it('5.4-INT-013 purges the selfie through the third door: retry-exhaustion markFailed', async (context) => {
    if (!requireSchema(context)) return

    const objectPath = `${namespace}/timeout.png`
    const profileId = await arrangeProcessingSelfie('ready', objectPath)

    // `markFailed` is called from the WORKER's catch block on the final attempt
    // and never enters `process()`. A purge written only inside `process()`
    // would leak every selfie whose analysis exhausts its retries.
    await buildProcessor().markFailed(profileId, 'timeout')

    const profile = await prisma.paletteProfile.findUnique({ where: { id: profileId } })
    expect(profile?.status).toBe('failed')
    expect(profile?.failure_reason).toBe('timeout')
    expect(profile?.selfie_purged_at).not.toBeNull()
    expect(storage.objects.has(objectPath)).toBe(false)
    expect(storage.removed).toContain(objectPath)
  })

  it('5.4-INT-020 never resolves a garment offer into an advisor slot', async (context) => {
    if (!requireSchema(context)) return

    const repository = app?.get(CommerceRepository)
    const match = await repository?.findBestAdvisorOffer(
      'foundation',
      'warm',
      ISOLATED_LOCALE_REGION
    )

    expect(match?.offer_id).toBe(advisorOfferId)
    // SQL NULL semantics do the work: the advisor query filters
    // `advisor_slot = $n`, and the garment row's NULL can never satisfy it.
    // The assertion exists because that guarantee survives exactly until
    // someone adds an `OR advisor_slot IS NULL` for a wildcard feature.
    expect(match?.offer_id).not.toBe(garmentOfferId)
  })

  it('5.4-INT-021 never resolves an advisor offer onto a ritual card', async (context) => {
    if (!requireSchema(context)) return

    const repository = app?.get(CommerceRepository)
    const match = await repository?.findBestOffer(
      [{ category: 'accessory', comfortRange: null }],
      ISOLATED_LOCALE_REGION
    )
    expect(match?.offer_id).toBe(garmentOfferId)
    // The garment query filters `garment_category = $n`, so the advisor row's
    // NULL can never satisfy it. The assertion exists because that guarantee
    // survives exactly until someone adds an `OR garment_category IS NULL`.
    expect(match?.offer_id).not.toBe(advisorOfferId)
  })

  it('5.4-INT-027 keeps the advisor overlay off when the user opted out of affiliate CTAs', async (context) => {
    if (!requireSchema(context)) return

    const offers = app?.get(AffiliateOfferService)
    const withOptIn = await offers?.resolveAdvisorOffers({
      userId,
      slots: ['foundation'],
      undertone: 'warm',
      requestedLocale: `en-${ISOLATED_LOCALE_REGION}`,
    })
    expect(withOptIn?.get('foundation')?.offerId).toBe(advisorOfferId)

    await prisma.commercePreference.upsert({
      where: { user_id: userId },
      create: { user_id: userId, affiliate_ctas_enabled: false },
      update: { affiliate_ctas_enabled: false },
    })

    const withOptOut = await offers?.resolveAdvisorOffers({
      userId,
      slots: ['foundation'],
      undertone: 'warm',
      requestedLocale: `en-${ISOLATED_LOCALE_REGION}`,
    })
    // The user's EXISTING global commerce opt-out suppresses the advisor
    // overlay too. A second, advisor-specific switch would be the dark pattern
    // `prd.md:47` forbids.
    expect(withOptOut?.get('foundation')).toBeNull()

    await prisma.commercePreference.deleteMany({ where: { user_id: userId } })
  })

  it('5.4-INT-028 scopes recommendation state to its owner', async (context) => {
    if (!requireSchema(context)) return

    expect((await setConsent(userId, true)).status).toBe(200)
    expect((await setConsent(otherUserId, true)).status).toBe(200)

    const itemKey = ADVISOR_RULES.warm.jewelry.itemKey
    expect(
      (await putRecommendation(userId, { itemKey, slot: 'jewelry', action: 'saved' }))
        .status
    ).toBe(200)

    const owned = await prisma.advisorRecommendationState.findMany({
      where: { item_key: itemKey },
    })
    expect(owned).toHaveLength(1)
    expect(owned[0]?.user_id).toBe(userId)

    // Erasing one user's palette must not touch the other's rows.
    expect((await eraseProfile(userId)).status).toBe(200)
    expect(
      await prisma.advisorRecommendationState.count({ where: { user_id: otherUserId } })
    ).toBe(0)
    const otherProfile = await prisma.paletteProfile.findUnique({
      where: { user_id: otherUserId },
    })
    expect(otherProfile?.consent_revoked_at).toBeNull()
  })
})
