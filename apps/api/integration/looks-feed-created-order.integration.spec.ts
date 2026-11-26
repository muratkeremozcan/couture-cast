// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-INT-001..005 and 7.12-INT-010. The Looks tab pages saved
// looks and capsules with `sort=created_desc` and merges them in `@couture/utils` looks-feed,
// which is only correct if both lists order `created_at desc, id asc` across pages. Without the
// param each list keeps its old order. The P11 indexes must serve the new order. A saved look
// that is gone or belongs to someone else reads the same (TEA P6).
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { NotFoundException } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  listOutfitCapsulesQuerySchema,
  listSavedLooksQuerySchema,
} from '@couture/api-client/contracts/http'
import type { RequestAuthContext } from '../src/modules/auth/security.types.js'
import { WardrobeCapsuleRepository } from '../src/modules/wardrobe/wardrobe-capsule.repository.js'
import { WardrobeSavedLookService } from '../src/modules/wardrobe/wardrobe-saved-look.service.js'
import { deleteMembers } from './helpers/privacy-guards.js'

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT created_at FROM "SavedLook" LIMIT 1`
    await prisma.$queryRaw`SELECT created_at FROM "OutfitCapsule" LIMIT 1`
    schemaReady = true
  } catch {
    schemaReady = false
    console.warn(
      '[looks-feed-created-order] Skipped: PostgreSQL is missing the saved look or capsule ' +
        'schema. Run `npm run db:migrate` to execute this suite.'
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

const BASE = Date.parse('2026-11-01T12:00:00.000Z')
const at = (minutes: number) => new Date(BASE + minutes * 60_000)

/** Catalog slots only: the list reads no storage and no garments. */
const CATALOG_COMPOSITION = [
  { slotIndex: 0, category: 'top', kind: 'catalog', itemId: 'merino-sweater' },
]

const consent = { canTeenAccess: () => Promise.resolve(true) }
const storage = {
  createSignedReadUrl: () =>
    Promise.reject(new Error('catalog-only looks must not sign a garment photo')),
}

describe('7.12 Looks feed created order against real PostgreSQL', () => {
  const namespace = `looks-feed-${randomUUID().slice(0, 8)}`
  let ownerId: string
  let otherId: string
  let owner: RequestAuthContext
  let service: WardrobeSavedLookService
  let capsules: WardrobeCapsuleRepository
  /** Saved look ids by label, for readable expectations. */
  const looks = new Map<string, string>()
  const capsuleIds = new Map<string, string>()

  async function seedLook(
    label: string,
    options: {
      userId?: string
      createdAt: Date
      updatedAt: Date
      source?: 'home_sample' | 'style_piece'
      deletedAt?: Date
      id?: string
    }
  ): Promise<string> {
    const row = await prisma.savedLook.create({
      data: {
        ...(options.id ? { id: options.id } : {}),
        user_id: options.userId ?? ownerId,
        source: options.source ?? 'home_sample',
        look_id: `sample-${label}`,
        weather: 'mild',
        title: `Look ${label}`,
        composition: CATALOG_COMPOSITION,
        swaps: {},
        created_at: options.createdAt,
        updated_at: options.updatedAt,
        deleted_at: options.deletedAt ?? null,
      },
    })
    return row.id
  }

  async function seedCapsule(
    label: string,
    options: { createdAt: Date; updatedAt: Date; favorite?: boolean; id?: string }
  ): Promise<string> {
    const row = await prisma.outfitCapsule.create({
      data: {
        ...(options.id ? { id: options.id } : {}),
        user_id: ownerId,
        name: `Capsule ${label}`,
        occasions: ['casual'],
        is_favorite: options.favorite ?? false,
        revision: 1,
        created_at: options.createdAt,
        updated_at: options.updatedAt,
      },
    })
    return row.id
  }

  beforeAll(async () => {
    await probeSchema()
    if (!schemaReady) return

    ownerId = (
      await prisma.user.create({ data: { email: `${namespace}-owner@synthetic.test` } })
    ).id
    otherId = (
      await prisma.user.create({ data: { email: `${namespace}-other@synthetic.test` } })
    ).id
    owner = {
      token: 'integration',
      userId: ownerId,
      role: 'guardian',
    }
    service = new WardrobeSavedLookService(prisma, storage as never, consent as never)
    capsules = new WardrobeCapsuleRepository(prisma)

    // created order: a (oldest) ... e (newest); updated order is the reverse, so the two sorts
    // disagree on every position and a fallback to the old order cannot pass.
    // `tie-1` and `tie-2` share created_at with explicit ids so id asc decides between them.
    looks.set('a', await seedLook('a', { createdAt: at(1), updatedAt: at(50) }))
    looks.set(
      'b',
      await seedLook('b', { createdAt: at(2), updatedAt: at(40), source: 'style_piece' })
    )
    looks.set(
      'tie-2',
      await seedLook('tie-2', {
        id: `${namespace}-tie-2`,
        createdAt: at(3),
        updatedAt: at(30),
      })
    )
    looks.set(
      'tie-1',
      await seedLook('tie-1', {
        id: `${namespace}-tie-1`,
        createdAt: at(3),
        updatedAt: at(20),
      })
    )
    looks.set('e', await seedLook('e', { createdAt: at(5), updatedAt: at(10) }))
    // Never listed: removed, and another member's.
    looks.set(
      'removed',
      await seedLook('removed', { createdAt: at(9), updatedAt: at(9), deletedAt: at(9) })
    )
    looks.set(
      'foreign',
      await seedLook('foreign', { userId: otherId, createdAt: at(8), updatedAt: at(8) })
    )

    capsuleIds.set(
      'c1',
      await seedCapsule('c1', { createdAt: at(1), updatedAt: at(30), favorite: true })
    )
    capsuleIds.set(
      'c-tie-2',
      await seedCapsule('c-tie-2', {
        id: `${namespace}-c-tie-2`,
        createdAt: at(2),
        updatedAt: at(20),
      })
    )
    capsuleIds.set(
      'c-tie-1',
      await seedCapsule('c-tie-1', {
        id: `${namespace}-c-tie-1`,
        createdAt: at(2),
        updatedAt: at(10),
      })
    )
  })

  afterAll(async () => {
    if (schemaReady) {
      await prisma.savedLook.deleteMany({
        where: { user: { email: { contains: namespace } } },
      })
      await prisma.outfitCapsule.deleteMany({
        where: { user: { email: { contains: namespace } } },
      })
      await deleteMembers(prisma, { email: { contains: namespace } })
    }
    await prisma.$disconnect()
  })

  const idsOf = (map: Map<string, string>, labels: string[]) =>
    labels.map((label) => map.get(label)!)

  async function pagedLooks(
    query: Record<string, unknown>,
    limit: number
  ): Promise<string[]> {
    const seen: string[] = []
    for (let offset = 0; offset < 50; offset += limit) {
      const page = await service.listSavedLooks(
        owner,
        listSavedLooksQuerySchema.parse({ ...query, limit, offset })
      )
      seen.push(...page.data.map((look) => look.id))
      if (offset + limit >= page.total) break
    }
    return seen
  }

  it('7.12-INT-001 pages saved looks created_at desc, id asc across pages', async (context) => {
    if (!requireSchema(context)) return

    const ids = await pagedLooks({ sort: 'created_desc' }, 2)

    expect(ids).toEqual(idsOf(looks, ['e', 'tie-1', 'tie-2', 'b', 'a']))
  })

  it('7.12-INT-002 pages capsules created_at desc, id asc with favorites unpinned', async (context) => {
    if (!requireSchema(context)) return

    const ids: string[] = []
    for (const offset of [0, 1, 2]) {
      const page = await capsules.listCapsules(
        ownerId,
        listOutfitCapsulesQuerySchema.parse({ sort: 'created_desc', limit: 1, offset })
      )
      expect(page.total).toBe(3)
      ids.push(...page.items.map((capsule) => capsule.id))
    }

    expect(ids).toEqual(idsOf(capsuleIds, ['c-tie-1', 'c-tie-2', 'c1']))
  })

  it('7.12-INT-003 keeps the old order without sort and rejects an unknown sort', async (context) => {
    if (!requireSchema(context)) return

    expect(await pagedLooks({}, 2)).toEqual(
      idsOf(looks, ['a', 'b', 'tie-2', 'tie-1', 'e'])
    )

    const page = await capsules.listCapsules(
      ownerId,
      listOutfitCapsulesQuerySchema.parse({})
    )
    expect(page.items.map((capsule) => capsule.id)).toEqual(
      idsOf(capsuleIds, ['c1', 'c-tie-2', 'c-tie-1'])
    )

    expect(listSavedLooksQuerySchema.safeParse({ sort: 'updated_desc' }).success).toBe(
      false
    )
    expect(listOutfitCapsulesQuerySchema.safeParse({ sort: 'created_asc' }).success).toBe(
      false
    )
  })

  it('7.12-INT-004 filters by source and orders by created_at together (Today filter)', async (context) => {
    if (!requireSchema(context)) return

    const ids = await pagedLooks({ source: 'home_sample', sort: 'created_desc' }, 2)

    expect(ids).toEqual(idsOf(looks, ['e', 'tie-1', 'tie-2', 'a']))
  })

  it('7.12-INT-005 both created-order listings can use the P11 indexes', async (context) => {
    if (!requireSchema(context)) return

    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename IN ('SavedLook', 'OutfitCapsule')
    `
    const names = indexes.map((row) => row.indexname)
    expect(names).toContain('SavedLook_user_id_created_at_id_idx')
    expect(names).toContain('OutfitCapsule_user_id_created_at_id_idx')

    // Seq scans, bitmap scans and sorts off: on a small table the planner prefers a scan plus a
    // sort, so this reveals whether an index can return rows in the feed order (the durable
    // property, as in 4.3-PLAN-02). An index with deleted_at before created_at cannot: Postgres
    // does not treat `deleted_at IS NULL` as an equality for index order, and a Sort node stays.
    const explain = (sql: string) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off')
        await tx.$executeRawUnsafe('SET LOCAL enable_bitmapscan = off')
        await tx.$executeRawUnsafe('SET LOCAL enable_sort = off')
        const rows = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
          `EXPLAIN ${sql}`
        )
        return rows.map((row) => row['QUERY PLAN']).join('\n')
      })

    const lookPlan = await explain(
      `SELECT id FROM "SavedLook" WHERE user_id = '${ownerId}' AND deleted_at IS NULL
       ORDER BY created_at DESC, id ASC LIMIT 50`
    )
    expect(lookPlan).toContain('SavedLook_user_id_created_at_id_idx')
    expect(lookPlan, 'the index order must make a sort node unnecessary').not.toMatch(
      /\bSort\b/
    )

    const capsulePlan = await explain(
      `SELECT id FROM "OutfitCapsule" WHERE user_id = '${ownerId}'
       ORDER BY created_at DESC, id ASC LIMIT 50`
    )
    expect(capsulePlan).toContain('OutfitCapsule_user_id_created_at_id_idx')
    expect(capsulePlan).not.toMatch(/\bSort\b/)
  })

  it('7.12-INT-010 a removed look and another member look read the same not found', async (context) => {
    if (!requireSchema(context)) return

    const read = (id: string) =>
      service.getSavedLook(owner, id).then(
        () => 'found',
        (error: unknown) => error
      )

    const removed = await read(looks.get('removed')!)
    const foreign = await read(looks.get('foreign')!)
    const unknown = await read(`${namespace}-never-existed`)

    for (const outcome of [removed, foreign, unknown]) {
      expect(outcome).toBeInstanceOf(NotFoundException)
      expect((outcome as NotFoundException).getResponse()).toEqual(
        (unknown as NotFoundException).getResponse()
      )
    }
    expect((foreign as NotFoundException).message).toBe('SAVED_LOOK_NOT_FOUND')

    // Control: the owner's own look reads.
    await expect(service.getSavedLook(owner, looks.get('e')!)).resolves.toMatchObject({
      data: { id: looks.get('e'), title: 'Look e' },
    })
  })
})
