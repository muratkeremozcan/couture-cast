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

  const prisma = new PrismaClient()

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = 'replica'`
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
        await tx.telemetryEvent.deleteMany({ where: { user_id: userId } })
        await tx.engagementEvent.deleteMany({ where: { user_id: userId } })
        await tx.lookbookPost.deleteMany({ where: { user_id: userId } })
        await tx.auditLog.deleteMany({ where: { user_id: userId } })
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
        await tx.user.deleteMany({ where: { id: userId } })
      },
      { timeout: 30_000 }
    )
  } finally {
    await prisma.$disconnect()
  }
}
