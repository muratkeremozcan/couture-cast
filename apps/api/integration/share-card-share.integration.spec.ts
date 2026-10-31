// Learning path Step 49: Native platform sharing.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-49-native-platform-sharing
/**
 * Story 6.9: the share purpose and the share capability over the actual API and an
 * isolated database. I-SHARE-AUDIT and I-SHARE-FLAG; the Story 6.8 preview and save
 * cases live in `share-card-export.integration.spec.ts` on the same harness.
 */
import 'reflect-metadata'
import { resolve } from 'node:path'
import type { PrismaClient, Prisma } from '@prisma/client'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeShareCardBase64 } from '@couture/api-client'
import {
  prepareShareCardResponseSchema,
  shareCardCapabilitiesResponseSchema,
} from '@couture/api-client/contracts/http'
import { getDefaultFeatureFlagValue } from '@couture/config'
import { ShareCardsService } from '../src/modules/share-cards/share-cards.service.js'
import {
  SHARE_FLAG,
  capabilities,
  digest,
  featureFlags,
  member,
  outfit,
  photoPost,
  post,
  preview,
  prisma,
  renderer,
  service,
  shareFlagRow,
  sources,
  storage,
  url,
  useShareCardApi,
} from './helpers/share-card-api.js'

useShareCardApi()

