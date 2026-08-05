import { PrismaClient } from '@prisma/client'
import { garmentListResponseSchema } from '@couture/api-client/contracts/http'
import type { ApiRequestFixture } from './api-test'

export async function cleanupWardrobeUserTestData(
  apiRequest: ApiRequestFixture,
  accessToken: string | undefined,
  userId: string | undefined,
  apiBaseUrl: string
): Promise<void> {
  try {
    if (accessToken) {
      const headers = { Authorization: `Bearer ${accessToken}` }
      const wardrobeResponse = await apiRequest({
        method: 'GET',
        path: '/api/v1/wardrobe/garments',
        baseUrl: apiBaseUrl,
        headers,
      })

      if (wardrobeResponse.status === 200) {
        const wardrobe = garmentListResponseSchema.parse(wardrobeResponse.body)
        for (const garment of wardrobe.data) {
          const deletionResponse = await apiRequest({
            method: 'DELETE',
            path: `/api/v1/wardrobe/garments/${garment.id}`,
            baseUrl: apiBaseUrl,
            headers,
          })
          if (deletionResponse.status !== 204) {
            throw new Error(
              `Wardrobe cleanup failed for ${garment.id} with status ${deletionResponse.status}`
            )
          }
        }
      } else if (wardrobeResponse.status !== 404) {
        throw new Error(
          `Wardrobe cleanup list failed with status ${wardrobeResponse.status}`
        )
      }
    }
  } finally {
    await cleanupUserTestData(userId)
  }
}

export async function cleanupUserTestData(userId: string | undefined): Promise<void> {
  if (!userId) {
    return
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to clean local Playwright user data')
  }
  const databaseUrl = new URL(process.env.DATABASE_URL)
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  const isSupportedLocalDatabase =
    ['postgres:', 'postgresql:'].includes(databaseUrl.protocol) &&
    localHosts.has(databaseUrl.hostname) &&
    databaseUrl.port === '54322' &&
    databaseUrl.pathname === '/postgres' &&
    databaseUrl.username === 'postgres'
  if (!isSupportedLocalDatabase) {
    throw new Error(
      `Refusing destructive Playwright cleanup outside the supported local Supabase database: ${databaseUrl.hostname}:${databaseUrl.port}${databaseUrl.pathname}`
    )
  }

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl.toString() })

  try {
    await prisma.$transaction(
      async (tx) => {
        const garments = await tx.garmentItem.findMany({
          where: { user_id: userId },
          select: { id: true },
        })
        const garmentIds = garments.map((garment) => garment.id)
        const posts = await tx.lookbookPost.findMany({
          where: { user_id: userId },
          select: { id: true },
        })
        const postIds = posts.map((post) => post.id)

        await tx.moderationEvent.deleteMany({
          where: {
            OR: [
              { flagged_by_id: userId },
              { reviewed_by_id: userId },
              { garment_item_id: { in: garmentIds } },
              { post_id: { in: postIds } },
            ],
          },
        })
        await tx.eventEnvelope.deleteMany({ where: { user_id: userId } })
        await tx.telemetryEvent.deleteMany({
          where: {
            OR: [
              { user_id: userId },
              ...garmentIds.map((garmentId) => ({
                properties: { path: ['garment_id'], equals: garmentId },
              })),
            ],
          },
        })
        await tx.engagementEvent.deleteMany({ where: { user_id: userId } })
        await tx.lookbookPost.deleteMany({ where: { user_id: userId } })
        await tx.pushToken.deleteMany({ where: { user_id: userId } })
        await tx.alertRule.deleteMany({ where: { user_id: userId } })
        await tx.notificationPreference.deleteMany({ where: { user_id: userId } })
        await tx.savedLocation.deleteMany({ where: { user_id: userId } })
        await tx.outfitRecommendation.deleteMany({ where: { user_id: userId } })
        await tx.paletteInsights.deleteMany({ where: { user_id: userId } })
        await tx.garmentItem.deleteMany({ where: { user_id: userId } })
        await tx.guardianInvitation.deleteMany({
          where: {
            OR: [{ teen_id: userId }, { accepted_guardian_id: userId }],
          },
        })
        await tx.guardianConsent.deleteMany({
          where: {
            OR: [{ guardian_id: userId }, { teen_id: userId }],
          },
        })
        await tx.comfortPreferences.deleteMany({ where: { user_id: userId } })
        await tx.userProfile.deleteMany({ where: { user_id: userId } })

        await tx.$executeRawUnsafe('SAVEPOINT playwright_audit_cleanup')
        let canDeleteImmutableAuditRows = false
        try {
          await tx.$executeRaw`SET LOCAL session_replication_role = 'replica'`
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT playwright_audit_cleanup')
          canDeleteImmutableAuditRows = true
        } catch {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT playwright_audit_cleanup')
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT playwright_audit_cleanup')
          console.warn(
            'Playwright cleanup could not disable local audit triggers; immutable audit rows and the linked user were retained'
          )
        }
        if (canDeleteImmutableAuditRows) {
          await tx.auditLog.deleteMany({ where: { user_id: userId } })
          await tx.user.deleteMany({ where: { id: userId } })
        }
      },
      { timeout: 30_000 }
    )
  } finally {
    await prisma.$disconnect()
  }
}
