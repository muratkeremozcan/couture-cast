// Story 6.7b: a test-only sponsorship link on a post a test owns.
//
// Production links are created and ended only by the owner's audited operator
// command. A browser journey that needs a sponsored post of its own writes the
// link row directly into the isolated local database instead:
// `communityTestDatabase` resolves through `localPlaywrightDatabaseUrl`, which
// refuses any DATABASE_URL that is not the loopback Supabase port with a
// supported local database name, so this can never reach a remote database.
import { communityTestDatabase } from './community-engagement'

/** The seeded partner, offer and link creator (`packages/db/prisma/seeds/commerce.ts`). */
export const SEEDED_SPONSOR = {
  partnerSlug: 'sample-partner',
  partnerName: 'Sample Partner',
  offerTitle: 'Everyday Layering Tee',
  operatorUserId: 'seed-sponsorship-operator',
} as const

export type TestSponsorship = {
  offerId: string
  /** Deletes the link row. Safe to call more than once. */
  remove: () => Promise<void>
}

/**
 * Links `postId` to the seeded garment offer with an open, backdated window.
 * The link exists only for this post, so parallel workers never see it on a
 * post of theirs.
 */
export async function linkTestSponsorship(postId: string): Promise<TestSponsorship> {
  const db = communityTestDatabase()
  try {
    const offer = await db.affiliateOffer.findFirstOrThrow({
      where: {
        title: SEEDED_SPONSOR.offerTitle,
        advisor_slot: null,
        partner: { slug: SEEDED_SPONSOR.partnerSlug },
      },
      select: { id: true },
    })
    const link = await db.communityPostSponsorship.create({
      data: {
        post_id: postId,
        offer_id: offer.id,
        starts_at: new Date(Date.now() - 60_000),
        ends_at: null,
        created_by_id: SEEDED_SPONSOR.operatorUserId,
        create_reason: 'owner_pick',
      },
      select: { id: true },
    })
    return {
      offerId: offer.id,
      remove: async () => {
        const cleanup = communityTestDatabase()
        try {
          await cleanup.communityPostSponsorship.deleteMany({ where: { id: link.id } })
        } finally {
          await cleanup.$disconnect()
        }
      },
    }
  } finally {
    await db.$disconnect()
  }
}