describe('Story 6.9 share purpose over the actual API and isolated database', () => {
  const share = (source: Record<string, string>, expectedSha256: string) => ({
    ...preview(source),
    purpose: 'share',
    expectedSha256,
  })
  const audits = () =>
    prisma.auditLog.findMany({
      where: { user_id: member, event_type: 'share_card_export_authorized' },
    })
  afterEach(async () => {
    await shareFlagRow(null)
  })

  it('I-SHARE-AUDIT: accepted share and save each write one closed row labelled with purpose', async () => {
    await shareFlagRow(true)
    const row = await photoPost()
    const source = { kind: 'community_post', postId: row.id }
    const card = prepareShareCardResponseSchema.parse(
      (await post(preview(source)).expect(200)).body
    ).data
    const shared = await post(share(source, card.sha256)).expect(200)
    expect(shared.headers['cache-control']).toBe('private, no-store')
    const sharedCard = prepareShareCardResponseSchema.parse(shared.body).data
    expect(sharedCard.sha256).toBe(card.sha256)
    expect(digest(Buffer.from(decodeShareCardBase64(sharedCard.pngBase64)))).toBe(
      card.sha256
    )
    await post({
      ...preview(source),
      purpose: 'save',
      expectedSha256: card.sha256,
    }).expect(200)
    const rows = await audits()
    const purposeOf = (audit: (typeof rows)[number]) =>
      String((audit.event_data as { purpose?: unknown }).purpose)
    rows.sort((left, right) => purposeOf(left).localeCompare(purposeOf(right)))
    expect(rows.map((audit) => audit.event_data)).toEqual([
      {
        sourceKind: 'community_post',
        locale: 'en-US',
        watermark: true,
        templateVersion: 1,
        purpose: 'save',
      },
      {
        sourceKind: 'community_post',
        locale: 'en-US',
        watermark: true,
        templateVersion: 1,
        purpose: 'share',
      },
    ])
    for (const audit of rows) {
      expect(Object.keys(audit.event_data as object).sort()).toEqual([
        'locale',
        'purpose',
        'sourceKind',
        'templateVersion',
        'watermark',
      ])
      const serialized = JSON.stringify(audit)
      expect(serialized).not.toContain(card.sha256)
      expect(serialized).not.toContain(row.id)
      expect(serialized).not.toContain(row.image_object_path)
      expect(serialized).not.toContain('https://')
    }
  })

  it('I-SHARE-AUDIT: refused, stale and audit-failed shares write no row', async () => {
    const row = await outfit()
    const source = { kind: 'outfit', recommendationId: row.id }
    const card = prepareShareCardResponseSchema.parse(
      (await post(preview(source)).expect(200)).body
    ).data
    await shareFlagRow(false)
    await post(share(source, card.sha256)).expect(403)
    await shareFlagRow(true)
    const stale = await post(share(source, 'f'.repeat(64))).expect(409)
    expect(stale.body).toEqual({
      statusCode: 409,
      code: 'preview_changed',
      message: 'preview_changed',
    })
    const failing = {
      $transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        prisma.$transaction(async (tx) =>
          work(
            new Proxy(tx, {
              get(target, key) {
                if (key === 'auditLog')
                  return { create: () => Promise.reject(new Error('audit outage')) }
                const value: unknown = Reflect.get(target, key)
                return value
              },
            })
          )
        ),
    }
    const broken = new ShareCardsService(
      failing as never,
      sources,
      renderer,
      storage,
      featureFlags
    )
    const prepare = vi
      .spyOn(service, 'prepare')
      .mockImplementationOnce((actor, input, signal) =>
        broken.prepare(actor, input, signal)
      )
    try {
      const failed = await post(share(source, card.sha256)).expect(503)
      expect(failed.body).not.toHaveProperty('data')
    } finally {
      prepare.mockRestore()
    }
    expect(await audits()).toEqual([])
  })

  it('I-SHARE-FLAG: with PostHog down, no row and a false row both refuse share and report off', async () => {
    expect(getDefaultFeatureFlagValue(SHARE_FLAG)).toBe(false)
    const row = await outfit()
    const source = { kind: 'outfit', recommendationId: row.id }
    const card = prepareShareCardResponseSchema.parse(
      (await post(preview(source)).expect(200)).body
    ).data
    const render = vi.spyOn(renderer, 'prepare')
    try {
      for (const value of [null, false] as const) {
        await shareFlagRow(value)
        const refused = await post(share(source, card.sha256)).expect(403)
        expect(refused.body).toEqual({
          statusCode: 403,
          code: 'share_disabled',
          message: 'share_disabled',
        })
        const answer = await capabilities().expect(200)
        expect(answer.headers['cache-control']).toBe('private, no-store')
        expect(answer.body).toEqual({ data: { nativeShare: false } })
      }
      expect(render).not.toHaveBeenCalled()
    } finally {
      render.mockRestore()
    }
    expect(await audits()).toEqual([])
    // Preview and save never read the share flag.
    await post({
      ...preview(source),
      purpose: 'save',
      expectedSha256: card.sha256,
    }).expect(200)
  })

  it('I-SHARE-FLAG: the dev seed turns share on and capabilities report it', async () => {
    const seedPath = resolve(
      __dirname,
      '../../../packages/db/prisma/seeds/feature-flags.ts'
    )
    const seeds = (await import(seedPath)) as {
      seedFeatureFlags: (client: PrismaClient) => Promise<unknown>
    }
    await seeds.seedFeatureFlags(prisma)
    const answer = await capabilities().expect(200)
    expect(answer.headers['cache-control']).toBe('private, no-store')
    expect(shareCardCapabilitiesResponseSchema.parse(answer.body)).toEqual({
      data: { nativeShare: true },
    })
    const row = await outfit()
    const source = { kind: 'outfit', recommendationId: row.id }
    const card = prepareShareCardResponseSchema.parse(
      (await post(preview(source)).expect(200)).body
    ).data
    await post(share(source, card.sha256)).expect(200)
    expect(await audits()).toHaveLength(1)
  })

  it('I-SHARE-FLAG: capabilities and share require authentication', async () => {
    await shareFlagRow(true)
    await request(url).get('/api/v1/share-cards/capabilities').expect(401)
    await request(url)
      .post('/api/v1/share-cards/prepare')
      .send(share({ kind: 'outfit', recommendationId: 'any' }, 'a'.repeat(64)))
      .expect(401)
  })
})
