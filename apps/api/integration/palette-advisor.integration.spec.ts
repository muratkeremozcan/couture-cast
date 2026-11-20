import { listenHttpApp, httpTestUrl } from '../src/testing/loopback-http-app.js'
// Learning path Step 36: Colour palette, beauty and accessory advisor.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-36-colour-palette-beauty-and-accessory-advisor
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import 'reflect-metadata'
import { createHash, randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import {
  ConflictException,
  UnauthorizedException,
  type INestApplication,
} from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import sharp from 'sharp'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildPremiumEntitlementCreateInput,
  createPremiumEntitlement,
} from '@couture/testing'
import {
  ADVISOR_RULES,
  listAdvisorRuleEntries,
  PALETTE_CONSENT_REQUIRED_MESSAGE,
  type PaletteAdvisorProfile,
} from '@couture/api-client/contracts/http'
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
import { WardrobeObjectDeletionOutbox } from '../src/modules/wardrobe/wardrobe-object-deletion.outbox.js'
import {
  AMBIGUOUS_PUBLICATION_HORIZON_MS,
  PUBLISH_CLAIM_LEASE_MS,
  REPEATING_REMOVAL_INTERVAL_MS,
} from '../src/modules/wardrobe/wardrobe-publication.js'
import {
  STAGED_UPLOAD_RETENTION_MS,
  WardrobeRetentionService,
} from '../src/modules/wardrobe/wardrobe-retention.service.js'

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
  readonly createdAt = new Map<string, Date>()
  /** What the server wrote to each final key: content type and cache policy (C2-9). */
  readonly published = new Map<string, { contentType: string; cacheControl: string }>()
  /** Runs once after the next bounded download returns, to model an overlapping write. */
  afterNextDownload: (() => void) | null = null
  /** Makes the next `remove` call fail, the way a transient storage fault does. */
  failNextRemove = false
  /**
   * Makes the next `publish` write its bytes and then fail, the way a write storage applied
   * whose acknowledgement never reached the API does (round 4, Codex C3-1).
   */
  loseNextPublishAck = false
  /** Every server publish, in order: its final key. */
  readonly publishes: string[] = []
  /** When set, the next `publish` waits for it before writing; a test releases it. */
  holdNextPublish: Promise<void> | null = null
  /** Resolves when a held publish has started. */
  publishHeld: Promise<void> = Promise.resolve()
  private releasePublishHeld: () => void = () => undefined
  private readonly signedPaths = new Map<string, string>()

  /** Holds the next publish until `release` resolves, and reports when it started. */
  holdPublishUntil(release: Promise<void>): void {
    this.holdNextPublish = release
    this.publishHeld = new Promise((resolve) => {
      this.releasePublishHeld = resolve
    })
  }

  /** Seeds an object directly, the way a finished upload leaves it. */
  upload(objectPath: string, body: Buffer): Promise<void> {
    this.objects.set(objectPath, body)
    return Promise.resolve()
  }

  /**
   * One object per signed URL, signed without upsert (round 4): the first PUT wins, and a key
   * that already holds bytes cannot be signed again, which the adapter answers as 409
   * UPLOAD_BYTES_PRESENT.
   */
  createUploadSession(
    objectPath: string
  ): Promise<{ uploadUrl: string; uploadToken: string; tokenExpiresAt: Date }> {
    if (this.objects.has(objectPath)) {
      return Promise.reject(new ConflictException('UPLOAD_BYTES_PRESENT'))
    }
    const uploadUrl = `https://storage.test/storage/v1/object/upload/sign/wardrobe-images/${objectPath}?token=${randomUUID()}`
    this.signedPaths.set(uploadUrl, objectPath)
    return Promise.resolve({
      uploadUrl,
      uploadToken: randomUUID(),
      tokenExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    })
  }

  /**
   * A client PUT of `body` to a signed upload URL. Staging keys take one write: a PUT to a key
   * that holds bytes is refused as a duplicate and changes nothing.
   */
  clientPut(uploadUrl: string, body: Buffer): Promise<'stored' | 'duplicate'> {
    const objectPath = this.signedPaths.get(uploadUrl)
    if (!objectPath) return Promise.reject(new Error('upload URL was never signed'))
    if (this.objects.has(objectPath)) return Promise.resolve('duplicate')
    this.objects.set(objectPath, body)
    this.createdAt.set(objectPath, new Date())
    return Promise.resolve('stored')
  }

  /** The server's own write of verified bytes to a final key; it overwrites. */
  async publish(objectPath: string, bytes: Buffer, contentType: string): Promise<void> {
    const hold = this.holdNextPublish
    if (hold) {
      this.holdNextPublish = null
      this.releasePublishHeld()
      await hold
    }
    this.objects.set(objectPath, Buffer.from(bytes))
    this.published.set(objectPath, { contentType, cacheControl: 'private, max-age=0' })
    this.publishes.push(objectPath)
    if (this.loseNextPublishAck) {
      this.loseNextPublishAck = false
      throw new Error('publish acknowledgement lost')
    }
  }

  listStagedUploads(
    limit: number,
    cursor: string | null = null
  ): Promise<{
    objects: { objectPath: string; createdAt: Date }[]
    nextCursor: string | null
  }> {
    const all = [...this.objects.keys()]
      .filter((objectPath) => objectPath.startsWith('staging/'))
      .map((objectPath) => ({ objectPath, createdAt: this.createdAt.get(objectPath)! }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    const start = cursor ? Number(cursor) : 0
    const objects = all.slice(start, start + limit)
    const next = start + limit
    return Promise.resolve({
      objects,
      nextCursor: next < all.length ? String(next) : null,
    })
  }

  downloadBounded(
    objectPath: string,
    maxBytes: number
  ): Promise<
    { status: 'present'; bytes: Buffer } | { status: 'missing' } | { status: 'too_large' }
  > {
    const bytes = this.objects.get(objectPath)
    const result = !bytes
      ? ({ status: 'missing' } as const)
      : bytes.length > maxBytes
        ? ({ status: 'too_large' } as const)
        : ({ status: 'present', bytes: Buffer.from(bytes) } as const)
    const hook = this.afterNextDownload
    this.afterNextDownload = null
    hook?.()
    return Promise.resolve(result)
  }

  download(objectPath: string): Promise<Buffer> {
    const bytes = this.objects.get(objectPath)
    if (!bytes) {
      return Promise.reject(new Error(`OBJECT_NOT_FOUND:${objectPath}`))
    }
    return Promise.resolve(bytes)
  }

  remove(objectPaths: string[]): Promise<void> {
    if (this.failNextRemove) {
      this.failNextRemove = false
      return Promise.reject(new Error('storage unavailable'))
    }
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
    return httpTestUrl(app)
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

  /**
   * A `processing` selfie profile with real bytes in the storage double, at the member's own
   * final key for its session (round 3: the worker compares the exact object id).
   */
  async function arrangeProcessingSelfie(
    outcome: 'ready' | 'no_face'
  ): Promise<{ profileId: string; objectPath: string; sessionId: string }> {
    const sessionId = randomUUID()
    const objectPath = `wardrobe/${userId}/palette/${sessionId}.png`
    const profile = await prisma.paletteProfile.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        consent_granted_at: new Date(),
        source: 'selfie',
        status: 'processing',
        selfie_object_path: objectPath,
        selfie_upload_session_id: sessionId,
        analysis_attempt_id: sessionId,
      },
      update: {
        consent_granted_at: new Date(),
        consent_revoked_at: null,
        source: 'selfie',
        status: 'processing',
        failure_reason: null,
        selfie_object_path: objectPath,
        selfie_upload_session_id: sessionId,
        analysis_attempt_id: sessionId,
        selfie_purged_at: null,
      },
    })
    await storage.upload(objectPath, buildFixturePaletteSelfie(outcome))
    return { profileId: profile.id, objectPath, sessionId }
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
      // Story 6.7b: a sponsorship link holds its offer with ON DELETE RESTRICT.
      await prisma.communityPostSponsorship.deleteMany({
        where: { offer: { partner_id: { in: staleIds } } },
      })
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
    await listenHttpApp(app)
  })

  beforeEach(async () => {
    featureFlags.getFeatureFlag.mockReset().mockResolvedValue(true)
    telemetry.captureEvent.mockReset().mockResolvedValue(undefined)
    processingQueue.enqueue.mockReset().mockResolvedValue(undefined)
    storage.objects.clear()
    storage.createdAt.clear()
    storage.published.clear()
    storage.removed.length = 0
    storage.afterNextDownload = null
    storage.failNextRemove = false
    storage.loseNextPublishAck = false
    storage.holdNextPublish = null
    storage.publishes.length = 0
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
      await prisma.communityPostSponsorship.deleteMany({
        where: { offer: { partner_id: partnerId } },
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

  it('5.4-INT-032 still resolves the current cards for a retired analysis_version', async (context) => {
    if (!requireSchema(context)) return

    /*
     * WHAT A RULES BUMP ACTUALLY DOES TO A STORED PALETTE, pinned against real
     * SQL because the belief that it empties the card list drove a deferred-work
     * entry and the original framing of `5.4-MOB-023` and `5.4-E2E-012`.
     *
     * It does not. `resolveRecommendations` keys off the stored `undertone` and
     * `depth` and reads the CURRENT `ADVISOR_RULES`; `analysis_version` is
     * written by the processor and never read back on this path. So a profile
     * stamped with a version this build has never shipped resolves the same six
     * cards a current one does.
     *
     * That is the right behaviour -- advice a build cannot resolve is worse
     * than advice from the newest table -- but it means the reader is shown a
     * derived palette from retired rules with nothing marking it as such, which
     * is the gap `commerce.premium.palette.staleVersion` closes on both
     * surfaces. The client is the only tier that can see the discrepancy,
     * because it is the only one holding both the stored version and the
     * constant.
     */
    expect((await setConsent(userId, true)).status).toBe(200)
    await prisma.paletteProfile.update({
      where: { user_id: userId },
      data: {
        source: 'selfie',
        status: 'ready',
        undertone: 'warm',
        depth: 'medium',
        confidence: 0.82,
        analyzed_at: new Date(),
        analysis_version: 'palette-advisor-v0-retired',
      },
    })

    const response = await getProfile(userId)
    expect(response.status).toBe(200)
    const data = (response.body as { data: PaletteAdvisorProfile }).data
    expect(data.analysis?.analysisVersion).toBe('palette-advisor-v0-retired')
    expect(data.recommendations.length).toBeGreaterThan(0)
    // Every card comes from THIS build's table, which is what makes the note on
    // the surfaces a statement about the palette rather than about the cards.
    const currentItemKeys = new Set(
      listAdvisorRuleEntries().map((entry) => entry.itemKey)
    )
    for (const card of data.recommendations) {
      expect(currentItemKeys, card.itemKey).toContain(card.itemKey)
    }
  })

  it('5.4-INT-011 purges the selfie and stamps selfie_purged_at on the ready branch', async (context) => {
    if (!requireSchema(context)) return

    // The member's own selfie path: the purge removes nothing a path column names otherwise.
    const { profileId, objectPath, sessionId } = await arrangeProcessingSelfie('ready')

    await buildProcessor().process(profileId, sessionId)

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

    // The member's own selfie path: the purge removes nothing a path column names otherwise.
    const { profileId, objectPath, sessionId } = await arrangeProcessingSelfie('no_face')

    await buildProcessor().process(profileId, sessionId)

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

    // The member's own selfie path: the purge removes nothing a path column names otherwise.
    const { profileId, objectPath, sessionId } = await arrangeProcessingSelfie('ready')

    // `markFailed` is called from the WORKER's catch block on the final attempt
    // and never enters `process()`. A purge written only inside `process()`
    // would leak every selfie whose analysis exhausts its retries.
    await buildProcessor().markFailed(profileId, 'timeout', sessionId)

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

  /**
   * 5.4-INT-029. `findPaletteProfileId` is what an advisor click's
   * `recommendation_id` is derived from, and it has to answer on CONSENT, not
   * on row existence. Decision 9 keeps the `PaletteProfile` row alive through a
   * revocation on purpose -- nulled scalars, `consent_revoked_at` stamped -- so
   * an existence-only lookup kept minting attributed advisor clicks for a user
   * who had erased their palette, and refused callers with
   * `PALETTE_CONSENT_REQUIRED_MESSAGE` while enforcing something else entirely.
   * Asserted against real SQL because the surviving row is the whole point.
   */
  it('5.4-INT-029 resolves the advisor recommendation id only while consent is current', async (context) => {
    if (!requireSchema(context)) return

    const repository = app?.get(CommerceRepository)

    // No profile at all: nothing to attribute.
    expect(await repository?.findPaletteProfileId(userId)).toBeNull()

    expect((await setConsent(userId, true)).status).toBe(200)
    const granted = await repository?.findPaletteProfileId(userId)
    const row = await prisma.paletteProfile.findUnique({ where: { user_id: userId } })
    expect(granted).toBe(row?.id)

    expect((await setConsent(userId, false)).status).toBe(200)
    // The row is still there, which is exactly why the check cannot be `!== null`.
    expect(
      await prisma.paletteProfile.findUnique({ where: { user_id: userId } })
    ).not.toBeNull()
    expect(await repository?.findPaletteProfileId(userId)).toBeNull()

    // Re-granting restores it, so this is a consent gate and not a one-way door.
    expect((await setConsent(userId, true)).status).toBe(200)
    expect(await repository?.findPaletteProfileId(userId)).toBe(row?.id)
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

  /**
   * Production follow-up 2026-11-19: selfie bytes no longer pass through the API, whose Vercel
   * Function refuses a body over about 4.5 MB. The client PUTs to the storage signed URL that
   * upload-url hands out, and commit verifies the stored object before enqueueing.
   */
  it('5.4-INT-038 uploads a selfie straight to storage and commits it after verifying the bytes', async (context) => {
    if (!requireSchema(context)) return

    // An adult member: the upload routes run the guardian participation check.
    await prisma.userProfile.create({
      data: { user_id: userId, birthdate: new Date('1990-01-01') },
    })
    expect((await setConsent(userId, true)).status).toBe(200)
    const bytes = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: { r: 210, g: 180, b: 160 },
      },
    })
      .png()
      .toBuffer()

    const allocation = await request(httpServer())
      .post(`${ROUTE}/selfie/upload-url`)
      .set({ authorization: tokenFor(userId), 'idempotency-key': randomUUID() })
      .send({
        fileSizeBytes: bytes.length,
        mimeType: 'image/png',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        widthPx: 300,
        heightPx: 300,
      })
    expect(allocation.status).toBe(201)
    const session = allocation.body as {
      data: { uploadSessionId: string; uploadUrl: string; uploadToken: string }
    }
    expect(session.data.uploadUrl).toMatch(
      /^https:\/\/storage\.test\/storage\/v1\/object\/upload\/sign\//
    )

    const commit = () =>
      request(httpServer())
        .post(`${ROUTE}/selfie/commit`)
        .set({ authorization: tokenFor(userId), 'idempotency-key': randomUUID() })
        .send({ uploadSessionId: session.data.uploadSessionId })

    // Before the bytes land, the session stays open for a retry.
    const early = await commit()
    expect(early.status).toBe(409)
    expect(JSON.stringify(early.body)).toContain('UPLOAD_BYTES_MISSING')
    expect(processingQueue.enqueue).not.toHaveBeenCalled()

    // The relay route is gone.
    const relay = await request(httpServer())
      .put(`${ROUTE}/selfie/uploads/${session.data.uploadSessionId}`)
      .set({
        authorization: tokenFor(userId),
        'content-type': 'image/png',
        'x-upload-token': session.data.uploadToken,
      })
      .send(bytes)
    expect(relay.status).toBe(404)

    await storage.clientPut(session.data.uploadUrl, bytes)
    const committed = await commit()

    expect(committed.status).toBe(201)
    const profile = await prisma.paletteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(profile.status).toBe('processing')
    // Round 4: the selfie's analysis attempt is its session, so its job id is unchanged.
    expect(processingQueue.enqueue).toHaveBeenCalledWith(
      profile.id,
      session.data.uploadSessionId
    )
    expect(profile.analysis_attempt_id).toBe(session.data.uploadSessionId)
    expect(profile.processing_job_enqueued_at).not.toBeNull()
    expect(profile.selfie_publish_attempt_id).toBeNull()
    // Round 3: the server published the verified bytes with its own metadata, then released
    // staging once the claim held.
    const finalPath = `wardrobe/${userId}/palette/${session.data.uploadSessionId}.png`
    expect(storage.objects.get(finalPath)).toEqual(bytes)
    expect(storage.published.get(finalPath)).toEqual({
      contentType: 'image/png',
      cacheControl: 'private, max-age=0',
    })
    expect(storage.removed).toEqual([
      `staging/${userId}/palette/${session.data.uploadSessionId}.png`,
    ])
    expect(
      await prisma.wardrobeObjectDeletion.count({ where: { object_path: finalPath } })
    ).toBe(0)
  })

  it('5.4-INT-039 rejects and removes a stored selfie that does not match its declaration', async (context) => {
    if (!requireSchema(context)) return

    // An adult member: the upload routes run the guardian participation check.
    await prisma.userProfile.create({
      data: { user_id: userId, birthdate: new Date('1990-01-01') },
    })
    expect((await setConsent(userId, true)).status).toBe(200)
    const bytes = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: { r: 210, g: 180, b: 160 },
      },
    })
      .png()
      .toBuffer()
    const allocation = await request(httpServer())
      .post(`${ROUTE}/selfie/upload-url`)
      .set({ authorization: tokenFor(userId), 'idempotency-key': randomUUID() })
      .send({
        fileSizeBytes: bytes.length,
        mimeType: 'image/png',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        widthPx: 300,
        heightPx: 300,
      })
    expect(allocation.status).toBe(201)
    const session = allocation.body as {
      data: { uploadSessionId: string; uploadUrl: string }
    }
    // Same size and PNG signature as declared, one byte changed: only the sha256 can catch it.
    const tampered = Buffer.from(bytes)
    tampered[tampered.length - 20] = (tampered[tampered.length - 20]! + 1) % 256
    await storage.clientPut(session.data.uploadUrl, tampered)
    const stagingKey = `staging/${userId}/palette/${session.data.uploadSessionId}.png`
    expect(storage.objects.has(stagingKey)).toBe(true)

    const committed = await request(httpServer())
      .post(`${ROUTE}/selfie/commit`)
      .set({ authorization: tokenFor(userId), 'idempotency-key': randomUUID() })
      .send({ uploadSessionId: session.data.uploadSessionId })

    expect(committed.status).toBe(400)
    expect(JSON.stringify(committed.body)).toContain('IMAGE_CHECKSUM_MISMATCH')
    expect(storage.removed).toEqual([stagingKey])
    expect(storage.objects.size).toBe(0)
    expect(processingQueue.enqueue).not.toHaveBeenCalled()
    // Review round 1, 2026-11-19 (Codex 3): the session ends, so a correction needs a fresh
    // allocation and a validator still running for this one finds no session to act on.
    const row = await prisma.paletteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(row.status).toBeNull()
    expect(row.selfie_upload_session_id).toBeNull()
    expect(row.selfie_object_path).toBeNull()
  })

  /**
   * Review round 1, 2026-11-19 (Codex 2): a signed URL keeps working for its 2-hour token after
   * the analysis purged the selfie. Signed URLs only ever name a staging key, so a late write
   * cannot put the purged photo back at the tracked path, and the hourly sweep removes it.
   */
  it('5.4-INT-040 keeps a late write after the selfie purge in staging until the sweep removes it', async (context) => {
    if (!requireSchema(context)) return

    await prisma.userProfile.create({
      data: { user_id: userId, birthdate: new Date('1990-01-01') },
    })
    expect((await setConsent(userId, true)).status).toBe(200)
    const bytes = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: { r: 210, g: 180, b: 160 },
      },
    })
      .png()
      .toBuffer()
    const allocation = await request(httpServer())
      .post(`${ROUTE}/selfie/upload-url`)
      .set({ authorization: tokenFor(userId), 'idempotency-key': randomUUID() })
      .send({
        fileSizeBytes: bytes.length,
        mimeType: 'image/png',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        widthPx: 300,
        heightPx: 300,
      })
    expect(allocation.status).toBe(201)
    const session = allocation.body as {
      data: { uploadSessionId: string; uploadUrl: string }
    }
    await storage.clientPut(session.data.uploadUrl, bytes)
    const committed = await request(httpServer())
      .post(`${ROUTE}/selfie/commit`)
      .set({ authorization: tokenFor(userId), 'idempotency-key': randomUUID() })
      .send({ uploadSessionId: session.data.uploadSessionId })
    expect(committed.status).toBe(201)
    const profile = await prisma.paletteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    const finalPath = profile.selfie_object_path!
    expect(storage.objects.get(finalPath)).toEqual(bytes)

    // The analysis terminates and purges the selfie.
    await buildProcessor().markFailed(profile.id, 'timeout', session.data.uploadSessionId)
    expect(storage.objects.has(finalPath)).toBe(false)

    // The session's URL still writes, the way a 2-hour storage token does: commit released the
    // staged object, so its key is empty again.
    await expect(storage.clientPut(session.data.uploadUrl, bytes)).resolves.toBe('stored')

    const lateKey = `staging/${userId}/palette/${session.data.uploadSessionId}.png`
    expect([...storage.objects.keys()]).toEqual([lateKey])
    expect(storage.objects.has(finalPath)).toBe(false)

    const retention = new WardrobeRetentionService(
      prisma,
      storage as unknown as SupabaseWardrobeStorageAdapter,
      { invalidateUserCache: () => Promise.resolve(true) }
    )
    await expect(retention.purgeStaleStagedUploads(new Date())).resolves.toBe(0)
    await expect(
      retention.purgeStaleStagedUploads(
        new Date(Date.now() + STAGED_UPLOAD_RETENTION_MS + 1000)
      )
    ).resolves.toBe(1)
    expect(storage.objects.size).toBe(0)
    expect(storage.removed).toContain(lateKey)
  })

  /** An adult, consenting member with an allocated selfie session for `bytes`. */
  async function allocateSelfie(
    bytes: Buffer
  ): Promise<{ uploadSessionId: string; uploadUrl: string }> {
    await prisma.userProfile.create({
      data: { user_id: userId, birthdate: new Date('1990-01-01') },
    })
    expect((await setConsent(userId, true)).status).toBe(200)
    const allocation = await request(httpServer())
      .post(`${ROUTE}/selfie/upload-url`)
      .set({ authorization: tokenFor(userId), 'idempotency-key': randomUUID() })
      .send({
        fileSizeBytes: bytes.length,
        mimeType: 'image/png',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        widthPx: 300,
        heightPx: 300,
      })
    expect(allocation.status).toBe(201)
    return (allocation.body as { data: { uploadSessionId: string; uploadUrl: string } })
      .data
  }

  /**
   * A due deletion that belongs to no row of this suite: another suite's or a developer's. A
   * scoped drain must leave it recorded and never ask storage to remove it.
   */
  async function recordForeignDueDeletion(): Promise<string> {
    const objectPath = `staging/foreign-${randomUUID().slice(0, 8)}/garment/${randomUUID()}.png`
    await prisma.wardrobeObjectDeletion.create({
      data: {
        object_path: objectPath,
        reason: 'staging_swept',
        not_before: new Date(Date.now() - 60_000),
      },
    })
    return objectPath
  }

  async function expectForeignDeletionUntouched(objectPath: string): Promise<void> {
    const row = await prisma.wardrobeObjectDeletion.findUnique({
      where: { object_path: objectPath },
    })
    expect(row?.attempts).toBe(0)
    expect(storage.removed).not.toContain(objectPath)
    await prisma.wardrobeObjectDeletion.delete({ where: { object_path: objectPath } })
  }

  async function selfieBytes(red: number): Promise<Buffer> {
    return sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: { r: red, g: 180, b: 160 },
      },
    })
      .png()
      .toBuffer()
  }

  /**
   * Review round 2 (Codex C2-1): a newer staged generation that lands between verification and
   * publication must never reach the final key. The server publishes the verified buffer itself,
   * and since round 4 (Codex C3-3) the staged key refuses the second write outright.
   */
  it('5.4-INT-041 publishes exactly the verified bytes when a write overlaps verification', async (context) => {
    if (!requireSchema(context)) return

    const bytes = await selfieBytes(210)
    const newer = await selfieBytes(20)
    const session = await allocateSelfie(bytes)
    await storage.clientPut(session.uploadUrl, bytes)
    // The overlapping write arrives right after commit read and verified the staged object.
    let overlapping: Promise<'stored' | 'duplicate'> | null = null
    storage.afterNextDownload = () => {
      overlapping = storage.clientPut(session.uploadUrl, newer)
    }

    const committed = await request(httpServer())
      .post(`${ROUTE}/selfie/commit`)
      .set({ authorization: tokenFor(userId), 'idempotency-key': randomUUID() })
      .send({ uploadSessionId: session.uploadSessionId })

    expect(committed.status).toBe(201)
    await expect(overlapping).resolves.toBe('duplicate')
    const finalPath = `wardrobe/${userId}/palette/${session.uploadSessionId}.png`
    expect(storage.objects.get(finalPath)).toEqual(bytes)
    expect(storage.objects.get(finalPath)).not.toEqual(newer)
  })

  /**
   * Review round 2 (Codex C2-4): a transient storage failure during erasure leaves the deletion
   * recorded in the database, and the hourly drain removes the selfie later.
   */
  it('5.4-INT-042 keeps an erased selfie recorded until the hourly drain removes it', async (context) => {
    if (!requireSchema(context)) return

    const bytes = await selfieBytes(210)
    const session = await allocateSelfie(bytes)
    await storage.clientPut(session.uploadUrl, bytes)
    const committed = await request(httpServer())
      .post(`${ROUTE}/selfie/commit`)
      .set({ authorization: tokenFor(userId), 'idempotency-key': randomUUID() })
      .send({ uploadSessionId: session.uploadSessionId })
    expect(committed.status).toBe(201)
    const finalPath = `wardrobe/${userId}/palette/${session.uploadSessionId}.png`
    expect(storage.objects.has(finalPath)).toBe(true)

    storage.failNextRemove = true
    expect((await eraseProfile(userId)).status).toBe(200)

    expect(storage.objects.has(finalPath)).toBe(true)
    const pending = await prisma.wardrobeObjectDeletion.findUniqueOrThrow({
      where: { object_path: finalPath },
    })
    expect(pending.reason).toBe('selfie_erased')
    expect(pending.attempts).toBe(1)
    expect(pending.not_before.getTime()).toBeGreaterThan(Date.now())

    // The hourly maintenance job's retry, scoped to this test's own keys: the database is
    // shared, and a due row another suite or a developer left must never be settled here.
    const decoy = await recordForeignDueDeletion()
    const outbox = new WardrobeObjectDeletionOutbox(prisma, storage)
    const ownKeys = { objectPaths: [finalPath] }
    await outbox.drainDue(new Date(), ownKeys)
    // Not due yet: the backoff holds the retry.
    expect(storage.objects.has(finalPath)).toBe(true)

    await prisma.wardrobeObjectDeletion.update({
      where: { object_path: finalPath },
      data: { not_before: new Date(Date.now() - 1000) },
    })
    await outbox.drainDue(new Date(), ownKeys)

    expect(storage.objects.has(finalPath)).toBe(false)
    await expectForeignDeletionUntouched(decoy)
    // Round 6 (Codex C5-2): the commit's claim recorded a cleanup horizon that outlives its
    // success, so the removal stays recorded and repeats until then; past it, the row settles.
    const repeating = await prisma.wardrobeObjectDeletion.findUniqueOrThrow({
      where: { object_path: finalPath },
    })
    expect(repeating.repeat_until?.getTime()).toBeGreaterThan(Date.now())
    await prisma.wardrobeObjectDeletion.update({
      where: { object_path: finalPath },
      data: {
        not_before: new Date(Date.now() - 1000),
        repeat_until: new Date(Date.now() - 1000),
      },
    })
    await outbox.drainDue(new Date(), ownKeys)
    expect(
      await prisma.wardrobeObjectDeletion.count({ where: { object_path: finalPath } })
    ).toBe(0)
  })

  /** A selfie commit of `session` under `idempotencyKey`. */
  function commitSelfie(uploadSessionId: string, idempotencyKey: string) {
    return request(httpServer())
      .post(`${ROUTE}/selfie/commit`)
      .set({ authorization: tokenFor(userId), 'idempotency-key': idempotencyKey })
      .send({ uploadSessionId })
  }

  /**
   * Round 4 (Codex C3-1): a commit owns its session's publication before any storage I/O. A
   * second commit of the session that arrives while the first is publishing answers 409
   * UPLOAD_IN_PROGRESS and touches no storage, and the first finishes normally.
   */
  it('5.4-INT-043 answers UPLOAD_IN_PROGRESS to a second commit while the first is publishing', async (context) => {
    if (!requireSchema(context)) return

    const bytes = await selfieBytes(210)
    const session = await allocateSelfie(bytes)
    await storage.clientPut(session.uploadUrl, bytes)
    let release: () => void = () => undefined
    storage.holdPublishUntil(
      new Promise<void>((resolve) => {
        release = resolve
      })
    )

    const first = commitSelfie(session.uploadSessionId, randomUUID()).then((r) => r)
    await storage.publishHeld
    const second = await commitSelfie(session.uploadSessionId, randomUUID())

    expect(second.status).toBe(409)
    expect(JSON.stringify(second.body)).toContain('UPLOAD_IN_PROGRESS')
    release()
    expect((await first).status).toBe(201)
    const finalPath = `wardrobe/${userId}/palette/${session.uploadSessionId}.png`
    expect(storage.publishes).toEqual([finalPath])
    expect(processingQueue.enqueue).toHaveBeenCalledOnce()
  })

  /**
   * Round 4 (Codex C3-1, "a duplicate finishing after automatic purge"): the same-key commit a
   * client sends again after the analysis finished and purged the selfie replays that outcome.
   * It never writes the final key, so the purged photo stays gone.
   */
  it('5.4-INT-044 replays a same-key commit after the purge without restoring the selfie', async (context) => {
    if (!requireSchema(context)) return

    const bytes = await selfieBytes(210)
    const session = await allocateSelfie(bytes)
    await storage.clientPut(session.uploadUrl, bytes)
    const key = randomUUID()
    expect((await commitSelfie(session.uploadSessionId, key)).status).toBe(201)
    const profile = await prisma.paletteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    await buildProcessor().markFailed(profile.id, 'timeout', session.uploadSessionId)
    const finalPath = `wardrobe/${userId}/palette/${session.uploadSessionId}.png`
    expect(storage.objects.has(finalPath)).toBe(false)

    const duplicate = await commitSelfie(session.uploadSessionId, key)

    expect(duplicate.status).toBe(200)
    expect(storage.publishes).toEqual([finalPath])
    expect(storage.objects.has(finalPath)).toBe(false)
  })

  /**
   * Round 5 (Codex C4-5, "an outstanding publish finishing after erasure with a lost response"):
   * storage applied the publish but the API never heard back, so the commit ended with the claim
   * held and nothing compensated. Erasure removes the published selfie and its staging key at
   * once, and records a removal that repeats every 15 minutes until 24 hours after the claim
   * started: a write storage completes later still is removed whenever it lands, and the row
   * settles only after the horizon. Round 4 left the selfie readable until the lease ended and
   * settled after one removal.
   */
  it('5.4-INT-045 removes a published selfie at erasure and a later landing write on the next repeat, settling after the horizon', async (context) => {
    if (!requireSchema(context)) return

    const bytes = await selfieBytes(210)
    const session = await allocateSelfie(bytes)
    await storage.clientPut(session.uploadUrl, bytes)
    storage.loseNextPublishAck = true

    const lost = await commitSelfie(session.uploadSessionId, randomUUID())
    expect(lost.status).toBeGreaterThanOrEqual(500)
    const finalPath = `wardrobe/${userId}/palette/${session.uploadSessionId}.png`
    const stagingPath = `staging/${userId}/palette/${session.uploadSessionId}.png`
    expect(storage.objects.has(finalPath)).toBe(true)
    const claimed = await prisma.paletteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(claimed.selfie_publish_attempt_id).not.toBeNull()

    const erasedAt = Date.now()
    expect((await eraseProfile(userId)).status).toBe(200)

    // The current generation is gone at once.
    expect(storage.objects.has(finalPath)).toBe(false)
    expect(storage.objects.has(stagingPath)).toBe(false)
    const horizon =
      claimed.selfie_publish_started_at!.getTime() + AMBIGUOUS_PUBLICATION_HORIZON_MS
    const repeating = await prisma.wardrobeObjectDeletion.findMany({
      where: { object_path: { in: [finalPath, stagingPath] } },
      orderBy: { object_path: 'asc' },
    })
    expect(
      repeating.map((row) => [row.object_path, row.repeat_until?.getTime()])
    ).toEqual([
      [stagingPath, horizon],
      [finalPath, horizon],
    ])
    for (const row of repeating) {
      expect(row.not_before.getTime()).toBeGreaterThanOrEqual(
        erasedAt + REPEATING_REMOVAL_INTERVAL_MS
      )
    }

    // Storage completes the received write after the lease: the photo lands again.
    storage.objects.set(finalPath, bytes)
    const decoy = await recordForeignDueDeletion()
    const outbox = new WardrobeObjectDeletionOutbox(prisma, storage)
    const ownKeys = { objectPaths: [finalPath, stagingPath] }
    // The next repeat comes due: brought forward here, the way the clock would bring it. The
    // drain is scoped to this test's keys, so other suites' rows stay as they are.
    await prisma.wardrobeObjectDeletion.updateMany({
      where: { object_path: { in: [finalPath, stagingPath] } },
      data: { not_before: new Date(Date.now() - 1000) },
    })
    await outbox.drainDue(new Date(), ownKeys)
    expect(storage.objects.has(finalPath)).toBe(false)
    expect(
      await prisma.wardrobeObjectDeletion.count({
        where: { object_path: { in: [finalPath, stagingPath] } },
      })
    ).toBe(2)

    // Past the horizon, the next removal settles both rows.
    await prisma.wardrobeObjectDeletion.updateMany({
      where: { object_path: { in: [finalPath, stagingPath] } },
      data: {
        not_before: new Date(Date.now() - 1000),
        repeat_until: new Date(Date.now() - 1000),
      },
    })
    await outbox.drainDue(new Date(), ownKeys)
    await expectForeignDeletionUntouched(decoy)

    expect(storage.objects.has(finalPath)).toBe(false)
    expect(
      await prisma.wardrobeObjectDeletion.count({
        where: { object_path: { in: [finalPath, stagingPath] } },
      })
    ).toBe(0)
  })

  /**
   * Coordinator follow-up 2 (round 4): a commit's publication claim is a row update. While the
   * claiming transaction still holds the row lock, an erasure on another connection must wait on
   * its `FOR UPDATE`; once the claim commits, the erasure sees it, removes the selfie's keys at
   * once and records them as a removal that repeats until 24 hours after the claim started
   * (round 5, Codex C4-5).
   */
  it('5.4-INT-046 makes an erasure wait for a commit holding the claim and the row lock, then removes its keys and repeats the removal', async (context) => {
    if (!requireSchema(context)) return

    const bytes = await selfieBytes(212)
    const session = await allocateSelfie(bytes)
    const finalPath = `wardrobe/${userId}/palette/${session.uploadSessionId}.png`
    const stagingPath = `staging/${userId}/palette/${session.uploadSessionId}.png`
    const ownKeys = [finalPath, stagingPath]

    const claimStartedAt = new Date()
    let markHeld: () => void = () => undefined
    let releaseClaim: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      markHeld = resolve
    })
    const released = new Promise<void>((resolve) => {
      releaseClaim = resolve
    })
    const claim = prisma.$transaction(
      async (tx) => {
        const claimed = await tx.paletteProfile.updateMany({
          where: {
            user_id: userId,
            selfie_upload_session_id: session.uploadSessionId,
            status: 'pending_upload',
          },
          data: {
            selfie_publish_attempt_id: randomUUID(),
            selfie_publish_started_at: claimStartedAt,
          },
        })
        expect(claimed.count).toBe(1)
        // Holds the transaction, and with it the row lock, until the test releases it.
        markHeld()
        await released
      },
      { timeout: 20_000 }
    )
    await held

    // `then` sends the request now; supertest waits for the first `then` before it sends.
    const erased = eraseProfile(userId).then((response) => response)
    await waitForRowLockWait('PaletteProfile')
    // Still waiting: nothing is recorded or removed while the claim's transaction is open.
    expect(
      await prisma.wardrobeObjectDeletion.count({
        where: { object_path: { in: ownKeys } },
      })
    ).toBe(0)

    releaseClaim()
    await claim
    expect((await erased).status).toBe(200)

    const horizon = claimStartedAt.getTime() + AMBIGUOUS_PUBLICATION_HORIZON_MS
    const repeating = await prisma.wardrobeObjectDeletion.findMany({
      where: { object_path: { in: ownKeys } },
      orderBy: { object_path: 'asc' },
    })
    expect(
      repeating.map((row) => [row.object_path, row.repeat_until?.getTime()])
    ).toEqual([
      [stagingPath, horizon],
      [finalPath, horizon],
    ])
    expect(storage.removed).toContain(finalPath)
    expect(storage.removed).toContain(stagingPath)
    await prisma.wardrobeObjectDeletion.deleteMany({
      where: { object_path: { in: ownKeys } },
    })
  }, 20_000)

  /** Holds the next feature check (analyze's) open until the test releases it. */
  function holdNextFeatureCheck(): { entered: Promise<void>; release: () => void } {
    let markEntered: () => void = () => undefined
    let release: () => void = () => undefined
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    featureFlags.getFeatureFlag.mockImplementationOnce(async () => {
      markEntered()
      await released
      return true
    })
    return { entered, release }
  }

  const analyzeWardrobe = (id: string) =>
    request(httpServer())
      .post(`${ROUTE}/analyze`)
      .set({ authorization: tokenFor(id) })
      .send({ source: 'wardrobe' })

  /**
   * Round 5 (Codex C4-3): a wardrobe analysis read consent and status, awaited the feature
   * check, then updated by user id alone, so an erasure that finished during the check got an
   * analysis started on its revoked profile. The analysis now claims under the member lock
   * erasure takes and rechecks consent there.
   */
  it('5.4-INT-047 starts no wardrobe analysis when an erasure finished during its feature check', async (context) => {
    if (!requireSchema(context)) return

    await prisma.userProfile.create({
      data: { user_id: userId, birthdate: new Date('1990-01-01') },
    })
    expect((await setConsent(userId, true)).status).toBe(200)
    const check = holdNextFeatureCheck()
    const analyzing = analyzeWardrobe(userId).then((response) => response)
    await check.entered

    expect((await eraseProfile(userId)).status).toBe(200)
    check.release()

    const response = await analyzing
    expect(response.status).toBe(403)
    expect(JSON.stringify(response.body)).toContain(PALETTE_CONSENT_REQUIRED_MESSAGE)
    const profile = await prisma.paletteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(profile).toMatchObject({
      status: null,
      source: null,
      analysis_attempt_id: null,
    })
    expect(profile.consent_revoked_at).not.toBeNull()
    expect(processingQueue.enqueue).not.toHaveBeenCalled()
  })

  /**
   * Round 5 (Codex C4-3): a selfie commit that reached processing during the analysis's feature
   * check owns the profile; the analysis answers in progress and leaves it alone.
   */
  it('5.4-INT-048 leaves a selfie commit that reached processing during the feature check alone', async (context) => {
    if (!requireSchema(context)) return

    const bytes = await selfieBytes(214)
    const session = await allocateSelfie(bytes)
    await storage.clientPut(session.uploadUrl, bytes)
    const check = holdNextFeatureCheck()
    const analyzing = analyzeWardrobe(userId).then((response) => response)
    await check.entered

    expect((await commitSelfie(session.uploadSessionId, randomUUID())).status).toBe(201)
    check.release()

    const response = await analyzing
    expect(response.status).toBe(409)
    const profile = await prisma.paletteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(profile).toMatchObject({
      status: 'processing',
      source: 'selfie',
      analysis_attempt_id: session.uploadSessionId,
      selfie_upload_session_id: session.uploadSessionId,
    })
    expect(processingQueue.enqueue).toHaveBeenCalledExactlyOnceWith(
      profile.id,
      session.uploadSessionId
    )
  })

  /**
   * Round 5 (Codex C4-3, C4-5): an analysis that supersedes a pending selfie whose publication
   * is in flight clears that session and removes its keys under the selfie's own identity,
   * repeating the removal until the horizon, so the superseded publish never leaves a selfie.
   */
  it('5.4-INT-049 supersedes a selfie mid-publication and removes the late publish', async (context) => {
    if (!requireSchema(context)) return

    const bytes = await selfieBytes(216)
    const session = await allocateSelfie(bytes)
    await storage.clientPut(session.uploadUrl, bytes)
    const finalPath = `wardrobe/${userId}/palette/${session.uploadSessionId}.png`
    const stagingPath = `staging/${userId}/palette/${session.uploadSessionId}.png`
    let landPublish: () => void = () => undefined
    storage.holdPublishUntil(
      new Promise<void>((resolve) => {
        landPublish = resolve
      })
    )

    const commit = commitSelfie(session.uploadSessionId, randomUUID()).then((r) => r)
    await storage.publishHeld
    const analysis = await analyzeWardrobe(userId)
    landPublish()
    expect(analysis.status).toBe(202)

    expect((await commit).status).toBe(409)
    const profile = await prisma.paletteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(profile).toMatchObject({
      status: 'processing',
      source: 'wardrobe',
      selfie_upload_session_id: null,
      selfie_object_path: null,
    })
    expect(storage.objects.has(finalPath)).toBe(false)
    expect(storage.objects.has(stagingPath)).toBe(false)
    const repeating = await prisma.wardrobeObjectDeletion.findMany({
      where: { object_path: { in: [finalPath, stagingPath] } },
    })
    expect(repeating.map((row) => row.reason)).toEqual([
      'selfie_superseded',
      'selfie_superseded',
    ])
    expect(repeating.every((row) => row.repeat_until !== null)).toBe(true)
    await prisma.wardrobeObjectDeletion.deleteMany({
      where: { object_path: { in: [finalPath, stagingPath] } },
    })
  })

  /**
   * Round 6 (Codex C5-2, first ordering): a publication's ownership lease is 325 seconds, but a
   * write that attempt started can land later. Each claim records its cleanup horizon (claim
   * start plus 24 hours), and the horizon outlives the lease: an erasure at minute six still
   * repeats the removal until it, so a write landing at minute seven is removed. Round 5 found
   * no horizon once the lease ran out, settled the only obligation after one removal, and the
   * late write restored the erased selfie.
   */
  it('5.4-INT-050 keeps removing an erased selfie until the recorded horizon after the claim lease ran out', async (context) => {
    if (!requireSchema(context)) return

    const bytes = await selfieBytes(218)
    const session = await allocateSelfie(bytes)
    await storage.clientPut(session.uploadUrl, bytes)
    storage.loseNextPublishAck = true
    expect(
      (await commitSelfie(session.uploadSessionId, randomUUID())).status
    ).toBeGreaterThanOrEqual(500)
    const finalPath = `wardrobe/${userId}/palette/${session.uploadSessionId}.png`
    const stagingPath = `staging/${userId}/palette/${session.uploadSessionId}.png`
    const claimed = await prisma.paletteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    const horizon =
      claimed.selfie_publish_started_at!.getTime() + AMBIGUOUS_PUBLICATION_HORIZON_MS
    expect(claimed.selfie_publish_cleanup_until?.getTime()).toBe(horizon)

    // Minute six: the lease has run out (moved back here, the way the clock would move it).
    const leaseExpiredStart = new Date(Date.now() - PUBLISH_CLAIM_LEASE_MS - 60_000)
    await prisma.paletteProfile.update({
      where: { user_id: userId },
      data: { selfie_publish_started_at: leaseExpiredStart },
    })
    expect((await eraseProfile(userId)).status).toBe(200)
    expect(storage.objects.has(finalPath)).toBe(false)
    const recorded = await prisma.wardrobeObjectDeletion.findMany({
      where: { object_path: { in: [finalPath, stagingPath] } },
      orderBy: { object_path: 'asc' },
    })
    expect(recorded.map((row) => [row.object_path, row.repeat_until?.getTime()])).toEqual(
      [
        [stagingPath, horizon],
        [finalPath, horizon],
      ]
    )

    // Minute seven: the write the first attempt started lands; the next repeat removes it.
    storage.objects.set(finalPath, bytes)
    await prisma.wardrobeObjectDeletion.updateMany({
      where: { object_path: { in: [finalPath, stagingPath] } },
      data: { not_before: new Date(Date.now() - 1000) },
    })
    const outbox = new WardrobeObjectDeletionOutbox(prisma, storage)
    await outbox.drainDue(new Date(), { objectPaths: [finalPath, stagingPath] })
    expect(storage.objects.has(finalPath)).toBe(false)
    await prisma.wardrobeObjectDeletion.deleteMany({
      where: { object_path: { in: [finalPath, stagingPath] } },
    })
  })

  /**
   * Round 6 (Codex C5-2, second ordering): a retry takes over the stale claim, succeeds and
   * clears its claim, and the analysis then purges the selfie. The first attempt's write can
   * still land on the same final key. The horizon every claim recorded survives the takeover
   * and the success (only ever moved later), and the processor's terminal removal repeats until
   * it. Round 5 recorded a one-time removal there, and the late write left the selfie readable.
   */
  it('5.4-INT-051 repeats the analysis purge until the horizon after a takeover and a successful retry', async (context) => {
    if (!requireSchema(context)) return

    const bytes = await selfieBytes(219)
    const session = await allocateSelfie(bytes)
    await storage.clientPut(session.uploadUrl, bytes)
    storage.loseNextPublishAck = true
    const commitKey = randomUUID()
    expect(
      (await commitSelfie(session.uploadSessionId, commitKey)).status
    ).toBeGreaterThanOrEqual(500)
    const finalPath = `wardrobe/${userId}/palette/${session.uploadSessionId}.png`
    const first = await prisma.paletteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    const firstHorizon = first.selfie_publish_cleanup_until!.getTime()

    // The first attempt's lease runs out; the retry takes the claim over and succeeds.
    await prisma.paletteProfile.update({
      where: { user_id: userId },
      data: {
        selfie_publish_started_at: new Date(Date.now() - PUBLISH_CLAIM_LEASE_MS - 60_000),
      },
    })
    expect((await commitSelfie(session.uploadSessionId, commitKey)).status).toBe(201)
    const committed = await prisma.paletteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(committed).toMatchObject({
      status: 'processing',
      selfie_publish_attempt_id: null,
      selfie_publish_started_at: null,
    })
    // The takeover moved the horizon later, never earlier, and success kept it.
    const horizon = committed.selfie_publish_cleanup_until!.getTime()
    expect(horizon).toBeGreaterThanOrEqual(firstHorizon)

    await buildProcessor().process(committed.id, session.uploadSessionId)
    expect(storage.objects.has(finalPath)).toBe(false)
    const purge = await prisma.wardrobeObjectDeletion.findUniqueOrThrow({
      where: { object_path: finalPath },
    })
    expect(purge.reason).toBe('selfie_purged')
    expect(purge.repeat_until?.getTime()).toBe(horizon)

    // The first attempt's write lands after the purge; the next repeat removes it.
    storage.objects.set(finalPath, bytes)
    await prisma.wardrobeObjectDeletion.update({
      where: { object_path: finalPath },
      data: { not_before: new Date(Date.now() - 1000) },
    })
    const outbox = new WardrobeObjectDeletionOutbox(prisma, storage)
    await outbox.drainDue(new Date(), { objectPaths: [finalPath] })
    expect(storage.objects.has(finalPath)).toBe(false)
    expect(
      await prisma.wardrobeObjectDeletion.count({ where: { object_path: finalPath } })
    ).toBe(1)
    await prisma.wardrobeObjectDeletion.deleteMany({ where: { object_path: finalPath } })
  })
})

/**
 * Resolves once a backend is blocked on a row lock of `table` taken with `FOR UPDATE`, as
 * Postgres itself reports it; a bounded poll on that condition, never a fixed sleep.
 */
async function waitForRowLockWait(table: string): Promise<void> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const waiting = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND query LIKE ${`%"${table}"%FOR UPDATE%`}`
    if (Number(waiting[0]?.count ?? 0) > 0) return
    if (Date.now() > deadline) throw new Error(`no backend waited on a ${table} row lock`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
