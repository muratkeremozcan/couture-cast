import { createHash } from 'node:crypto'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { z } from 'zod'
import { PrismaClient, Prisma } from '@prisma/client'
import {
  garmentCategoryEnum,
  scenarioNameSchema,
  type ShareCardSource,
} from '@couture/api-client/contracts/http'
import { assertCommunityDatabaseAccess } from '../community/community-access.service.js'
import { isPubliclyVisiblePost } from '../community/community.repository.js'
import { CommunityService } from '../community/community.service.js'

export type OutfitProjection = {
  kind: 'outfit'
  scenario: 'morning' | 'midday' | 'evening'
  categories: string[]
  fingerprint?: string
}
export type PostProjection = {
  kind: 'community_post'
  path: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  sha256: string
  byteSize: number
  climateBand: string | null
}
export type ShareCardProjection = OutfitProjection | PostProjection
const garmentIdsSchema = z
  .array(z.string().min(1).max(128))
  .min(1)
  .max(12)
  .refine((ids) => new Set(ids).size === ids.length)
const unavailable = () =>
  new NotFoundException({
    code: 'source_unavailable',
    statusCode: 404,
    message: 'source_unavailable',
  })

@Injectable()
export class ShareCardSourceRepository {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(CommunityService) private readonly community: CommunityService
  ) {}
  async resolve(
    member: string,
    source: ShareCardSource,
    tx: Prisma.TransactionClient = this.prisma
  ): Promise<ShareCardProjection> {
    if (source.kind === 'community_post')
      return this.community.readAuthorized(member, async () => {
        await assertCommunityDatabaseAccess(tx, member)
        return this.post(member, source.postId, tx)
      })
    // The same live member, age, suspension and guardian participation rules apply to outfits.
    await assertCommunityDatabaseAccess(tx, member)
    const row = await tx.outfitRecommendation.findFirst({
      where: { id: source.recommendationId, user_id: member },
    })
    const scenario = scenarioNameSchema.safeParse(row?.scenario)
    const parsedIds = garmentIdsSchema.safeParse(row?.garment_ids)
    if (!row || !scenario.success || !parsedIds.success) throw unavailable()
    const ids = parsedIds.data
    if (row.capsule_id) {
      const capsule = await tx.outfitCapsule.findFirst({
        where: { id: row.capsule_id, user_id: member },
      })
      const profile = await tx.userProfile.findUnique({
        where: { user_id: member },
        select: { capsule_revision: true },
      })
      if (!capsule || profile?.capsule_revision !== row.capsule_revision)
        throw unavailable()
    }
    const categories: string[] = []
    for (const id of ids) {
      const starter = garmentCategoryEnum.options.find(
        (category) => id === `default-${category}`
      )
      if (starter) {
        categories.push(starter)
        continue
      }
      const garment = await tx.garmentItem.findFirst({
        where: {
          id,
          user_id: member,
          retention_status: 'active',
          upload_status: 'ready',
        },
        select: { category: true },
      })
      const category = garmentCategoryEnum.safeParse(garment?.category)
      if (!category.success) throw unavailable()
      categories.push(category.data)
    }
    return {
      kind: 'outfit',
      scenario: scenario.data,
      fingerprint: createHash('sha256')
        .update(
          JSON.stringify({
            ids,
            scenario: scenario.data,
            capsule: row.capsule_id,
            revision: row.capsule_revision,
          })
        )
        .digest('hex'),
      categories: garmentCategoryEnum.options.filter((category) =>
        categories.includes(category)
      ),
    }
  }
  /** Locks are acquired after the audit await, then eligibility is read on this transaction. */
  async resolveGuarded(
    member: string,
    source: ShareCardSource,
    tx: Prisma.TransactionClient
  ) {
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1000ms'")
    if (source.kind === 'community_post') {
      await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${member}]::text[], ARRAY[${source.postId}]::text[], false)`
    }
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${member} FOR SHARE`
    await tx.$queryRaw`SELECT id FROM "UserProfile" WHERE user_id = ${member} FOR SHARE`
    await tx.$queryRaw`SELECT id FROM "GuardianConsent" WHERE teen_id = ${member} ORDER BY id FOR SHARE`
    if (source.kind === 'community_post') {
      await tx.$queryRaw`SELECT id FROM "LookbookPost" WHERE id = ${source.postId} FOR SHARE`
    } else {
      await tx.$queryRaw`SELECT id FROM "OutfitRecommendation" WHERE id = ${source.recommendationId} FOR SHARE`
      const row = await tx.outfitRecommendation.findFirst({
        where: { id: source.recommendationId, user_id: member },
      })
      if (row?.capsule_id)
        await tx.$queryRaw`SELECT id FROM "OutfitCapsule" WHERE id = ${row.capsule_id} FOR SHARE`
      const ids = garmentIdsSchema.safeParse(row?.garment_ids)
      if (!ids.success) throw unavailable()
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "GarmentItem" WHERE id IN (${Prisma.join(ids.data)}) ORDER BY id FOR SHARE`
      )
    }
    return this.resolve(member, source, tx)
  }
  private async post(
    member: string,
    id: string,
    tx: Prisma.TransactionClient
  ): Promise<PostProjection> {
    const row = await tx.lookbookPost.findFirst({
      where: { id, user_id: member },
    })
    if (!row || !isPubliclyVisiblePost(row)) throw unavailable()
    const path = row.image_object_path
    if (
      !path ||
      !path.startsWith(`community/${id}/`) ||
      !/^community\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(path) ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(row.image_content_type ?? '') ||
      !row.image_checksum ||
      !/^[a-f0-9]{64}$/.test(row.image_checksum) ||
      row.image_byte_size === null ||
      row.image_byte_size <= 0 ||
      row.image_byte_size > 10 * 1024 * 1024
    )
      throw unavailable()
    return {
      kind: 'community_post',
      path,
      mimeType: row.image_content_type as PostProjection['mimeType'],
      sha256: row.image_checksum,
      byteSize: row.image_byte_size,
      climateBand: row.climate_band,
    }
  }
}
